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
 *   sendPayment(toAddress, ethAmount)      — send ETH, wait for confirm, return txHash
 *
 * Helper export:
 *   shortAddr(addr)  → "0x1234…abcd"
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserProvider, parseEther, isAddress } from 'ethers';
import { SEPOLIA_CHAIN_ID } from '../items.js';

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

  // ── Listen for account / chain changes ─────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAddress(null);
      } else {
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

    // Eagerly read already-connected accounts (no prompt)
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (accounts?.length) setAddress(accounts[0]);
      })
      .catch(() => {});

    // Read current chain
    window.ethereum
      .request({ method: 'eth_chainId' })
      .then((hex) => setChainId(parseInt(hex, 16)))
      .catch(() => {});

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged',    handleChainChanged);
    };
  }, []);

  // ── connect() ──────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
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
        // Ask wallet to switch
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
          });
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
          } else {
            throw switchErr;
          }
        }
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
  }, []);

  // ── sendPayment() ──────────────────────────────────────────────────────────
  const sendPayment = useCallback(async (toAddress, ethAmount) => {
    if (!address) throw new Error('Wallet not connected.');
    if (!isAddress(toAddress)) throw new Error('Invalid receiver address.');

    const provider = getProvider();
    const signer   = await provider.getSigner();

    const tx = await signer.sendTransaction({
      to:    toAddress,
      value: parseEther(String(ethAmount)),
    });

    // Wait for 1 confirmation
    await tx.wait(1);
    return tx.hash;
  }, [address]);

  return {
    address,
    chainId,
    connecting,
    error,
    connect,
    sendPayment,
    isCorrectChain: chainId === SEPOLIA_CHAIN_ID,
  };
}
