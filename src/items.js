/**
 * items.js — ProofMarket item definitions
 *
 * Shared between client UI (MarketPage, ItemCard, etc.) and used as
 * a reference by the server-side api/claim.js (which re-defines items
 * independently for security — never trust client-sent thresholds).
 */

export const ITEMS = [
  { id: 'starter',  name: 'Starter',  priceUsd: 3,  minPnl: 0.01 },
  { id: 'silver',   name: 'Silver',   priceUsd: 5,  minPnl: 0.03 },
  { id: 'gold',     name: 'Gold',     priceUsd: 10, minPnl: 0.05 },
  { id: 'platinum', name: 'Platinum', priceUsd: 20, minPnl: 0.10 },
];

// Safety assertion — no item may have minPnl below 0.01
ITEMS.forEach((item) => {
  if (item.minPnl < 0.01) {
    throw new Error(`[items.js] Item "${item.id}" has minPnl ${item.minPnl} which is below the minimum 0.01`);
  }
});

/** Fixed testnet ETH amount per purchase (Sepolia only). */
export const SEPOLIA_ETH_AMOUNT = '0.001';

/** Sepolia chain ID (decimal). */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Primus template ID for the Binance PnL attestation. */
export const TEMPLATE_ID = '369e1db8-47c9-4dc6-85b5-037cd02d3383';
