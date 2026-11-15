import React, { useState, useRef, useEffect, useCallback } from 'react';
import ExchangeCarousel from '../components/ExchangeCarousel.jsx';
import '../styles/landing.css';

export default function LandingPage({ onContinue, onBackToMarket, canBackToMarket = false }) {
  const [selectedExchange, setSelectedExchange] = useState(null);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const primaryBtnRef = useRef(null);
  const backBtnRef = useRef(null);

  const handleSelectExchange = useCallback((exchange, triggerEl) => {
    triggerRef.current = triggerEl;
    setSelectedExchange(exchange);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedExchange(null);
    // Return focus to the triggering card
    setTimeout(() => {
      triggerRef.current?.focus();
    }, 10);
  }, []);

  const handleContinue = useCallback(() => {
    if (selectedExchange?.isLive && onContinue) {
      onContinue();
    }
  }, [selectedExchange, onContinue]);

  // Dialog keyboard handling: Escape to close and focus trapping
  useEffect(() => {
    if (!selectedExchange) return;

    // Auto-focus the appropriate button
    if (selectedExchange.isLive && primaryBtnRef.current) {
      primaryBtnRef.current.focus();
    } else if (backBtnRef.current) {
      backBtnRef.current.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClosePanel();
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusables = dialog.querySelectorAll('button:not([disabled])');
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedExchange, handleClosePanel]);

  return (
    <div className="landing-page">
      <div className="bgl" aria-hidden="true" />

      <header className="landing-header">
        <div className="landing-brand">
          Proof<i>Market</i>
        </div>
        <div className="landing-header-actions">
          {canBackToMarket && (
            <button
              type="button"
              className="landing-back-market-btn"
              onClick={onBackToMarket}
              aria-label="Back to market"
            >
              ← Back to market
            </button>
          )}
          <div className="landing-pill">Powered by Primus zkTLS</div>
        </div>
      </header>

      <ExchangeCarousel
        onSelectExchange={handleSelectExchange}
        isPanelOpen={Boolean(selectedExchange)}
      />

      <div className="landing-copy">
        <h1>Prove it on any exchange.</h1>
        <p>Pick your exchange to begin. Your login and balances stay private.</p>
      </div>

      {selectedExchange && (
        <div
          className="landing-sheet"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClosePanel();
            }
          }}
        >
          <div
            ref={dialogRef}
            className="landing-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="landing-panel-title"
            aria-describedby="landing-panel-desc"
          >
            <h2 id="landing-panel-title">
              {selectedExchange.isLive
                ? `Prove with ${selectedExchange.name}`
                : `${selectedExchange.name} is unavailable at the moment`}
            </h2>

            <p id="landing-panel-desc">
              {selectedExchange.isLive
                ? 'You will verify your 30-day spot PnL rate with Primus zkTLS. Your login and balances stay private.'
                : 'Only Binance is live right now. More exchanges are coming.'}
            </p>

            <div className="landing-acts">
              {selectedExchange.isLive ? (
                <>
                  <button
                    ref={primaryBtnRef}
                    className="landing-btn"
                    type="button"
                    onClick={handleContinue}
                  >
                    Continue
                  </button>
                  <button
                    ref={backBtnRef}
                    className="landing-ghost"
                    type="button"
                    onClick={handleClosePanel}
                  >
                    Back
                  </button>
                </>
              ) : (
                <button
                  ref={backBtnRef}
                  className="landing-ghost"
                  type="button"
                  onClick={handleClosePanel}
                >
                  Back to exchanges
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
