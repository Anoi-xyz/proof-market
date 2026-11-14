/**
 * ReceiptCard.jsx — Success receipt shown after a claim
 *
 * Props:
 *   receipt       {object}  — from /api/claim response
 *   item          {object}  — { id, name, priceUsd, minPnl }
 *   mode          {string}  — 'eth' | 'pnl'
 *   walletAddress {string}  — connected wallet address
 *   onClose       {fn}      — close the modal
 *   onDownload    {fn}      — download the card as image (html2canvas)
 *
 * Attestation shape (Primus SDK v0.3.x):
 *   attestation.recipient        — wallet address
 *   attestation.timestamp        — ms timestamp
 *   attestation.signatures[0]   — primary signature
 *   attestation.attestors[0].attestorAddr — first attestor address
 *   attestation.data             — JSON string containing spotPnlRate
 */

import React, { useRef, useCallback } from 'react';
import { shortAddr } from '../hooks/useWallet.js';

/** Format a unix-ms timestamp for display */
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year:   'numeric', month:  'short',  day:    'numeric',
    hour:   '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Tier badge colour */
const TIER_COLORS = {
  starter:  '#6b7280',
  silver:   '#94a3b8',
  gold:     '#f59e0b',
  platinum: '#a855f7',
};

export default function ReceiptCard({
  receipt, item, mode, walletAddress, attestation, onClose, onDownload,
}) {
  const cardRef = useRef(null);

  const handleDownload = useCallback(async () => {
    if (onDownload) { onDownload(cardRef.current); return; }
    // Built-in html2canvas fallback
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, { useCORS: true, scale: 2 });
      const link   = document.createElement('a');
      link.download = `proofmarket-${item.id}-receipt.png`;
      link.href     = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[ReceiptCard] download failed:', e);
    }
  }, [item, onDownload]);

  const tierColor = TIER_COLORS[item.id] ?? 'var(--acc)';
  const pnlPct    = (item.minPnl * 100).toFixed(0);

  // PnL mode extras — use the new Attestation shape
  const attestorAddr = attestation?.attestors?.[0]?.attestorAddr ?? null;
  const signature    = attestation?.signatures?.[0] ?? null;

  return (
    <div className="receipt-wrap" role="dialog" aria-label="Claim receipt" aria-modal="true">
      {/* Downloadable card */}
      <div className="receipt-card" ref={cardRef}>
        {/* Header */}
        <div className="receipt-header">
          <span className="receipt-logo">Proof<span style={{ color: 'var(--acc)' }}>Market</span></span>
          <span
            className="receipt-tier-badge"
            style={{ background: tierColor }}
          >
            {item.name}
          </span>
        </div>

        {/* Claim type */}
        <div className="receipt-mode">
          {mode === 'pnl' ? (
            <>🔒 Claimed with <strong>verified PnL</strong></>
          ) : (
            <>💎 Paid with <strong>Sepolia ETH</strong></>
          )}
        </div>

        <hr className="receipt-divider" />

        {/* Detail rows */}
        <dl className="receipt-details">
          <dt>Wallet</dt>
          <dd title={walletAddress}>{shortAddr(walletAddress)}</dd>

          {mode === 'pnl' && (
            <>
              <dt>Tier met</dt>
              <dd style={{ color: 'var(--pos)' }}>≥ +{pnlPct}%</dd>

              {attestorAddr && (
                <>
                  <dt>Attestor</dt>
                  <dd title={attestorAddr}>{shortAddr(attestorAddr)}</dd>
                </>
              )}

              {signature && (
                <>
                  <dt>Signature</dt>
                  <dd
                    className="receipt-mono"
                    title={signature}
                  >
                    {signature.slice(0, 10)}…{signature.slice(-8)}
                  </dd>
                </>
              )}
            </>
          )}

          {mode === 'eth' && receipt?.txHash && (
            <>
              <dt>TX Hash</dt>
              <dd className="receipt-mono" title={receipt.txHash}>
                {receipt.txHash.slice(0, 10)}…{receipt.txHash.slice(-8)}
              </dd>
            </>
          )}

          <dt>Date</dt>
          <dd>{fmtDate(receipt?.claimedAt)}</dd>
        </dl>

        {/* Footer */}
        <div className="receipt-footer">
          built by <strong>anoi</strong> · powered by Primus zkTLS
        </div>
      </div>

      {/* Action buttons — outside the downloadable card */}
      <div className="receipt-actions">
        <button type="button" className="btn-primary" onClick={handleDownload}>
          ⬇ Download Receipt
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
