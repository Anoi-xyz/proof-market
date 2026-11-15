/**
 * useWallet.js — MetaMask / BrowserProvider wallet hook
 *
 * State:
 *   address    {string|null}  — connected wallet address (checksummed)
 *   chainId    {number|null}  — current chain ID
 *   connecting {boolean}      — true while connect() is in-flight
 *   error      {string|null}  — last error message
 *
 * Actions:
 *   connect()                              — request accounts, check/switch to Sepolia
 *   disconnect()                           — app-level disconnect, revoke permissions, prevent auto-reconnect
 *   switchAccount()                        — prompt user to switch account via wallet_requestPermissions
 *   switchToSepolia()                      — switch active chain to Sepolia (11155111)
 *   sendPayment(toAddress, ethAmount)      — verify chain, check BigInt balance in wei, send ETH
 *
 * Helper export:
 *   shortAddr(addr)  → "0x1234…abcd"
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserProvider, JsonRpcProvider, parseEther, formatEther, isAddress } from 'ethers';
import { SEPOLIA_CHAIN_ID, DEFAULT_SEPOLIA_RPC_URL } from '../items.js';

export { DEFAULT_SEPOLIA_RPC_URL };

const DISCONNECT_STORAGE_KEY = 'proofmarket_disconnected';

/** Shorten an Ethereum address for display: 0x1234…abcd */
export function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function useWallet() {
  const [address,    setAddress]    = useState(null);
  const [chainId,    setChainId]    = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState(null);

  // Keep provider in a ref so it isn't re-created on every render
  const providerRef = useRef(null);

  function getProvider() {
    if (!window.ethereum) throw new Error('MetaMask not found. Please install MetaMask.');
    if (!providerRef.current) {
      providerRef.current = new BrowserProvider(window.ethereum);
    }
    return providerRef.current;
  }

  // ── Listen for account / chain changes (NO requests on page load) ───────────
  // Security rule: Never call eth_requestAccounts or query accounts on page load.
  // We only register passive event listeners so state updates if the user
  // connects or switches accounts later.
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        // Empty accounts list: treat as disconnect automatically
        setAddress(null);
        setChainId(null);
        providerRef.current = null;
      } else {
        // If the user manually disconnected in the app, do NOT silently reconnect on accountsChanged
        if (sessionStorage.getItem(DISCONNECT_STORAGE_KEY) === 'true') {
          return;
        }
        setAddress(accounts[0]);
      }
    };

    const handleChainChanged = (hexChainId) => {
      setChainId(parseInt(hexChainId, 16));
      // Reset provider so it picks up the new network
      providerRef.current = null;
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged',    handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged',    handleChainChanged);
    };
  }, []);

  // ── switchToSepolia() ──────────────────────────────────────────────────────
  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) throw new Error('MetaMask not found. Please install MetaMask.');
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
      });
      setChainId(SEPOLIA_CHAIN_ID);
      providerRef.current = null;
    } catch (switchErr) {
      // 4902 = chain not added — try to add it
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
            chainName: 'Sepolia Testnet',
            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        setChainId(SEPOLIA_CHAIN_ID);
        providerRef.current = null;
      } else {
        throw switchErr;
      }
    }
  }, []);

  // ── connect() ──────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // Clear manual disconnect flag so user can actively reconnect
      sessionStorage.removeItem(DISCONNECT_STORAGE_KEY);

      const provider = getProvider();
      // Request user to unlock / share accounts
      const accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts?.length) throw new Error('No accounts returned.');
      setAddress(accounts[0]);

      // Check chain
      const network = await provider.getNetwork();
      const id = Number(network.chainId);
      setChainId(id);

      if (id !== SEPOLIA_CHAIN_ID) {
        await switchToSepolia();
        // Re-read chain after switch
        const updated = await provider.getNetwork();
        setChainId(Number(updated.chainId));
      }
    } catch (err) {
      const msg = err?.message ?? 'Wallet connection failed';
      setError(msg);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [switchToSepolia]);

  // ── switchAccount() ────────────────────────────────────────────────────────
  const switchAccount = useCallback(async () => {
    if (!window.ethereum) throw new Error('MetaMask not found. Please install MetaMask.');
    try {
      // Request permission selection from wallet
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      });
      sessionStorage.removeItem(DISCONNECT_STORAGE_KEY);

      // Refresh accounts
      const provider = getProvider();
      const accounts = await provider.send('eth_accounts', []);
      if (accounts?.length) {
        setAddress(accounts[0]);
      }
    } catch (err) {
      if (err?.code === 4001) {
        // User cancelled account switch dialog
        return;
      }
      console.error('[switchAccount] Error:', err);
      throw err;
    }
  }, []);

  // ── disconnect() ───────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    // 1. Mark manual disconnect in sessionStorage to prevent auto-reconnect
    try {
      sessionStorage.setItem(DISCONNECT_STORAGE_KEY, 'true');
    } catch {
      // sessionStorage unavailable
    }

    // 2. Attempt wallet_revokePermissions for eth_accounts (MetaMask-supported)
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (err) {
        // Silently catch since some wallets do not support revokePermissions
        console.warn('[useWallet] wallet_revokePermissions note:', err?.message);
      }
    }

    // 3. App-level state disconnect
    setAddress(null);
    setChainId(null);
    setError(null);
    providerRef.current = null;
  }, []);

  // ── sendPayment() ──────────────────────────────────────────────────────────
  const sendPayment = useCallback(async (toAddress, ethAmount) => {
    if (!address) throw new Error('Wallet not connected.');
    if (!isAddress(toAddress)) throw new Error('Invalid receiver address.');
    if (!window.ethereum) throw new Error('MetaMask not found. Please install MetaMask.');

    // Always create a fresh provider instance for the transaction to guarantee
    // state matches the active wallet provider and network
    const provider = new BrowserProvider(window.ethereum);

    // 1. Confirm chainId is 11155111 first
    const network = await provider.getNetwork();
    let currentChainId = Number(network.chainId);

    if (currentChainId !== SEPOLIA_CHAIN_ID) {
      console.warn(`[sendPayment] Connected to chain ${currentChainId}. Switching to Sepolia (${SEPOLIA_CHAIN_ID})...`);
      try {
        await switchToSepolia();
      } catch (switchErr) {
        const switchErrMsg = `Wrong network: connected to chain ${currentChainId}, but Sepolia (${SEPOLIA_CHAIN_ID}) is required.`;
        console.error('[sendPayment]', switchErrMsg, switchErr);
        throw new Error(switchErrMsg);
      }
      const updatedNetwork = await provider.getNetwork();
      currentChainId = Number(updatedNetwork.chainId);
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        throw new Error(`Chain switch required: expected ${SEPOLIA_CHAIN_ID}, got ${currentChainId}`);
      }
      setChainId(SEPOLIA_CHAIN_ID);
    }

    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();

    // 2. Read balance for the connected account with fallback to public Sepolia RPC
    // If the wallet's RPC endpoint fails (e.g. 404 or connection failure), we fall back
    // to a read-only public Sepolia RPC. If that also fails, we skip pre-check and let
    // the wallet's send step decide — NEVER label an RPC failure as insufficient balance.
    let balanceWei = null;
    let balanceReadSuccess = false;

    try {
      balanceWei = await provider.getBalance(signerAddress);
      balanceReadSuccess = true;
    } catch (walletRpcErr) {
      console.error('[sendPayment] Wallet RPC getBalance failed:', {
        code: walletRpcErr?.code ?? 'UNKNOWN',
        message: walletRpcErr?.message,
        signerAddress,
        chainId: currentChainId,
        error: walletRpcErr,
      });

      // Fall back to read-only JsonRpcProvider on public Sepolia RPC
      try {
        console.log(`[sendPayment] Attempting fallback getBalance via public Sepolia RPC: ${DEFAULT_SEPOLIA_RPC_URL}`);
        const fallbackProvider = new JsonRpcProvider(DEFAULT_SEPOLIA_RPC_URL);
        balanceWei = await fallbackProvider.getBalance(signerAddress);
        balanceReadSuccess = true;
        console.log('[sendPayment] Fallback public Sepolia RPC getBalance success:', formatEther(balanceWei), 'ETH');
      } catch (fallbackRpcErr) {
        console.error('[sendPayment] Fallback public Sepolia RPC getBalance also failed:', {
          code: fallbackRpcErr?.code ?? 'UNKNOWN',
          message: fallbackRpcErr?.message,
          rpcUrl: DEFAULT_SEPOLIA_RPC_URL,
          error: fallbackRpcErr,
        });
        // Both RPCs failed: skip pre-check and let the wallet's own send step decide
        balanceReadSuccess = false;
      }
    }

    const amountWei = parseEther(String(ethAmount)); // BigInt in ethers v6

    // 3. Only evaluate balance if a balance read was actually successful
    if (balanceReadSuccess && balanceWei !== null) {
      // Estimate realistic gas buffer in wei (21k gas for ETH transfer)
      let gasBufferWei = 21000n * 50_000_000_000n; // fallback: 21k gas * 50 gwei = 0.00105 ETH
      try {
        const feeData = await provider.getFeeData();
        const currentGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
        if (currentGasPrice && currentGasPrice > 0n) {
          // 21000 gas * gasPrice * 1.5 buffer
          gasBufferWei = (21000n * currentGasPrice * 15n) / 10n;
        }
      } catch (feeErr) {
        console.warn('[sendPayment] Could not query feeData from wallet provider (RPC error code:', feeErr?.code ?? 'UNKNOWN', feeErr?.message, '), using fallback gas buffer');
      }

      const requiredWei = amountWei + gasBufferWei;

      console.log('[sendPayment] Sepolia balance check:', {
        signerAddress,
        chainId: currentChainId,
        balanceWei: balanceWei.toString(),
        amountWei: amountWei.toString(),
        gasBufferWei: gasBufferWei.toString(),
        requiredWei: requiredWei.toString(),
        balanceEth: formatEther(balanceWei),
        requiredEth: formatEther(requiredWei),
      });

      if (balanceWei < requiredWei) {
        const balanceEth = formatEther(balanceWei);
        const requiredEth = formatEther(requiredWei);
        const errMsg = `Insufficient balance: connected address ${signerAddress} on chain ${currentChainId} has ${balanceEth} Sepolia ETH (${balanceWei.toString()} wei), but needs ~${requiredEth} ETH (${requiredWei.toString()} wei for ${ethAmount} ETH + gas).`;
        console.error('[sendPayment] Insufficient balance check failed:', errMsg);
        const err = new Error(errMsg);
        err.code = 'INSUFFICIENT_BALANCE';
        err.details = {
          address: signerAddress,
          chainId: currentChainId,
          balanceWei: balanceWei.toString(),
          balanceEth,
          requiredEth,
        };
        throw err;
      }
    } else {
      console.log('[sendPayment] Skipping balance pre-check (RPC balance read unavailable); delegating check to wallet sendTransaction.');
    }

    // 4. Send transaction
    const tx = await signer.sendTransaction({
      to:    toAddress,
      value: amountWei,
    });

    // Wait for 1 confirmation
    await tx.wait(1);
    return tx.hash;
  }, [address, switchToSepolia]);

  return {
    address,
    chainId,
    connecting,
    error,
    connect,
    disconnect,
    switchAccount,
    switchToSepolia,
    sendPayment,
    isCorrectChain: chainId === SEPOLIA_CHAIN_ID,
  };
}
