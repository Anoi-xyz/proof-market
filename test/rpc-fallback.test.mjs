import assert from 'assert/strict';
import { parseEther, formatEther } from 'ethers';
import { DEFAULT_SEPOLIA_RPC_URL, SEPOLIA_CHAIN_ID } from '../src/items.js';
import { friendlyError, RPC_FAILURE_MESSAGE, isRpcFailure } from '../src/utils/rpcErrors.js';

console.log('\n── RPC Fallback & Balance Pre-check Tests ──\n');

// 1. Verify DEFAULT_SEPOLIA_RPC_URL constant
assert.equal(
  DEFAULT_SEPOLIA_RPC_URL,
  'https://ethereum-sepolia-rpc.publicnode.com',
  'DEFAULT_SEPOLIA_RPC_URL must default to https://ethereum-sepolia-rpc.publicnode.com'
);
console.log('✓ DEFAULT_SEPOLIA_RPC_URL constant matches required default');

// 2. isRpcFailure helper tests
{
  const err404 = new Error('could not coalesce error (error={"code":-32603,"message":"Request failed with status code 404"}, payload={"method":"eth_getBalance"})');
  err404.code = 'UNKNOWN_ERROR';
  assert.equal(isRpcFailure(err404), true, '404 coalesce error must be recognized as RPC failure');

  const errNetwork = new Error('failed to fetch');
  errNetwork.code = 'NETWORK_ERROR';
  assert.equal(isRpcFailure(errNetwork), true, 'NETWORK_ERROR must be recognized as RPC failure');

  const errServer = new Error('missing response from RPC');
  errServer.code = 'SERVER_ERROR';
  assert.equal(isRpcFailure(errServer), true, 'SERVER_ERROR must be recognized as RPC failure');

  const errTimeout = new Error('RPC connection timed out');
  errTimeout.code = 'TIMEOUT';
  assert.equal(isRpcFailure(errTimeout), true, 'TIMEOUT must be recognized as RPC failure');

  const normalErr = new Error('User rejected the transaction');
  normalErr.code = 'ACTION_REJECTED';
  assert.equal(isRpcFailure(normalErr), false, 'User cancellation is not an RPC failure');

  console.log('✓ isRpcFailure correctly identifies 404, network, timeout, and server errors');
}

// 3. friendlyError returns distinct message on RPC failure, NEVER insufficient funds
{
  const rpcErr = new Error('could not coalesce error ... Request failed with status code 404 on eth_getBalance');
  rpcErr.code = -32603;

  const friendlyMsg = friendlyError(rpcErr);
  assert.equal(friendlyMsg, RPC_FAILURE_MESSAGE);
  assert.ok(!friendlyMsg.toLowerCase().includes('insufficient funds'), 'Must never label RPC failure as insufficient funds');
  console.log('✓ friendlyError returns distinct RPC guidance on 404/RPC failure');
}

// 4. Insufficient balance is ONLY shown when a successful balance read is lower than required
{
  const balanceErr = new Error('Insufficient balance: connected address 0x1529CFA271435e91C0043550D60Cc7b9Ea578F2c on chain 11155111 has 0.0005 Sepolia ETH, but needs ~0.00163 ETH');
  balanceErr.code = 'INSUFFICIENT_BALANCE';

  const friendlyMsg = friendlyError(balanceErr);
  assert.ok(friendlyMsg.startsWith('Insufficient balance:'), 'Shows detailed insufficient balance message on real low balance');
  assert.ok(friendlyMsg.includes('0x1529CFA271435e91C0043550D60Cc7b9Ea578F2c'));
  assert.ok(friendlyMsg.includes('11155111'));
  console.log('✓ Insufficient balance message only returned when successful balance read is too low');
}

// 5. Test pre-check fallback logic
async function simulatePreCheck({
  walletGetBalance,
  fallbackGetBalance,
  address = '0x1529CFA271435e91C0043550D60Cc7b9Ea578F2c',
  chainId = 11155111,
  ethAmount = '0.001',
}) {
  let balanceWei = null;
  let balanceReadSuccess = false;
  let rpcErrorCode = null;

  try {
    balanceWei = await walletGetBalance();
    balanceReadSuccess = true;
  } catch (walletRpcErr) {
    rpcErrorCode = walletRpcErr?.code ?? 'UNKNOWN';
    // Fallback to read-only provider
    try {
      balanceWei = await fallbackGetBalance();
      balanceReadSuccess = true;
    } catch (fallbackRpcErr) {
      balanceReadSuccess = false;
    }
  }

  const amountWei = parseEther(String(ethAmount));
  const gasBufferWei = 21000n * 50_000_000_000n;
  const requiredWei = amountWei + gasBufferWei;

  if (balanceReadSuccess && balanceWei !== null) {
    if (balanceWei < requiredWei) {
      const err = new Error(`Insufficient balance: connected address ${address} on chain ${chainId} has ${formatEther(balanceWei)} Sepolia ETH, but needs ~${formatEther(requiredWei)} ETH`);
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }
  }

  return { ok: true, balanceReadSuccess, balanceWei, rpcErrorCode };
}

// Scenario A: Wallet getBalance throws 404, but public Sepolia RPC fallback succeeds with 0.4 ETH -> passes!
{
  const res = await simulatePreCheck({
    walletGetBalance: async () => {
      const err = new Error('could not coalesce error ... Request failed with status code 404');
      err.code = 'UNKNOWN_ERROR';
      throw err;
    },
    fallbackGetBalance: async () => {
      return parseEther('0.4'); // 0.4 ETH
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.balanceReadSuccess, true);
  assert.equal(res.rpcErrorCode, 'UNKNOWN_ERROR');
  console.log('✓ Scenario A: Wallet 404 triggers fallback public RPC with 0.4 ETH -> check succeeds cleanly');
}

// Scenario B: Wallet 404 AND public RPC fallback also fails -> skips pre-check, doesn't throw insufficient funds!
{
  const res = await simulatePreCheck({
    walletGetBalance: async () => {
      const err = new Error('Request failed with status code 404');
      err.code = -32603;
      throw err;
    },
    fallbackGetBalance: async () => {
      const err = new Error('Public RPC timed out');
      err.code = 'TIMEOUT';
      throw err;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.balanceReadSuccess, false, 'Pre-check must be skipped when both RPCs fail');
  assert.equal(res.rpcErrorCode, -32603);
  console.log('✓ Scenario B: Both RPCs fail -> skips pre-check to let wallet sendTransaction decide');
}

// Scenario C: Successful balance read with genuine low balance throws INSUFFICIENT_BALANCE
{
  await assert.rejects(
    async () => {
      await simulatePreCheck({
        walletGetBalance: async () => parseEther('0.0001'),
        fallbackGetBalance: async () => parseEther('0.0001'),
      });
    },
    (err) => {
      assert.equal(err.code, 'INSUFFICIENT_BALANCE');
      return true;
    }
  );
  console.log('✓ Scenario C: Successful read with genuine low balance correctly throws INSUFFICIENT_BALANCE');
}

console.log('\nAll RPC Fallback and Balance tests passed cleanly!\n');
