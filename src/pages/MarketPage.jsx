/**
 * MarketPage.jsx — The main ProofMarket grid page
 *
 * Shows 4 item cards. Requires wallet to be connected to open checkout.
 *
 * Props:
 *   wallet    {object}  — from useWallet() hook
 *   onPayEth  {fn}      — (item) => void — open ETH checkout
 *   onProvePnl {fn}     — (item) => void — open PnL checkout
 */

import React from 'react';
import { ITEMS } from '../items.js';
import ItemCard from '../components/ItemCard.jsx';

export default function MarketPage({ wallet, onPayEth, onProvePnl }) {
  const isConnected = !!wallet?.address;

  return (
    <main className="market" id="market" aria-label="ProofMarket">

      {/* Hero header */}
      <div className="market-hero">
        <h1 className="market-title">
          Proof<span style={{ color: 'var(--acc)' }}>Market</span>
        </h1>
        <p className="market-subtitle">
          Claim items by paying testnet ETH — or by proving your Binance PnL
          with <strong>Primus zkTLS</strong>, no screenshot needed.
        </p>

        {!isConnected && (
          <p className="market-connect-hint">
            👇 Connect your wallet in the nav to get started.
          </p>
        )}
      </div>

      {/* Item grid */}
      <div className="market-grid" role="list">
        {ITEMS.map((item) => (
          <div key={item.id} role="listitem">
            <ItemCard
              item={item}
              onPayEth={onPayEth}
              onProvePnl={onProvePnl}
              disabled={!isConnected}
            />
          </div>
        ))}
      </div>

      {/* Mode explanation */}
      <div className="market-explainer" aria-label="How the two modes work">
        <div className="market-mode">
          <span className="market-mode-icon">💎</span>
          <div>
            <strong>Pay with Sepolia ETH</strong>
            <p>Send 0.001 testnet ETH to our Sepolia address. No PnL check.</p>
          </div>
        </div>
        <div className="market-mode">
          <span className="market-mode-icon">🔒</span>
          <div>
            <strong>Prove with PnL</strong>
            <p>
              Use Primus zkTLS to cryptographically prove your Binance spot PnL
              meets the tier threshold — no money changes hands.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
