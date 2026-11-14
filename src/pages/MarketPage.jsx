/**
 * MarketPage.jsx — The main ProofMarket grid page
 *
 * Shows 4 item cards. Requires wallet to be connected to open checkout.
 * Includes an About section explaining what the site does and its security model.
 *
 * Props:
 *   wallet     {object}  — from useWallet() hook
 *   onPayEth   {fn}      — (item) => void — open ETH checkout
 *   onProvePnl {fn}      — (item) => void — open PnL checkout
 */

import React from 'react';
import { ITEMS, SEPOLIA_ETH_AMOUNT } from '../items.js';
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
            <p>Send {SEPOLIA_ETH_AMOUNT} testnet ETH on Sepolia. No PnL verification needed.</p>
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

      {/* About Section */}
      <section id="about" className="market-about" aria-labelledby="about-title">
        <div className="about-header">
          <span className="about-pill">About the Demo</span>
          <h2 id="about-title" className="about-title">
            What is ProofMarket?
          </h2>
          <p className="about-intro">
            ProofMarket is a testnet demo built for the <strong>Primus zkTLS challenge</strong>.
            It demonstrates how zero-knowledge TLS proofs can transform off-chain Web2 data into
            verifiable on-chain credentials for digital commerce without exposing sensitive credentials.
          </p>
        </div>

        <div className="about-grid">
          <div className="about-card">
            <div className="about-card-icon">⚡</div>
            <h3>Credential-Backed Access</h3>
            <p>
              Instead of paying with money or relying on easily faked screenshots, users qualify for
              items by cryptographically proving that their verified Binance spot PnL meets a required
              threshold (+1%, +3%, +5%, +10%).
            </p>
          </div>

          <div className="about-card">
            <div className="about-card-icon">🔐</div>
            <h3>How Primus zkTLS Works</h3>
            <p>
              The Primus browser extension attests to TLS data exchange directly with Binance's official API
              endpoints. The proof reveals only the targeted data field (<code>spotPnlRate</code>).
              Account credentials, cookies, and balances remain completely private on your machine.
            </p>
          </div>

          <div className="about-card">
            <div className="about-card-icon">🛡️</div>
            <h3>Strict Server Verification</h3>
            <p>
              The server validates the cryptographic attestor signature, checks exact Binance API endpoints,
              ensures the proof is fresh (&lt;10 min), verifies it was issued to your connected wallet, and
              enforces replay protection.
            </p>
          </div>

          <div className="about-card">
            <div className="about-card-icon">✨</div>
            <h3>Zero Wallet Risk</h3>
            <p>
              ProofMarket never requests wallet connections on load, never uses signature requests
              (<code>personal_sign</code> or typed data), and never asks for token approvals. The only wallet actions
              are connection and the explicit testnet ETH transfer.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
