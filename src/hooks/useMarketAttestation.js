/**
 * useMarketAttestation.js
 *
 * Like usePrimusAttestation.js but accepts a walletAddress parameter
 * and uses it in generateRequestParams() instead of a hardcoded address.
 *
 * Usage:
 *   const { startAttestation } = useMarketAttestation(walletAddress);
 *   const attestation = await startAttestation(onStep);
 */

import { useCallback, useRef } from 'react';
import { PrimusZKTLS } from '@primuslabs/zktls-js-sdk';
import { TEMPLATE_ID } from '../items.js';

const APP_ID = import.meta.env.VITE_APP_ID ?? '';

export default function useMarketAttestation(walletAddress) {
  const primusRef = useRef(null);

  const startAttestation = useCallback(async (onStep) => {

    // ── Step 0: Instantiate ───────────────────────────────────────────────────
    onStep?.(0);
    if (!primusRef.current) {
      primusRef.current = new PrimusZKTLS();
    }
    const primus = primusRef.current;

    // ── Step 1: Init SDK ──────────────────────────────────────────────────────
    onStep?.(1);
    try {
      await primus.init(APP_ID);
    } catch (e) {
      const code = e?.code ?? e?.message ?? '';
      const isNoExt =
        String(code).includes('00006') ||
        (e?.message ?? '').toLowerCase().includes('extension') ||
        (e?.message ?? '').toLowerCase().includes('install');
      const err = new Error(e?.message ?? 'Extension not found');
      err.code = isNoExt ? 'NO_EXTENSION' : 'ATTESTATION_FAILED';
      throw err;
    }

    // ── Step 2: Build request params using the caller's wallet address ────────
    onStep?.(2);
    if (!walletAddress) {
      const err = new Error('No wallet connected. Please connect your wallet first.');
      err.code = 'NO_WALLET';
      throw err;
    }
    let requestStr;
    try {
      const attRequest = primus.generateRequestParams(TEMPLATE_ID, walletAddress);
      requestStr = attRequest.toJsonString();
      console.log('[ProofMarket] requestStr preview:', requestStr.slice(0, 120));
    } catch (e) {
      const err = new Error(e?.message ?? 'generateRequestParams failed');
      err.code = 'ATTESTATION_FAILED';
      throw err;
    }

    // ── Step 3: Backend signs ─────────────────────────────────────────────────
    onStep?.(3);
    let signedRequestStr;
    try {
      const res = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestStr }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      signedRequestStr = data.signedRequestStr;
      if (typeof signedRequestStr !== 'string') {
        throw new Error(`Backend returned wrong type: ${typeof signedRequestStr}`);
      }
    } catch (e) {
      const err = new Error(e?.message ?? 'Signing request failed');
      err.code = 'SIGNING_FAILED';
      throw err;
    }

    // ── Step 4: Attestation (extension handles zkTLS proof) ───────────────────
    onStep?.(4);
    let attestation;
    try {
      attestation = await primus.startAttestation(signedRequestStr);
    } catch (e) {
      const msg  = (e?.message ?? '').toLowerCase();
      const code = String(e?.code ?? '');
      if (code === '00006' || msg.includes('extension') || msg.includes('install') || msg.includes('not found')) {
        const err = new Error(e.message); err.code = 'NO_EXTENSION'; throw err;
      }
      if (
        code === '00004' || code === '00005' ||
        msg.includes('cancel') || msg.includes('reject') ||
        msg.includes('abort') || msg.includes('denied') || msg.includes('user close')
      ) {
        const err = new Error(e.message); err.code = 'USER_CANCELLED'; throw err;
      }
      const err = new Error(e?.message ?? 'Attestation failed');
      err.code = 'ATTESTATION_FAILED';
      throw err;
    }

    // ── Step 5: Local verify ──────────────────────────────────────────────────
    try {
      const valid = primus.verifyAttestation(attestation);
      if (!valid) {
        const err = new Error('Attestation signature verification failed');
        err.code = 'ATTESTATION_FAILED';
        throw err;
      }
    } catch (e) {
      if (e.code) throw e;
      const err = new Error(e?.message ?? 'Verification failed');
      err.code = 'ATTESTATION_FAILED';
      throw err;
    }

    return attestation;
  }, [walletAddress]);

  return { startAttestation };
}
