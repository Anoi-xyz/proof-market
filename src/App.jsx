/**
 * App.jsx — ProofMarket root component
 *
 * Layout:  UsernameGate → StickyNav → MarketPage → Footer
 *
 * Wallet state lives here and is passed down.
 * CheckoutModal + ReceiptCard are managed here.
 */

import React, { useState, useCallback, useEffect } from 'react';
import StickyNav      from './components/StickyNav.jsx';
import Footer         from './components/Footer.jsx';
import UsernameGate   from './components/UsernameGate.jsx';
import MarketPage     from './pages/MarketPage.jsx';
import CheckoutModal  from './components/CheckoutModal.jsx';
import ReceiptCard    from './components/ReceiptCard.jsx';
import useWallet      from './hooks/useWallet.js';
import { useTheme }   from './hooks/useTheme.js';

const USERNAME_KEY = 'ppnl_username';

export default function App() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const { theme, toggleTheme } = useTheme();

  // ── Username gate ──────────────────────────────────────────────────────────
  const [username,  setUsername]  = useState(() => localStorage.getItem(USERNAME_KEY) ?? '');
  const [gatePhase, setGatePhase] = useState(() =>
    localStorage.getItem(USERNAME_KEY) ? 'done' : 'show',
  );

  const handleGateSubmit = useCallback((name) => {
    localStorage.setItem(USERNAME_KEY, name);
    setUsername(name);
    setGatePhase('fading');
    setTimeout(() => setGatePhase('done'), 520);
  }, []);

  const handleChangeUsername = useCallback(() => setGatePhase('show'), []);

  // ── Wallet ─────────────────────────────────────────────────────────────────
  const wallet = useWallet();

  // ── Checkout modal state ───────────────────────────────────────────────────
  // { item, mode }  or  null when closed
  const [checkout, setCheckout] = useState(null);

  // After a successful claim:  { receipt, item, mode, attestation }  or  null
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
    // Stash the full attestation that was submitted so ReceiptCard can display
    // attestor address / signature. We read it from CheckoutModal's closure via
    // a custom event emitted before calling onComplete, OR we grab it from the
    // last checkout context.
    setClaimResult({
      receipt,
      item: checkout?.item,
      mode: checkout?.mode,
      // Note: the attestation object itself is not in `receipt` (server strips it).
      // ReceiptCard accepts it as a separate optional prop; in the ETH flow it's null.
      // For the PnL flow, the CheckoutModal can pass it via a ref/state trick but
      // since we don't want to expose PnL rate to the UI, we keep attestation null here.
      // The ReceiptCard will gracefully skip those fields when attestation is null.
      attestation: null,
    });
    setCheckout(null);
  }, [checkout]);

  const handleReceiptClose = useCallback(() => setClaimResult(null), []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Username gate overlay */}
      {gatePhase !== 'done' && (
        <UsernameGate fading={gatePhase === 'fading'} onSubmit={handleGateSubmit} />
      )}

      {/* Fixed dot-grid / glow background */}
      <div className="bgl" aria-hidden="true" />

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
          onClick={(e) => { if (e.target === e.currentTarget) handleReceiptClose(); }}
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
