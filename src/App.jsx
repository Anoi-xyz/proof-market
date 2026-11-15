/**
 * App.jsx — ProofMarket root component
 *
 * Flow:
 *   Landing (exchange carousel) → UsernameGate → StickyNav → MarketPage → Footer
 *
 * - Landing is shown when there is no saved username.
 * - Returning users skip the landing straight to the market.
 * - "Change username" in nav re-opens UsernameGate, not the landing.
 * - Selecting Binance stores "binance" in sessionStorage (proofmarket_exchange).
 * - Zero wallet code/prompts run on the landing page.
 */

import React, { useState, useCallback, useEffect } from 'react';
import LandingPage    from './pages/LandingPage.jsx';
import StickyNav      from './components/StickyNav.jsx';
import Footer         from './components/Footer.jsx';
import UsernameGate   from './components/UsernameGate.jsx';
import MarketPage     from './pages/MarketPage.jsx';
import CheckoutModal  from './components/CheckoutModal.jsx';
import ReceiptCard    from './components/ReceiptCard.jsx';
import useWallet      from './hooks/useWallet.js';
import { useTheme }   from './hooks/useTheme.js';

const USERNAME_KEY = 'ppnl_username';
const EXCHANGE_STORAGE_KEY = 'proofmarket_exchange';

function MarketView({ username, setUsername, theme, toggleTheme }) {
  // ── Username gate ──────────────────────────────────────────────────────────
  const [gatePhase, setGatePhase] = useState(() =>
    localStorage.getItem(USERNAME_KEY) ? 'done' : 'show',
  );

  const handleGateSubmit = useCallback((name) => {
    localStorage.setItem(USERNAME_KEY, name);
    setUsername(name);
    setGatePhase('fading');
    setTimeout(() => setGatePhase('done'), 520);
  }, [setUsername]);

  const handleChangeUsername = useCallback(() => setGatePhase('show'), []);

  // ── Wallet ─────────────────────────────────────────────────────────────────
  const wallet = useWallet();

  // ── Checkout modal state ───────────────────────────────────────────────────
  const [checkout, setCheckout] = useState(null);

  // Automatically close checkout if wallet disconnects
  useEffect(() => {
    if (!wallet.address) {
      setCheckout(null);
    }
  }, [wallet.address]);

  // After a successful claim: { receipt, item, mode, attestation } or null
  const [claimResult, setClaimResult] = useState(null);

  const handlePayEth = useCallback((item) => {
    setClaimResult(null);
    setCheckout({ item, mode: 'eth' });
  }, []);

  const handleProvePnl = useCallback((item) => {
    setClaimResult(null);
    setCheckout({ item, mode: 'pnl' });
  }, []);

  const handleCheckoutClose = useCallback(() => setCheckout(null), []);

  const handleCheckoutComplete = useCallback((receipt) => {
    setClaimResult({
      receipt,
      item: checkout?.item,
      mode: checkout?.mode,
      attestation: null,
    });
    setCheckout(null);
  }, [checkout]);

  const handleReceiptClose = useCallback(() => setClaimResult(null), []);

  return (
    <>
      {/* Username gate overlay */}
      {gatePhase !== 'done' && (
        <UsernameGate fading={gatePhase === 'fading'} onSubmit={handleGateSubmit} />
      )}

      {/* Fixed dot-grid / glow background */}
      <div className="bgl" aria-hidden="true" />

      {/* Testnet Demo Banner */}
      <div className="demo-top-banner" role="banner">
        <span className="demo-banner-pill">Notice</span>
        <span>Testnet demo, built for the Primus zkTLS challenge</span>
      </div>

      {/* Navigation */}
      <StickyNav
        username={username}
        onChangeUsername={handleChangeUsername}
        theme={theme}
        onToggleTheme={toggleTheme}
        wallet={wallet}
        onConnectWallet={wallet.connect}
      />

      {/* Main content */}
      <MarketPage
        wallet={wallet}
        onPayEth={handlePayEth}
        onProvePnl={handleProvePnl}
      />

      <Footer />

      {/* Checkout modal */}
      {checkout && (
        <CheckoutModal
          item={checkout.item}
          mode={checkout.mode}
          wallet={wallet}
          onClose={handleCheckoutClose}
          onComplete={handleCheckoutComplete}
        />
      )}

      {/* Receipt overlay */}
      {claimResult && (
        <div
          className="checkout-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Claim receipt"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleReceiptClose();
          }}
        >
          <div className="checkout-card">
            <button
              type="button"
              className="checkout-close"
              onClick={handleReceiptClose}
              aria-label="Close receipt"
            >
              ×
            </button>
            <ReceiptCard
              receipt={claimResult.receipt}
              item={claimResult.item}
              mode={claimResult.mode}
              walletAddress={wallet.address}
              attestation={claimResult.attestation}
              onClose={handleReceiptClose}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '');

  // Show landing only when there is no saved username. Returning users skip straight to the market.
  const [landingDismissed, setLandingDismissed] = useState(() =>
    Boolean(localStorage.getItem(USERNAME_KEY))
  );

  const handleLandingContinue = useCallback(() => {
    sessionStorage.setItem(EXCHANGE_STORAGE_KEY, 'binance');
    setLandingDismissed(true);
  }, []);

  if (!landingDismissed) {
    return <LandingPage onContinue={handleLandingContinue} />;
  }

  return (
    <MarketView
      username={username}
      setUsername={setUsername}
      theme={theme}
      toggleTheme={toggleTheme}
    />
  );
}
