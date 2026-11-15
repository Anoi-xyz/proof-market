import React, { useState, useEffect, useRef, useCallback } from 'react';
import { shortAddr } from '../hooks/useWallet.js';
import { SEPOLIA_CHAIN_ID } from '../items.js';

/**
 * StickyNav — ProofMarket navigation bar with full wallet dropdown menu
 *
 * Props:
 *   username         {string}   — current username
 *   onChangeUsername {fn}       — re-open username gate
 *   theme            {string}   — 'light' | 'dark'
 *   onToggleTheme    {fn}       — flip the theme
 *   wallet           {object}   — from useWallet(): { address, chainId, connecting, error, connect, disconnect, switchAccount, switchToSepolia }
 *   onConnectWallet  {fn}       — trigger wallet.connect()
 */
export default function StickyNav({
  username, onChangeUsername,
  theme, onToggleTheme,
  wallet, onConnectWallet,
  onChangeExchange, selectedExchange, isActionInProgress = false,
}) {
  const navRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Derive exchange display name (defaults to "Binance")
  const rawExchange = selectedExchange || (typeof window !== 'undefined' ? sessionStorage.getItem('proofmarket_exchange') : null);
  const exchangeName = (() => {
    if (!rawExchange) return 'Binance';
    const lower = rawExchange.toLowerCase();
    if (lower === 'okx') return 'OKX';
    if (lower === 'bitget') return 'Bitget';
    if (lower === 'bybit') return 'Bybit';
    return rawExchange.charAt(0).toUpperCase() + rawExchange.slice(1);
  })();

  // Close menu if wallet disconnects
  useEffect(() => {
    if (!wallet?.address) {
      setMenuOpen(false);
    }
  }, [wallet?.address]);

  // Handle scroll class
  useEffect(() => {
    const onScroll = () => {
      navRef.current?.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Handle click outside and Escape key to close menu
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Copy full address
  const handleCopyAddress = useCallback(() => {
    if (!wallet?.address) return;
    const copyFallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = wallet.address;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn('[StickyNav] Copy fallback failed:', err);
      }
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(wallet.address)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          copyFallback();
        });
    } else {
      copyFallback();
    }
  }, [wallet?.address]);

  // Switch network to Sepolia
  const handleSwitchNetwork = useCallback(async () => {
    try {
      await wallet?.switchToSepolia?.();
    } catch (err) {
      console.error('[StickyNav] Switch to Sepolia failed:', err);
    }
  }, [wallet]);

  // Switch account
  const handleSwitchAccount = useCallback(async () => {
    try {
      await wallet?.switchAccount?.();
      setMenuOpen(false);
    } catch (err) {
      console.error('[StickyNav] Switch account failed:', err);
    }
  }, [wallet]);

  // Disconnect
  const handleDisconnect = useCallback(async () => {
    setMenuOpen(false);
    await wallet?.disconnect?.();
  }, [wallet]);

  const isConnected = !!wallet?.address;
  const isSepolia = wallet?.chainId === SEPOLIA_CHAIN_ID;

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
        <li className="hide-sm">
          <a href="#about" className="nav-about-link">About</a>
        </li>

        {/* Change exchange */}
        <li className="nav-exchange-item">
          <div className="nav-exchange-wrapper">
            <span className="nav-exchange-label">
              Exchange: {exchangeName}
            </span>
            <button
              type="button"
              className="nav-exchange-btn"
              onClick={onChangeExchange}
              disabled={isActionInProgress}
              aria-label="Change exchange"
              title={isActionInProgress ? 'Finish or cancel the current action first' : 'Change exchange'}
            >
              <span className="nav-exchange-icon" aria-hidden="true">⇄</span>
              <span className="nav-exchange-text">Change exchange</span>
            </button>
          </div>
        </li>

        {/* Wallet status / dropdown */}
        <li>
          {isConnected ? (
            <div className="wallet-menu-wrapper" ref={menuRef}>
              <button
                type="button"
                className={`wallet-btn wallet-btn--connected ${menuOpen ? 'wallet-btn--active' : ''}`}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                title="Open wallet menu"
              >
                <span className={`wallet-dot ${isSepolia ? '' : 'wallet-dot--warn'}`} aria-hidden="true" />
                <span>{shortAddr(wallet.address)}</span>
                <span className="wallet-chevron" aria-hidden="true">{menuOpen ? '▴' : '▾'}</span>
              </button>

              {menuOpen && (
                <div className="wallet-dropdown-menu" role="menu" aria-label="Wallet menu">
                  {/* a. Full address with Copy button */}
                  <div className="wallet-menu-section">
                    <div className="wallet-menu-label">Connected Wallet</div>
                    <div className="wallet-menu-address-row">
                      <span className="wallet-menu-full-addr" title={wallet.address}>
                        {wallet.address}
                      </span>
                      <button
                        type="button"
                        className="wallet-menu-copy-btn"
                        onClick={handleCopyAddress}
                        title="Copy address"
                      >
                        {copied ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                  </div>

                  {/* b. Network name and chain ID with switch button if wrong */}
                  <div className="wallet-menu-section">
                    <div className="wallet-menu-label">Network</div>
                    {isSepolia ? (
                      <div className="network-status-badge network-status-badge--valid">
                        <span className="network-status-dot valid" />
                        <span>Sepolia Testnet ({SEPOLIA_CHAIN_ID})</span>
                      </div>
                    ) : (
                      <div className="network-status-warning">
                        <div className="network-status-badge network-status-badge--invalid">
                          <span className="network-status-dot invalid" />
                          <span>Chain ID: {wallet?.chainId ?? 'Unknown'} (Not Sepolia)</span>
                        </div>
                        <button
                          type="button"
                          className="btn-switch-sepolia"
                          onClick={handleSwitchNetwork}
                        >
                          Switch to Sepolia
                        </button>
                      </div>
                    )}
                  </div>

                  {/* c. View on Etherscan */}
                  <div className="wallet-menu-section">
                    <a
                      href={`https://sepolia.etherscan.io/address/${wallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="wallet-menu-link"
                      role="menuitem"
                    >
                      <span>↗ View on Etherscan</span>
                    </a>
                  </div>

                  {/* d. Switch account */}
                  <div className="wallet-menu-section">
                    <button
                      type="button"
                      className="wallet-menu-btn-action"
                      onClick={handleSwitchAccount}
                      role="menuitem"
                    >
                      <span>🔄 Switch Account</span>
                    </button>
                  </div>

                  <div className="wallet-menu-divider" />

                  {/* e. Disconnect (red, at bottom) */}
                  <div className="wallet-menu-section wallet-menu-section--last">
                    <button
                      type="button"
                      className="wallet-menu-btn-disconnect"
                      onClick={handleDisconnect}
                      role="menuitem"
                    >
                      <span>🚪 Disconnect</span>
                    </button>
                  </div>
                </div>
              )}
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
