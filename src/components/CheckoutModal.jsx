/**
 * CheckoutModal.jsx — Checkout flow modal
 *
 * Props:
 *   item        {object}   — { id, name, priceUsd, minPnl }
 *   mode        {string}   — 'eth' | 'pnl'
 *   wallet      {object}   — from useWallet() (address, sendPayment)
 *   onClose     {fn}       — close without completing
 *   onComplete  {fn}       — (receipt) => void — called after successful claim
 */

import React, { useState, useCallback, useEffect } from 'react';
import useMarketAttestation from '../hooks/useMarketAttestation.js';
import { SEPOLIA_ETH_AMOUNT } from '../items.js';

/** Receiver address for Sepolia ETH payments — from env or fallback placeholder */
const RECEIVER_ADDRESS = import.meta.env.VITE_RECEIVER_ADDRESS ?? '';

// ── Progress step labels ───────────────────────────────────────────────────────

const ETH_STEPS = [
  'Connect',      // 0 — not really used but kept for index alignment
  'Sending…',     // 1
  'Confirming…',  // 2
  'Done ✓',       // 3
];

const PNL_STEPS = [
  'Init',          // 0
  'SDK ready',     // 1
  'Building params', // 2
  'Signing…',      // 3
  'Attesting…',    // 4
  'Submitting…',   // 5
  'Done ✓',        // 6
];

const REASON_CODE_MAP = {
  INSUFFICIENT_PNL: 'Your verified Binance PnL does not meet the minimum requirement for this tier.',
  ALREADY_CLAIMED: 'This item has already been claimed by this wallet.',
  REPLAY_DETECTED: 'This attestation proof has already been used.',
  ATTESTATION_EXPIRED: 'Attestation expired. Please generate a fresh proof.',
  RECIPIENT_MISMATCH: 'Attestation recipient does not match your connected wallet.',
  INVALID_SIGNATURE: 'Attestation signature verification failed.',
  INVALID_REQUEST_URL: 'Attestation endpoint does not match the Binance spot statistics URL.',
  INVALID_RESPONSE_RESOLVE: 'Attestation fields do not match the expected template schema.',
  INVALID_ATTESTATION_DATA: 'Attestation data payload is invalid.',
  INVALID_RATE: 'PnL rate in attestation is not a valid number.',
  INVALID_TEMPLATE_ID: 'Attestation template ID does not match the required template.',
  UNKNOWN_ITEM: 'Selected item is not recognized.',
  INVALID_WALLET_ADDRESS: 'Connected wallet address is invalid.',
  INVALID_TX_HASH: 'Transaction hash format is invalid.',
  MISSING_ATTESTATION: 'Attestation object was missing in request.',
  SERVER_CONFIGURATION_ERROR: 'Server configuration error. Please try again later.',
};

/** Human-readable error messages by code */
function friendlyError(err) {
  const code = err?.code ?? '';
  const msg  = err?.message ?? 'Unknown error';
  if (code === 'NO_EXTENSION')    return 'Primus extension not found. Install it from the Chrome Web Store first.';
  if (code === 'USER_CANCELLED')  return 'You cancelled the attestation. Try again when ready.';
  if (code === 'SIGNING_FAILED')  return `Signing failed: ${msg}`;
  if (code === 'NO_WALLET')       return 'No wallet connected. Please connect MetaMask first.';
  if (code === 'ATTESTATION_FAILED') return `Attestation failed: ${msg}`;
  if (REASON_CODE_MAP[msg])       return REASON_CODE_MAP[msg];
  if (msg.includes('insufficient funds')) return 'Insufficient Sepolia ETH balance.';
  if (msg.includes('user rejected'))      return 'Transaction rejected in wallet.';
  return msg;
}

// ── ETH Checkout ─────────────────────────────────────────────────────────────

function EthCheckout({ item, wallet, onComplete, onClose }) {
  const [phase,  setPhase]  = useState('idle');  // idle | sending | confirming | done
  const [txHash, setTxHash] = useState(null);
  const [err,    setErr]    = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCopyReceiver = useCallback(() => {
    if (!RECEIVER_ADDRESS) return;
    navigator.clipboard?.writeText(RECEIVER_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  const handlePay = useCallback(async () => {
    setErr(null);
    setPhase('sending');
    try {
      if (!RECEIVER_ADDRESS) {
        throw new Error('VITE_RECEIVER_ADDRESS is not configured. Set it in .env.');
      }
      setPhase('confirming');
      const hash = await wallet.sendPayment(RECEIVER_ADDRESS, SEPOLIA_ETH_AMOUNT);
      setTxHash(hash);
      setPhase('submitting');

      // POST to /api/claim
      const res = await fetch('/api/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          itemId:        item.id,
          mode:          'eth',
          txHash:        hash,
          walletAddress: wallet.address,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      setPhase('done');
      onComplete(json.receipt);
    } catch (e) {
      setErr(e);
      setPhase('idle');
    }
  }, [item, wallet, onComplete]);

  const phaseIndex = { idle: 0, sending: 1, confirming: 2, submitting: 2, done: 3 }[phase] ?? 0;
  const busy = phase !== 'idle' && phase !== 'done';

  return (
    <div className="checkout-inner">
      <h2 className="checkout-title">Pay with Sepolia ETH</h2>

      {/* Testnet security notice */}
      <div className="payment-testnet-banner" role="note">
        <span className="payment-testnet-badge">Testnet</span>
        <strong>Sepolia testnet demo. No real funds.</strong>
      </div>

      <p className="checkout-desc">
        Review the transaction details before confirming in your wallet:
      </p>

      {/* Confirmation details */}
      <div className="payment-confirm-box" aria-label="Transaction confirmation details">
        <div className="confirm-row">
          <span className="confirm-label">Item</span>
          <span className="confirm-val">{item.name}</span>
        </div>
        <div className="confirm-row">
          <span className="confirm-label">Network</span>
          <span className="confirm-val">Sepolia Testnet (11155111)</span>
        </div>
        <div className="confirm-row">
          <span className="confirm-label">Amount</span>
          <span className="confirm-val confirm-amount">{SEPOLIA_ETH_AMOUNT} Sepolia ETH</span>
        </div>
        <div className="confirm-row confirm-row--col">
          <div className="confirm-row-header">
            <span className="confirm-label">Receiver Address</span>
            <button
              type="button"
              className="confirm-copy-btn"
              onClick={handleCopyReceiver}
              title="Copy receiver address"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
          <div className="confirm-address-display" title={RECEIVER_ADDRESS}>
            {RECEIVER_ADDRESS || '(VITE_RECEIVER_ADDRESS not configured)'}
          </div>
        </div>
      </div>

      {/* Progress steps */}
      <div className="progress-steps" aria-label="Payment progress">
        {['Ready', 'Sending', 'Confirming', 'Claimed'].map((label, i) => (
          <div
            key={label}
            className={`progress-step${phaseIndex === i ? ' active' : ''}${phaseIndex > i ? ' done' : ''}`}
          >
            <div className="progress-dot" />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {err && (
        <div className="checkout-error" role="alert">
          ⚠️ {friendlyError(err)}
        </div>
      )}

      {txHash && (
        <p className="checkout-tx">
          TX:{' '}
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="checkout-tx-link"
          >
            {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </a>
        </p>
      )}

      <div className="checkout-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handlePay}
          disabled={busy || phase === 'done' || !RECEIVER_ADDRESS}
        >
          {busy ? '⏳ Processing…' : phase === 'done' ? '✓ Claimed!' : `Confirm & Pay (${SEPOLIA_ETH_AMOUNT} ETH)`}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── PnL Checkout ─────────────────────────────────────────────────────────────

function PnlCheckout({ item, wallet, onComplete, onClose }) {
  const [phase,       setPhase]       = useState('idle');
  const [stepIndex,   setStepIndex]   = useState(0);
  const [err,         setErr]         = useState(null);

  const { startAttestation } = useMarketAttestation(wallet?.address);

  const handleProve = useCallback(async () => {
    setErr(null);
    setPhase('running');
    setStepIndex(0);

    try {
      // Run attestation; onStep receives 0-4 from the hook
      const attestation = await startAttestation((step) => setStepIndex(step));

      // Step 5: submit claim
      setStepIndex(5);
      const res = await fetch('/api/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          itemId:        item.id,
          mode:          'pnl',
          attestation,
          walletAddress: wallet.address,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      setStepIndex(6);
      setPhase('done');
      onComplete(json.receipt);
    } catch (e) {
      setErr(e);
      setPhase('idle');
    }
  }, [item, wallet, startAttestation, onComplete]);

  const pnlPct = (item.minPnl * 100).toFixed(0);
  const busy   = phase === 'running';

  return (
    <div className="checkout-inner">
      <h2 className="checkout-title">Prove your PnL</h2>
      <p className="checkout-desc">
        Prove your Binance spot PnL is at least{' '}
        <strong style={{ color: 'var(--pos)' }}>+{pnlPct}%</strong> to claim{' '}
        <strong>{item.name}</strong>.
        <br />
        <span className="checkout-note">No money changes hands — just the proof.</span>
      </p>

      {/* Progress steps */}
      <div className="progress-steps" aria-label="Attestation progress">
        {PNL_STEPS.map((label, i) => (
          <div
            key={label}
            className={`progress-step${stepIndex === i && busy ? ' active' : ''}${(stepIndex > i || phase === 'done') && i < PNL_STEPS.length - 1 ? ' done' : ''}${phase === 'done' && i === PNL_STEPS.length - 1 ? ' done' : ''}`}
          >
            <div className="progress-dot" />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {err && (
        <div className="checkout-error" role="alert">
          ⚠️ {friendlyError(err)}
        </div>
      )}

      <div className="checkout-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handleProve}
          disabled={busy || phase === 'done'}
        >
          {busy ? '⏳ Generating proof…' : phase === 'done' ? '✓ Claimed!' : 'Start Proof'}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── CheckoutModal ─────────────────────────────────────────────────────────────

export default function CheckoutModal({ item, mode, wallet, onClose, onComplete }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="checkout-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Checkout — ${item.name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="checkout-card">
        {/* Close button */}
        <button
          type="button"
          className="checkout-close"
          onClick={onClose}
          aria-label="Close checkout"
        >
          ×
        </button>

        {mode === 'eth' ? (
          <EthCheckout item={item} wallet={wallet} onComplete={onComplete} onClose={onClose} />
        ) : (
          <PnlCheckout item={item} wallet={wallet} onComplete={onComplete} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
