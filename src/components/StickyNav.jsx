import React, { useEffect, useRef } from 'react';
import { shortAddr } from '../hooks/useWallet.js';

/**
 * StickyNav — ProofMarket navigation bar
 *
 * Props:
 *   username        {string}   — current username
 *   onChangeUsername {fn}      — re-open username gate
 *   theme           {string}   — 'light' | 'dark'
 *   onToggleTheme   {fn}       — flip the theme
 *   wallet          {object}   — from useWallet(): { address, connecting, error }
 *   onConnectWallet {fn}       — trigger wallet.connect()
 */
export default function StickyNav({
  username, onChangeUsername,
  theme, onToggleTheme,
  wallet, onConnectWallet,
}) {
  const navRef = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      navRef.current?.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isConnected = !!wallet?.address;

  return (
    <nav className="nav" ref={navRef} aria-label="Main navigation">
      <a href="#" className="nav-logo" aria-label="ProofMarket home">
        <img src="/assets/primus-icon.png" alt="Primus" width="28" height="28" />
        Proof<span style={{ color: 'var(--acc)' }}>Market</span>
      </a>

      {/* Username display */}
      {username && (
        <div className="nav-user" aria-label={`Signed in as ${username}`}>
          <span className="nav-user-name" title={`@${username}`}>@{username}</span>
          <button
            className="nav-user-change"
            type="button"
            onClick={onChangeUsername}
            aria-label="Change username"
          >
            change
          </button>
        </div>
      )}

      <ul className="nav-links" role="list">
        <li>
          <a href="#about" className="nav-about-link">About</a>
        </li>

        {/* Wallet status / connect */}
        <li>
          {isConnected ? (
            <div className="wallet-btn wallet-btn--connected" title={wallet.address}>
              <span className="wallet-dot" aria-hidden="true" />
              <span>{shortAddr(wallet.address)}</span>
            </div>
          ) : (
            <button
              type="button"
              className="wallet-btn"
              onClick={onConnectWallet}
              disabled={wallet?.connecting}
              aria-label="Connect MetaMask wallet"
            >
              {wallet?.connecting ? '⏳ Connecting…' : '🔗 Connect Wallet'}
            </button>
          )}
        </li>

        {/* Theme toggle */}
        <li>
          <button
            className="nav-theme"
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </li>
      </ul>
    </nav>
  );
}
