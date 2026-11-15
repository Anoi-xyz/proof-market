/**
 * rpcErrors.js — RPC error detection, reason code mapping, and friendly messaging
 */

export const RPC_FAILURE_MESSAGE =
  "Your wallet's Sepolia network connection (RPC) isn't responding. In your wallet's network settings, change the Sepolia RPC URL to a working public endpoint, then try again.";

export const REASON_CODE_MAP = {
  INSUFFICIENT_PNL: 'Your verified Binance PnL does not meet the minimum requirement for this tier.',
  ALREADY_CLAIMED: 'This item has already been claimed by this wallet.',
  REPLAY_DETECTED: 'This attestation proof has already been used.',
  ATTESTATION_EXPIRED: 'Attestation expired. Please generate a fresh proof.',
  RECIPIENT_MISMATCH: 'Attestation recipient does not match your connected wallet.',
  INVALID_SIGNATURE: 'Attestation signature verification failed.',
  INVALID_REQUEST_URL: 'Attestation endpoint does not match the Binance spot statistics URL.',
  INVALID_RESPONSE_RESOLVE: 'Attestation fields do not match the expected template schema.',
  INVALID_ATTESTATION_DATA: 'Attestation data payload is invalid.',
  INVALID_RATE: 'PnL rate in attestation is not a valid number.',
  INVALID_TEMPLATE_ID: 'Attestation template ID does not match the required template.',
  UNKNOWN_ITEM: 'Selected item is not recognized.',
  INVALID_WALLET_ADDRESS: 'Connected wallet address is invalid.',
  INVALID_TX_HASH: 'Transaction hash format is invalid.',
  MISSING_ATTESTATION: 'Attestation object was missing in request.',
  SERVER_CONFIGURATION_ERROR: 'Server configuration error. Please try again later.',
};

/**
 * Returns true if the error originates from an RPC or network failure
 * (e.g. 404, connection timeout, server error) rather than a balance shortfall.
 */
export function isRpcFailure(err) {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  const shortMsg = String(err?.shortMessage ?? '').toLowerCase();

  return (
    code === 'NETWORK_ERROR' ||
    code === 'SERVER_ERROR' ||
    code === 'TIMEOUT' ||
    code === 'RPC_ERROR' ||
    code === 'UNKNOWN_ERROR' ||
    msg.includes('could not coalesce error') ||
    msg.includes('status code 404') ||
    msg.includes('request failed with status code') ||
    msg.includes('eth_getbalance') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('network connection') ||
    msg.includes('connection refused') ||
    msg.includes('rpc error') ||
    msg.includes('missing response') ||
    shortMsg.includes('could not coalesce error') ||
    shortMsg.includes('404')
  );
}

/**
 * Human-readable error messages by code.
 * Guaranteed to NEVER label an RPC or network failure as insufficient balance.
 */
export function friendlyError(err) {
  const code = err?.code ?? '';
  const msg  = err?.message ?? 'Unknown error';

  // 1. Check for RPC failure first — NEVER label an RPC or network error as insufficient funds
  if (isRpcFailure(err)) {
    console.error('[CheckoutModal] Sepolia RPC failure detected:', {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message,
      shortMessage: err?.shortMessage,
      error: err,
    });
    return RPC_FAILURE_MESSAGE;
  }

  // 2. Only show "Insufficient balance" when a successful balance read is lower than the required amount
  if (code === 'INSUFFICIENT_BALANCE' || msg.startsWith('Insufficient balance:')) {
    return msg;
  }

  // 3. User cancelled / rejected
  if (code === 'USER_CANCELLED' || msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
    return 'Transaction rejected in wallet.';
  }

  // 4. Other known codes
  if (code === 'NO_EXTENSION')    return 'Primus extension not found. Install it from the Chrome Web Store first.';
  if (code === 'SIGNING_FAILED')  return `Signing failed: ${msg}`;
  if (code === 'NO_WALLET')       return 'No wallet connected. Please connect MetaMask first.';
  if (code === 'ATTESTATION_FAILED') return `Attestation failed: ${msg}`;
  if (REASON_CODE_MAP[msg])       return REASON_CODE_MAP[msg];

  // 5. Raw wallet send failure with insufficient funds (only when NOT an RPC failure)
  if (msg.includes('insufficient funds')) {
    console.error('[CheckoutModal] Wallet reported insufficient funds during sendTransaction:', err);
    return 'Insufficient Sepolia ETH balance in your wallet to complete the transaction.';
  }

  return msg;
}
