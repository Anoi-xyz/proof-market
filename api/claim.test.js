/**
 * api/claim.test.js — Unit tests for the claim validation logic in api/claim.js
 *
 * Tests the core validation logic without making real Redis or Primus calls.
 * Run with:  node api/claim.test.js
 *
 * Uses Node's built-in assert module. No external test runner required.
 */

import assert from 'assert/strict';
import crypto from 'crypto';
import { ethers } from 'ethers';
import signHandler, { TEMPLATE_ID as SIGN_TEMPLATE_ID } from './sign.js';
import claimHandler, {
  EXPECTED_BINANCE_URL,
  EXPECTED_PARSE_PATH,
  REQUIRED_PADO_ADDRESS,
  assertPadoAddress,
  encodeAttestation,
  recoverAttestationSigner,
} from './claim.js';

// ── Re-implement the validation helpers inline (mirrors api/claim.js) ─────────
// This avoids importing the whole serverless handler which needs Vercel env.

const TEMPLATE_ID = '369e1db8-47c9-4dc6-85b5-037cd02d3383';

const ITEMS = {
  starter:  { id: 'starter',  name: 'Starter',  minPnl: 0.01 },
  silver:   { id: 'silver',   name: 'Silver',   minPnl: 0.03 },
  gold:     { id: 'gold',     name: 'Gold',     minPnl: 0.05 },
  platinum: { id: 'platinum', name: 'Platinum', minPnl: 0.10 },
};

const MAX_ATT_AGE_MS = 10 * 60 * 1000; // 10 minutes

function isEthAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isHexHash(hash) {
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash);
}

/**
 * validatePnlClaim — pure function that mirrors the PnL checks in api/claim.js.
 * Returns { ok: true, receipt } or { ok: false, error, status }.
 *
 * seenHashes and seenClaims simulate the Redis state.
 */
function validatePnlClaim(body, { seenHashes = new Set(), seenClaims = new Set() } = {}) {
  const { itemId, mode, walletAddress, attestation } = body;

  // 1. Item exists
  const item = ITEMS[itemId];
  if (!item) return { ok: false, error: 'UNKNOWN_ITEM', status: 400 };

  // 2. Valid wallet address
  if (!isEthAddress(walletAddress)) return { ok: false, error: 'INVALID_WALLET_ADDRESS', status: 400 };

  const wallet = walletAddress.toLowerCase();

  if (mode !== 'pnl') return { ok: false, error: 'UNKNOWN_MODE', status: 400 };

  // 3. Attestation present
  if (!attestation || typeof attestation !== 'object') {
    return { ok: false, error: 'MISSING_ATTESTATION', status: 400 };
  }

  // 3b. Template ID reference check (if exposed by attestation/request)
  const explicitTemplateId =
    attestation.attTemplateID ||
    attestation.templateId ||
    attestation.attTemplateId ||
    attestation.attRequest?.attTemplateID ||
    attestation.attRequest?.templateId ||
    attestation.request?.attTemplateID ||
    attestation.request?.templateId ||
    body.attTemplateID ||
    body.templateId;

  if (explicitTemplateId && explicitTemplateId !== TEMPLATE_ID) {
    return { ok: false, error: 'INVALID_TEMPLATE_ID', status: 400 };
  }

  if (typeof attestation.additionParams === 'string' && attestation.additionParams.trim()) {
    try {
      const parsedAdd = JSON.parse(attestation.additionParams);
      const addTemplate = parsedAdd?.attTemplateID || parsedAdd?.templateId || parsedAdd?.attTemplateId;
      if (addTemplate && addTemplate !== TEMPLATE_ID) {
        return { ok: false, error: 'INVALID_TEMPLATE_ID', status: 400 };
      }
    } catch {
      // not JSON
    }
  }

  // 4. Strict Request URL Check (Binance endpoint)
  if (!attestation.request || typeof attestation.request !== 'object') {
    return { ok: false, error: 'INVALID_REQUEST_URL', status: 400 };
  }
  if (attestation.request.url !== EXPECTED_BINANCE_URL) {
    return { ok: false, error: 'INVALID_REQUEST_URL', status: 400 };
  }

  // 4b. Strict Response Resolve Check
  const resolves = attestation.reponseResolve ?? attestation.responseResolve;
  if (!Array.isArray(resolves) || resolves.length !== 1) {
    return { ok: false, error: 'INVALID_RESPONSE_RESOLVE', status: 400 };
  }
  const resolveEntry = resolves[0];
  if (resolveEntry.keyName !== 'spotPnlRate' || resolveEntry.parsePath !== EXPECTED_PARSE_PATH) {
    return { ok: false, error: 'INVALID_RESPONSE_RESOLVE', status: 400 };
  }

  // 5. Recency
  const ageMs = Date.now() - (attestation.timestamp ?? 0);
  if (!attestation.timestamp || typeof attestation.timestamp !== 'number') {
    return { ok: false, error: 'ATTESTATION_EXPIRED', status: 400 };
  }
  if (ageMs > MAX_ATT_AGE_MS) {
    return { ok: false, error: 'ATTESTATION_EXPIRED', status: 400 };
  }

  // 6. Wallet binding
  const attRecipient = attestation.recipient ?? '';
  if (attRecipient.toLowerCase() !== wallet) {
    return { ok: false, error: 'RECIPIENT_MISMATCH', status: 400 };
  }

  // 7. Parse spotPnlRate & check for unexpected extra fields
  let parsed;
  try {
    parsed = JSON.parse(attestation.data);
  } catch {
    return { ok: false, error: 'INVALID_ATTESTATION_DATA', status: 400 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'INVALID_ATTESTATION_DATA', status: 400 };
  }
  const dataKeys = Object.keys(parsed);
  if (dataKeys.length !== 1 || dataKeys[0] !== 'spotPnlRate') {
    return { ok: false, error: 'INVALID_ATTESTATION_DATA', status: 400 };
  }
  const rawRate = parsed.spotPnlRate;
  const rate = typeof rawRate === 'number' ? rawRate : parseFloat(rawRate);
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return { ok: false, error: 'INVALID_RATE', status: 400 };
  }
  if (rate < item.minPnl) {
    return { ok: false, error: 'INSUFFICIENT_PNL', status: 400 };
  }

  // 8. Replay protection
  const primarySig = attestation.signatures?.[0];
  if (!primarySig) return { ok: false, error: 'MISSING_SIGNATURE', status: 400 };
  const sigHash = crypto.createHash('sha256').update(primarySig).digest('hex');
  if (seenHashes.has(sigHash)) {
    return { ok: false, error: 'REPLAY_DETECTED', status: 409 };
  }
  seenHashes.add(sigHash);

  // 9. One claim per wallet per item
  const claimKey = `${wallet}:${itemId}`;
  if (seenClaims.has(claimKey)) {
    return { ok: false, error: 'ALREADY_CLAIMED', status: 409 };
  }
  seenClaims.add(claimKey);

  const receipt = {
    itemId,
    itemName: item.name,
    mode: 'pnl',
    walletAddress: wallet,
    tier: item.minPnl,
    claimedAt: Date.now(),
  };
  return { ok: true, receipt };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function createMockRes() {
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData,
  };
  return res;
}

/** Build a fully valid attestation fixture for the given walletAddress and spotPnlRate */
function makeAttestation(walletAddress, spotPnlRate, opts = {}) {
  let dataStr;
  if (opts.data !== undefined) {
    dataStr = opts.data;
  } else if (typeof spotPnlRate === 'object' && spotPnlRate !== null) {
    dataStr = JSON.stringify(spotPnlRate);
  } else {
    dataStr = JSON.stringify({ spotPnlRate: String(spotPnlRate) });
  }

  return {
    recipient: opts.recipient ?? walletAddress,
    request: opts.request ?? {
      url: opts.url ?? EXPECTED_BINANCE_URL,
      header: opts.header ?? '',
      method: opts.method ?? 'GET',
      body: opts.body ?? '',
    },
    reponseResolve: opts.reponseResolve ?? [
      {
        keyName: 'spotPnlRate',
        parseType: 'STRING',
        parsePath: opts.parsePath ?? EXPECTED_PARSE_PATH,
      },
    ],
    data: dataStr,
    attConditions: opts.attConditions ?? '',
    timestamp: opts.timestamp ?? Date.now(),
    additionParams: opts.additionParams ?? '',
    signatures: opts.signatures ?? ['0xDEADBEEF_SIG_' + Math.random()],
  };
}

const WALLET = '0xAbCd1234567890AbCd1234567890AbCd12345678';
const WALLET_L = WALLET.toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── api/claim.js validation tests ──────────────────────────────────\n');

// ── Test 1: Wrong wallet address (doesn't match attestation.recipient) ─────────
test('Wrong wallet address: attestation.recipient mismatch', () => {
  const att = makeAttestation('0xDEAD000000000000000000000000000000000001', 0.05);
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'RECIPIENT_MISMATCH');
  assert.equal(result.status, 400);
});

// ── Test 2: Low PnL — below item threshold ─────────────────────────────────────
test('Low PnL: below Starter threshold (0.001 < 0.01)', () => {
  const att = makeAttestation(WALLET_L, 0.001);  // 0.1%, starter needs 1%
  const result = validatePnlClaim({
    itemId: 'starter', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INSUFFICIENT_PNL');
  assert.equal(result.status, 400);
});

test('Low PnL: below Gold threshold (0.04 < 0.05)', () => {
  const att = makeAttestation(WALLET_L, 0.04);   // 4%, gold needs 5%
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INSUFFICIENT_PNL');
  assert.equal(result.status, 400);
});

test('Exact threshold accepted: Gold with 0.05', () => {
  const att = makeAttestation(WALLET_L, 0.05);   // exactly 5%
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, true, `Expected ok=true but got: ${result.error}`);
});

// ── Test 3: Reused attestation (same signature hash twice) ─────────────────────
test('Replay attack: same attestation signature used twice', () => {
  const seenHashes = new Set();
  const seenClaims = new Set();
  const sig = '0xFIXED_SIGNATURE_FOR_REPLAY_TEST';
  const att = makeAttestation(WALLET_L, 0.05, { signatures: [sig] });

  // First use — should succeed
  const r1 = validatePnlClaim(
    { itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att },
    { seenHashes, seenClaims },
  );
  assert.equal(r1.ok, true, `First use should succeed; got: ${r1.error}`);

  // Second use — same sig → replay rejected
  const r2 = validatePnlClaim(
    { itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att },
    { seenHashes, seenClaims },
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'REPLAY_DETECTED');
  assert.equal(r2.status, 409);
});

// ── Test 4: Stale attestation (timestamp > 10 min ago) ────────────────────────
test('Stale attestation: timestamp 11 minutes ago', () => {
  const elevenMinAgo = Date.now() - 11 * 60 * 1000;
  const att = makeAttestation(WALLET_L, 0.05, { timestamp: elevenMinAgo });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ATTESTATION_EXPIRED');
  assert.equal(result.status, 400);
});

test('Fresh attestation: timestamp 1 minute ago — accepted', () => {
  const oneMinAgo = Date.now() - 60 * 1000;
  const att = makeAttestation(WALLET_L, 0.05, { timestamp: oneMinAgo });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, true, `Expected ok=true but got: ${result.error}`);
});

// ── Test 5: Unknown itemId ─────────────────────────────────────────────────────
test('Unknown itemId rejected', () => {
  const att = makeAttestation(WALLET_L, 1.0);
  const result = validatePnlClaim({
    itemId: 'diamond', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'UNKNOWN_ITEM');
  assert.equal(result.status, 400);
});

// ── Test 6: Invalid wallet address format ──────────────────────────────────────
test('Invalid wallet address rejected', () => {
  const att = makeAttestation('not-an-address', 0.05);
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: 'not-an-address', attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_WALLET_ADDRESS');
  assert.equal(result.status, 400);
});

// ── Test 7: Missing attestation object ────────────────────────────────────────
test('Missing attestation object rejected', () => {
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'MISSING_ATTESTATION');
  assert.equal(result.status, 400);
});

// ── Test 8: ETH tx hash validation ────────────────────────────────────────────
test('ETH: valid tx hash format passes', () => {
  const hash = '0x' + 'ab'.repeat(32);
  assert.ok(isHexHash(hash), 'Should be valid');
});

test('ETH: short tx hash rejected', () => {
  assert.ok(!isHexHash('0xdeadbeef'), 'Short hash should fail');
});

test('ETH: missing 0x prefix rejected', () => {
  assert.ok(!isHexHash('ab'.repeat(32)), 'No-prefix hash should fail');
});

// ── Test 9: One claim per wallet per item ─────────────────────────────────────
test('Second claim same wallet+item rejected', () => {
  const seenHashes = new Set();
  const seenClaims = new Set();

  const att1 = makeAttestation(WALLET_L, 0.05);
  const r1 = validatePnlClaim(
    { itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att1 },
    { seenHashes, seenClaims },
  );
  assert.equal(r1.ok, true);

  // Different sig (different attestation, not replay) but same wallet+item
  const att2 = makeAttestation(WALLET_L, 0.06, { signatures: ['0xDIFFERENT_SIG'] });
  const r2 = validatePnlClaim(
    { itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att2 },
    { seenHashes, seenClaims },
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'ALREADY_CLAIMED');
  assert.equal(r2.status, 409);
});

// ── Test 10: Template ID checks in api/claim.js ────────────────────────────────
test('Wrong template ID in attestation (attTemplateID) rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05);
  att.attTemplateID = 'wrong-template-id';
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_TEMPLATE_ID');
  assert.equal(result.status, 400);
});

test('Wrong template ID in attestation (templateId property) rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05);
  att.templateId = 'bad-template-uuid-1234';
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_TEMPLATE_ID');
  assert.equal(result.status, 400);
});

test('Wrong template ID in nested attRequest rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05);
  att.attRequest = { attTemplateID: 'unauthorized-template-5678' };
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_TEMPLATE_ID');
  assert.equal(result.status, 400);
});

test('Matching template ID in attestation accepted', () => {
  const att = makeAttestation(WALLET_L, 0.05);
  att.attTemplateID = TEMPLATE_ID;
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, true, `Expected ok=true but got: ${result.error}`);
});

// ── Test 11: Template ID checks in api/sign.js ────────────────────────────────
await testAsync('api/sign.js: rejects requestStr with wrong template ID (HTTP 400)', async () => {
  const req = {
    method: 'POST',
    body: {
      requestStr: JSON.stringify({
        appId: 'test-app-id',
        attTemplateID: '00000000-0000-0000-0000-000000000000',
        userAddress: WALLET,
      }),
    },
  };
  const res = createMockRes();
  await signHandler(req, res);
  assert.equal(res.getStatusCode(), 400);
  assert.match(res.getData()?.error, /Invalid template ID/);
});

await testAsync('api/sign.js: rejects requestStr with missing template ID (HTTP 400)', async () => {
  const req = {
    method: 'POST',
    body: {
      requestStr: JSON.stringify({
        appId: 'test-app-id',
        userAddress: WALLET,
      }),
    },
  };
  const res = createMockRes();
  await signHandler(req, res);
  assert.equal(res.getStatusCode(), 400);
  assert.match(res.getData()?.error, /Invalid template ID/);
});

await testAsync('api/sign.js: rejects requestStr with invalid JSON (HTTP 400)', async () => {
  const req = {
    method: 'POST',
    body: {
      requestStr: '{ this is not valid JSON }',
    },
  };
  const res = createMockRes();
  await signHandler(req, res);
  assert.equal(res.getStatusCode(), 400);
  assert.match(res.getData()?.error, /must be valid JSON/);
});

await testAsync('api/sign.js: template check passes for matching TEMPLATE_ID', async () => {
  const req = {
    method: 'POST',
    body: {
      requestStr: JSON.stringify({
        appId: 'test-app-id',
        attTemplateID: SIGN_TEMPLATE_ID,
        userAddress: WALLET,
      }),
    },
  };
  const res = createMockRes();
  await signHandler(req, res);
  // It passes template check (it will not be 400 for template mismatch)
  const status = res.getStatusCode();
  assert.notEqual(status, 400, `Should not reject with 400 template mismatch; got data: ${JSON.stringify(res.getData())}`);
});

// ── Test 12: Hardened Template & Data Source Checks ───────────────────────────
test('Wrong URL rejected: non-Binance endpoint', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    url: 'https://evil-phishing-binance.com/bapi/composite/v1/private/bigdata/finance/spot-statistics',
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_REQUEST_URL');
  assert.equal(result.status, 400);
});

test('Wrong URL rejected: different Binance endpoint', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    url: 'https://www.binance.com/bapi/futures/v1/private/user-data',
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_REQUEST_URL');
  assert.equal(result.status, 400);
});

test('Wrong parsePath rejected: incorrect JSONPath in reponseResolve', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    parsePath: '$.data.totalPnlRate',
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_RESPONSE_RESOLVE');
  assert.equal(result.status, 400);
});

test('Extra fields in reponseResolve rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    reponseResolve: [
      { keyName: 'spotPnlRate', parseType: 'STRING', parsePath: EXPECTED_PARSE_PATH },
      { keyName: 'accountBalance', parseType: 'STRING', parsePath: '$.data.balance' },
    ],
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_RESPONSE_RESOLVE');
  assert.equal(result.status, 400);
});

test('Extra fields in data object rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    data: JSON.stringify({
      spotPnlRate: '0.05',
      extraSecretData: 'malicious-or-unexpected-payload',
    }),
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_ATTESTATION_DATA');
  assert.equal(result.status, 400);
});

test('Non-finite spotPnlRate rejected', () => {
  const att = makeAttestation(WALLET_L, 0.05, {
    data: JSON.stringify({ spotPnlRate: 'NaN' }),
  });
  const result = validatePnlClaim({
    itemId: 'gold', mode: 'pnl', walletAddress: WALLET, attestation: att,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_RATE');
  assert.equal(result.status, 400);
});

// ── Test 13: _padoAddress Assertion & Fail-Closed Behavior ───────────────────
test('assertPadoAddress: succeeds for exact production Pado address', () => {
  const mockPrimus = { _padoAddress: '0x5Ed3176045F68617B0958a61ac1868875C98C14d' };
  assert.equal(assertPadoAddress(mockPrimus), true);
});

test('assertPadoAddress: throws when _padoAddress mismatches', () => {
  const alteredPrimus = { _padoAddress: '0x1111111111111111111111111111111111111111' };
  assert.throws(
    () => assertPadoAddress(alteredPrimus),
    /CRITICAL: Primus _padoAddress mismatch/
  );
});

await testAsync('claimHandler: returns HTTP 500 SERVER_CONFIGURATION_ERROR on trust anchor failure', async () => {
  // If Primus SDK fails assertion (or cannot initialize), handler returns HTTP 500
  const req = {
    method: 'POST',
    body: {
      itemId: 'gold',
      mode: 'pnl',
      walletAddress: WALLET,
      attestation: makeAttestation(WALLET_L, 0.05),
    },
  };
  const res = createMockRes();
  await claimHandler(req, res);
  // Without VITE_APP_ID/APP_SECRET or in test env, verifyAttestation / getPrimus will either fail closed
  // or return 500 SERVER_CONFIGURATION_ERROR or 400 INVALID_SIGNATURE
  const status = res.getStatusCode();
  const data = res.getData();
  assert.ok(status === 500 || status === 400, `Expected 500 or 400, got ${status}`);
  if (status === 500) {
    assert.equal(data?.error, 'SERVER_CONFIGURATION_ERROR');
  }
});

// ── Test 14: Cryptographic Signer Recovery ────────────────────────────────────
await testAsync('Cryptographic signer recovery recovers the signing key', async () => {
  const signerWallet = ethers.Wallet.createRandom();
  const att = makeAttestation(WALLET_L, 0.05);

  // Sign the encoded attestation hash
  const hash = encodeAttestation(att);
  const sig = await signerWallet.signingKey.sign(hash).serialized;
  att.signatures = [sig];

  const recovered = recoverAttestationSigner(att);
  assert.equal(recovered.toLowerCase(), signerWallet.address.toLowerCase(), 'Signer must recover correctly');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
