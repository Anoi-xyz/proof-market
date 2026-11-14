/**
 * ItemCard.jsx — ProofMarket item card
 *
 * Props:
 *   item       {object}   — { id, name, priceUsd, minPnl }
 *   onPayEth   {fn}       — called when "Pay with Sepolia" is clicked
 *   onProvePnl {fn}       — called when "Prove with PnL" is clicked
 *   disabled   {boolean}  — disable both buttons (e.g. wallet not connected)
 */

import React from 'react';

/** Tier badge colour by id */
const TIER_COLORS = {
  starter:  '#6b7280',  // grey
  silver:   '#94a3b8',  // slate
  gold:     '#f59e0b',  // amber
  platinum: '#a855f7',  // purple
};

export default function ItemCard({ item, onPayEth, onProvePnl, disabled }) {
  const tierColor = TIER_COLORS[item.id] ?? 'var(--acc)';
  const pnlPct    = (item.minPnl * 100).toFixed(0);

  return (
    <article className="item-card" aria-label={`${item.name} tier`}>
      {/* Tier badge */}
      <div
        className="item-card-badge"
        style={{ background: tierColor }}
        aria-label={`${item.name} tier`}
      >
        {item.name}
      </div>

      {/* Price */}
      <div className="item-card-price" aria-label={`Price: $${item.priceUsd}`}>
        ${item.priceUsd}
        <span className="item-card-price-unit">USD</span>
      </div>

      {/* Requirement */}
      <p className="item-card-req">
        needs verified PnL of at least{' '}
        <strong style={{ color: 'var(--pos)' }}>+{pnlPct}%</strong>
      </p>

      <hr className="item-card-divider" />

      {/* CTA buttons */}
      <div className="item-card-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onPayEth(item)}
          disabled={disabled}
          aria-label={`Pay with Sepolia ETH for ${item.name}`}
        >
          💎 Pay with Sepolia
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => onProvePnl(item)}
          disabled={disabled}
          aria-label={`Prove PnL for ${item.name}`}
        >
          🔒 Prove with PnL
        </button>
      </div>
    </article>
  );
}
