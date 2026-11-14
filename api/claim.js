/**
 * Vercel Serverless Function — POST /api/claim
 *
 * Validates a ProofMarket claim and stores it in Upstash Redis.
 * Supports two modes: 'eth' (Sepolia payment) and 'pnl' (Primus attestation).
 *
 * ── Security model ────────────────────────────────────────────────────────────
 * Items are defined server-side — thresholds from the client are NEVER trusted.
 * PnL path runs 6+ server-side checks before accepting a claim.
 *
 * ── Attestation type (Primus SDK 0.3.x) ──────────────────────────────────────
 *   attestation.recipient        — wallet address passed to generateRequestParams
 *   attestation.timestamp        — ms timestamp (number, directly on attestation)
 *   attestation.signatures[0]   — primary signature (use for replay hash)
 *   attestation.attestors[0]    — { attestorAddr, url }
 *   attestation.data            — JSON string; parse to get spotPnlRate
 *
 * Note on template ID check: The Attestation type does NOT contain the template
 * ID directly. However, since /api/sign only signs requests for our TEMPLATE_ID,
 * and verifyAttestation() cryptographically verifies the Primus attestor
 * signature, any attestation that passes verifyAttestation() necessarily
 * originated from a request signed with our secret — implicitly binding it to
 * our template. We therefore skip the explicit template field check and rely on
 * the cryptographic verification instead.
 */

import crypto from 'crypto';
import { ethers } from 'ethers';

// ── Primus Template & Attestation Constants ──────────────────────────────────
export const TEMPLATE_ID = '369e1db8-47c9-4dc6-85b5-037cd02d3383';

export const EXPECTED_BINANCE_URL =
  'https://www.binance.com/bapi/composite/v1/private/bigdata/finance/spot-statistics';

export const EXPECTED_PARSE_PATH =
  '$.data.cumulativeCurrMonth.spotPnlRate';

/** Production Primus attestor address (the only trusted trust anchor). */
export const REQUIRED_PADO_ADDRESS =
  '0x5Ed3176045F68617B0958a61ac1868875C98C14d'.toLowerCase();

/**
 * Asserts that the Primus SDK instance is configured with the production
 * Pado attestor address. Throws if there is a mismatch.
 */
export function assertPadoAddress(primus) {
  const current = (primus?._padoAddress ?? '').toLowerCase();
  if (current !== REQUIRED_PADO_ADDRESS) {
    const msg = `CRITICAL: Primus _padoAddress mismatch! Expected ${REQUIRED_PADO_ADDRESS}, got ${current}`;
    console.error(`[/api/claim] ${msg}`);
    throw new Error(msg);
  }
  return true;
}

// ── Attestation Encoders (mirrors SDK encodeAttestation) ──────────────────────
export function encodeRequest(request = {}) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'string', 'string', 'string'],
      [request.url ?? '', request.header ?? '', request.method ?? '', request.body ?? '']
    )
  );
}

export function encodeResponse(resolves = []) {
  let encodeData = '0x';
  for (let i = 0; i < resolves.length; i++) {
    encodeData = ethers.solidityPacked(
      ['bytes', 'string', 'string', 'string'],
      [encodeData, resolves[i].keyName ?? '', resolves[i].parseType ?? '', resolves[i].parsePath ?? '']
    );
  }
  return ethers.keccak256(encodeData);
}

export function encodeAttestation(att) {
  const resolves = att.reponseResolve ?? att.responseResolve ?? [];
  const encodedData = ethers.solidityPacked(
    ['address', 'bytes32', 'bytes32', 'string', 'string', 'uint64', 'string'],
    [
      att.recipient,
      encodeRequest(att.request ?? {}),
      encodeResponse(resolves),
      att.data ?? '',
      att.attConditions ?? '',
      BigInt(att.timestamp ?? 0),
      att.additionParams ?? '',
    ]
  );
  return ethers.keccak256(encodedData);
}

export function recoverAttestationSigner(att) {
  const sig = att.signatures?.[0];
  if (!sig) return null;
  const hash = encodeAttestation(att);
  return ethers.recoverAddress(hash, sig);
}

// ── Server-side item definitions — NEVER trust client-sent thresholds ─────────
const ITEMS = {
  starter:  { id: 'starter',  name: 'Starter',  minPnl: 0.01 },
  silver:   { id: 'silver',   name: 'Silver',   minPnl: 0.03 },
  gold:     { id: 'gold',     name: 'Gold',     minPnl: 0.05 },
  platinum: { id: 'platinum', name: 'Platinum', minPnl: 0.10 },
};

// Stale attestation cutoff: 10 minutes
const MAX_ATT_AGE_MS = 10 * 60 * 1000;

// ── Upstash Redis REST helpers ────────────────────────────────────────────────

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL   ?? '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

function redisHeaders() {
  return { Authorization: `Bearer ${REDIS_TOKEN}` };
}

/** GET key → value or null */
async function redisGet(key) {
  const r = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    { headers: redisHeaders() },
  );
  const j = await r.json();
  return j.result ?? null;  // null if not set
}

/** SET key value  (no expiry) */
async function redisSet(key, value) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  await fetch(
    `${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}`,
    { headers: redisHeaders() },
  );
}

/** SET key value EX seconds  (with expiry) */
async function redisSetEx(key, value, exSeconds) {
  const encoded = encodeURIComponent(JSON.stringify(value));
  await fetch(
    `${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}/ex/${exSeconds}`,
    { headers: redisHeaders() },
  );
}

// ── Primus SDK — lazy-cached instance (same pattern as sign.js) ───────────────

const APP_ID     = process.env.VITE_APP_ID  ?? '';
const APP_SECRET = process.env.APP_SECRET   ?? '';

let primusInstance = null;
let padoAddressAssertionFailed = false;
let padoAssertionError = null;

export async function getPrimus() {
  if (padoAddressAssertionFailed) {
    console.error('[/api/claim] Failing closed due to previous _padoAddress assertion failure:', padoAssertionError);
    throw new Error(padoAssertionError);
  }
  if (primusInstance) return primusInstance;

  const { PrimusZKTLS } = await import('@primuslabs/zktls-js-sdk');
  const p = new PrimusZKTLS();
  // In Node.js with appSecret, init() returns immediately without network
  p.init(APP_ID, APP_SECRET);

  try {
    assertPadoAddress(p);
  } catch (err) {
    padoAddressAssertionFailed = true;
    padoAssertionError = err.message;
    throw err;
  }

  primusInstance = p;
  return p;
}

// ── Body parser (same as sign.js) ─────────────────────────────────────────────

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data',  (chunk) => { raw += chunk; });
    req.on('end',   ()      => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    req.on('error', ()      => resolve({}));
  });
}

// ── Validation helpers ────────────────────────────────────────────────────────

/** Returns true if the string looks like a valid Ethereum address. */
function isEthAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/** Returns true if the string looks like a valid 0x-prefixed hex hash. */
function isHexHash(hash) {
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const body = await parseBody(req);
  const { itemId, mode, walletAddress } = body;

  // ── 1. Validate itemId ─────────────────────────────────────────────────────
  const item = ITEMS[itemId];
  if (!item) {
    console.error(`[/api/claim] Unknown item: ${itemId}`);
    return res.status(400).json({ error: 'UNKNOWN_ITEM' });
  }

  // ── 2. Validate walletAddress ──────────────────────────────────────────────
  if (!isEthAddress(walletAddress)) {
    console.error(`[/api/claim] Invalid walletAddress: ${walletAddress}`);
    return res.status(400).json({ error: 'INVALID_WALLET_ADDRESS' });
  }

  const wallet = walletAddress.toLowerCase();

  // ── ETH MODE ───────────────────────────────────────────────────────────────
  if (mode === 'eth') {
    const { txHash } = body;

    // 3a. Validate txHash format
    if (!isHexHash(txHash)) {
      console.error(`[/api/claim] Invalid txHash format: ${txHash}`);
      return res.status(400).json({ error: 'INVALID_TX_HASH' });
    }

    // 4a. One claim per wallet per item (ETH path)
    const claimKey = `claim:eth:${wallet}:${itemId}`;
    const existing = await redisGet(claimKey);
    if (existing) {
      console.error(`[/api/claim] Already claimed (ETH): ${claimKey}`);
      return res.status(409).json({ error: 'ALREADY_CLAIMED' });
    }

    // Store claim
    const receipt = {
      itemId,
      itemName: item.name,
      mode: 'eth',
      walletAddress: wallet,
      txHash,
      claimedAt: Date.now(),
    };
    await redisSet(claimKey, receipt);

    console.log(`[/api/claim] ETH claim stored: ${wallet} → ${itemId} tx=${txHash}`);
    return res.json({ ok: true, receipt });
  }

  // ── PNL MODE ───────────────────────────────────────────────────────────────
  if (mode === 'pnl') {
    const { attestation } = body;

    // 3b. Attestation object must be present
    if (!attestation || typeof attestation !== 'object') {
      console.error('[/api/claim] Missing or invalid attestation object');
      return res.status(400).json({ error: 'MISSING_ATTESTATION' });
    }

    // ── Check 0: Template ID reference check ──────────────────────────────────
    // If the attestation, request payload, or additionParams exposes any template reference,
    // ensure it strictly matches our TEMPLATE_ID.
    const explicitTemplateId =
      attestation.attTemplateID ||
      attestation.templateId ||
      attestation.attTemplateId ||
      attestation.attRequest?.attTemplateID ||
      attestation.attRequest?.templateId ||
      attestation.request?.attTemplateID ||
      attestation.request?.templateId ||
      body.attTemplateID ||
      body.templateId ||
      body.attRequest?.attTemplateID ||
      body.attRequest?.templateId;

    if (explicitTemplateId && explicitTemplateId !== TEMPLATE_ID) {
      console.error(`[/api/claim] Template ID mismatch: expected ${TEMPLATE_ID}, got ${explicitTemplateId}`);
      return res.status(400).json({ error: 'INVALID_TEMPLATE_ID' });
    }

    if (typeof attestation.additionParams === 'string' && attestation.additionParams.trim()) {
      try {
        const parsedAdd = JSON.parse(attestation.additionParams);
        const addTemplate = parsedAdd?.attTemplateID || parsedAdd?.templateId || parsedAdd?.attTemplateId;
        if (addTemplate && addTemplate !== TEMPLATE_ID) {
          console.error(`[/api/claim] Template ID in additionParams mismatch: expected ${TEMPLATE_ID}, got ${addTemplate}`);
          return res.status(400).json({ error: 'INVALID_TEMPLATE_ID' });
        }
      } catch {
        // additionParams is not JSON
      }
    }

    if (typeof body.requestStr === 'string') {
      try {
        const parsedReq = JSON.parse(body.requestStr);
        const reqTpl = parsedReq?.attTemplateID || parsedReq?.templateId || parsedReq?.attTemplateId;
        if (reqTpl && reqTpl !== TEMPLATE_ID) {
          console.error(`[/api/claim] Template ID in requestStr mismatch: expected ${TEMPLATE_ID}, got ${reqTpl}`);
          return res.status(400).json({ error: 'INVALID_TEMPLATE_ID' });
        }
      } catch {
        // ignore
      }
    }

    // ── Check 1: Cryptographic signature verification (Trust Anchor) ────────
    let primus;
    try {
      primus = await getPrimus();
    } catch (e) {
      console.error('[/api/claim] Failed to initialize Primus SDK trust anchor:', e.message);
      return res.status(500).json({ error: 'SERVER_CONFIGURATION_ERROR' });
    }

    try {
      // verifyAttestation is synchronous in SDK 0.3.x
      const valid = primus.verifyAttestation(attestation);
      if (!valid) {
        console.error('[/api/claim] verifyAttestation returned false (signature invalid or signer mismatch)');
        return res.status(400).json({ error: 'INVALID_SIGNATURE' });
      }
    } catch (e) {
      console.error('[/api/claim] verifyAttestation threw exception:', e.message);
      return res.status(400).json({ error: 'INVALID_SIGNATURE' });
    }

    // ── Check 1b: Strict Request URL Check ─────────────────────────────────
    // attestation.request.url must strictly equal the exact Binance spot endpoint
    if (!attestation.request || typeof attestation.request !== 'object') {
      console.error('[/api/claim] Missing attestation.request object');
      return res.status(400).json({ error: 'INVALID_REQUEST_URL' });
    }
    if (attestation.request.url !== EXPECTED_BINANCE_URL) {
      console.error(`[/api/claim] URL mismatch: expected "${EXPECTED_BINANCE_URL}", got "${attestation.request.url}"`);
      return res.status(400).json({ error: 'INVALID_REQUEST_URL' });
    }

    // ── Check 1c: Strict Response Resolve Check ────────────────────────────
    // attestation.reponseResolve must contain exactly one entry for spotPnlRate with exact parsePath
    const resolves = attestation.reponseResolve ?? attestation.responseResolve;
    if (!Array.isArray(resolves) || resolves.length !== 1) {
      console.error(`[/api/claim] reponseResolve length mismatch: expected 1, got ${Array.isArray(resolves) ? resolves.length : 'none'}`);
      return res.status(400).json({ error: 'INVALID_RESPONSE_RESOLVE' });
    }
    const resolveEntry = resolves[0];
    if (resolveEntry.keyName !== 'spotPnlRate') {
      console.error(`[/api/claim] reponseResolve keyName mismatch: expected "spotPnlRate", got "${resolveEntry.keyName}"`);
      return res.status(400).json({ error: 'INVALID_RESPONSE_RESOLVE' });
    }
    if (resolveEntry.parsePath !== EXPECTED_PARSE_PATH) {
      console.error(`[/api/claim] reponseResolve parsePath mismatch: expected "${EXPECTED_PARSE_PATH}", got "${resolveEntry.parsePath}"`);
      return res.status(400).json({ error: 'INVALID_RESPONSE_RESOLVE' });
    }

    // ── Check 2: Recency — timestamp is directly on attestation (ms) ──────
    const attTimestamp = attestation.timestamp;
    if (!attTimestamp || typeof attTimestamp !== 'number') {
      console.error('[/api/claim] Attestation missing valid numeric timestamp');
      return res.status(400).json({ error: 'ATTESTATION_EXPIRED' });
    }
    const ageMs = Date.now() - attTimestamp;
    if (ageMs > MAX_ATT_AGE_MS) {
      console.error(`[/api/claim] Attestation is stale: ${Math.round(ageMs / 1000)}s old (max ${MAX_ATT_AGE_MS / 1000}s)`);
      return res.status(400).json({ error: 'ATTESTATION_EXPIRED' });
    }

    // ── Check 3: Wallet binding — recipient must match walletAddress ───────
    // The Primus SDK puts the wallet address the user passed to
    // generateRequestParams() into attestation.recipient.
    const attRecipient = attestation.recipient ?? '';
    if (attRecipient.toLowerCase() !== wallet) {
      console.error(`[/api/claim] Recipient mismatch: attestation.recipient="${attRecipient}", walletAddress="${wallet}"`);
      return res.status(400).json({ error: 'RECIPIENT_MISMATCH' });
    }

    // ── Check 4: Parse and validate spotPnlRate & no extra keys ───────────
    let parsedData;
    try {
      parsedData = JSON.parse(attestation.data);
    } catch (e) {
      console.error('[/api/claim] Could not parse attestation.data as JSON:', e.message);
      return res.status(400).json({ error: 'INVALID_ATTESTATION_DATA' });
    }

    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      console.error('[/api/claim] attestation.data is not an object or is an array');
      return res.status(400).json({ error: 'INVALID_ATTESTATION_DATA' });
    }

    const dataKeys = Object.keys(parsedData);
    if (dataKeys.length !== 1 || dataKeys[0] !== 'spotPnlRate') {
      console.error(`[/api/claim] attestation.data unexpected keys: expected ['spotPnlRate'], got ${JSON.stringify(dataKeys)}`);
      return res.status(400).json({ error: 'INVALID_ATTESTATION_DATA' });
    }

    const rawRate = parsedData.spotPnlRate;
    const rate = typeof rawRate === 'number' ? rawRate : parseFloat(rawRate);

    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      console.error(`[/api/claim] spotPnlRate missing or not a finite number: got ${rawRate}`);
      return res.status(400).json({ error: 'INVALID_RATE' });
    }

    if (rate < item.minPnl) {
      console.error(`[/api/claim] Insufficient PnL: got ${(rate * 100).toFixed(2)}%, need ≥ ${(item.minPnl * 100).toFixed(0)}%`);
      return res.status(400).json({ error: 'INSUFFICIENT_PNL' });
    }

    // ── Check 5: Replay protection — hash signatures[0] ───────────────────
    const primarySig = attestation.signatures?.[0];
    if (!primarySig || typeof primarySig !== 'string') {
      console.error('[/api/claim] Attestation signatures array missing or empty');
      return res.status(400).json({ error: 'MISSING_SIGNATURE' });
    }
    const sigHash = crypto.createHash('sha256').update(primarySig).digest('hex');
    const replayKey = `attHash:${sigHash}`;
    const usedBefore = await redisGet(replayKey);
    if (usedBefore) {
      console.error(`[/api/claim] Replay attack: signature hash ${sigHash} already used`);
      return res.status(409).json({ error: 'REPLAY_DETECTED' });
    }
    // Store with 24-hour TTL
    await redisSetEx(replayKey, { used: true, wallet, itemId, usedAt: Date.now() }, 86400);

    // ── Check 6: One claim per wallet per item (PnL path) ─────────────────
    const claimKey = `claim:pnl:${wallet}:${itemId}`;
    const existing = await redisGet(claimKey);
    if (existing) {
      console.error(`[/api/claim] Already claimed (PnL): ${claimKey}`);
      return res.status(409).json({ error: 'ALREADY_CLAIMED' });
    }

    // All checks passed — store claim
    const receipt = {
      itemId,
      itemName: item.name,
      mode: 'pnl',
      walletAddress: wallet,
      tier: item.minPnl,       // numeric threshold (do NOT expose exact rate to client)
      claimedAt: Date.now(),
    };
    await redisSet(claimKey, receipt);

    console.log(`[/api/claim] PnL claim stored: ${wallet} → ${itemId} rate=${rate}`);
    return res.json({ ok: true, receipt });
  }

  // Unknown mode
  console.error(`[/api/claim] Unknown mode: ${mode}`);
  return res.status(400).json({ error: 'UNKNOWN_MODE' });
}
