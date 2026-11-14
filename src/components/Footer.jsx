import React from 'react';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-links">
        <a href="#about" className="footer-link">
          About ProofMarket
        </a>
        <span className="footer-sep" aria-hidden="true">•</span>
        <a
          href="https://github.com/Anoi-xyz/proof-market"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          GitHub Repository
        </a>
        <span className="footer-sep" aria-hidden="true">•</span>
        <a
          href="https://primuslabs.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          Primus zkTLS
        </a>
      </div>

      <p className="footer-tagline">
        ProofMarket uses <strong>Primus zkTLS</strong> to verify off-chain Web2 data without revealing credentials.
        <br />
        Testnet demo built for the Primus zkTLS challenge.
      </p>

      <p className="footer-credit">
        built by{' '}
        <a href="https://x.com/anoi_exe" target="_blank" rel="noopener noreferrer">
          anoi
        </a>
      </p>
    </footer>
  );
}
