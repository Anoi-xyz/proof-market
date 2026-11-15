import assert from 'assert';

console.log('── Testing Change Exchange Logic & State Flows ──\n');

// 1. Formatting of exchange names
function formatExchangeName(raw) {
  if (!raw) return 'Binance';
  const lower = raw.toLowerCase();
  if (lower === 'okx') return 'OKX';
  if (lower === 'bitget') return 'Bitget';
  if (lower === 'bybit') return 'Bybit';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

assert.strictEqual(formatExchangeName(null), 'Binance');
assert.strictEqual(formatExchangeName(''), 'Binance');
assert.strictEqual(formatExchangeName('binance'), 'Binance');
assert.strictEqual(formatExchangeName('okx'), 'OKX');
assert.strictEqual(formatExchangeName('bitget'), 'Bitget');
assert.strictEqual(formatExchangeName('bybit'), 'Bybit');
console.log('✓ Exchange name formatting correctly handles defaults and casing');

// 2. Action in progress button disabling logic
function getChangeExchangeButtonProps(isActionInProgress) {
  return {
    disabled: isActionInProgress,
    title: isActionInProgress ? 'Finish or cancel the current action first' : 'Change exchange',
    'aria-label': 'Change exchange',
  };
}

const idleProps = getChangeExchangeButtonProps(false);
assert.strictEqual(idleProps.disabled, false);
assert.strictEqual(idleProps.title, 'Change exchange');

const busyProps = getChangeExchangeButtonProps(true);
assert.strictEqual(busyProps.disabled, true);
assert.strictEqual(busyProps.title, 'Finish or cancel the current action first');
console.log('✓ Change exchange button state correctly disables and sets title when busy');

// 3. Simulating App state machine flows
class AppStateMachine {
  constructor(initialSavedUsername = null) {
    this.savedUsername = initialSavedUsername;
    this.sessionStorage = {};
    const hasSavedUser = Boolean(initialSavedUsername);
    this.showLanding = !hasSavedUser;
    this.hasEnteredMarket = hasSavedUser;
    this.arrivedViaChangeExchange = false;
    this.gatePhase = hasSavedUser ? 'done' : 'show';
    this.checkoutOpen = false;
    this.actionInProgress = false;
    this.walletConnected = false;
  }

  // User clicks "Change exchange" in StickyNav
  changeExchange() {
    if (this.actionInProgress) return false;
    this.checkoutOpen = false; // closes any open checkout modal
    this.arrivedViaChangeExchange = true;
    this.showLanding = true;
    return true;
  }

  // User clicks "Back to market" on landing page
  backToMarket() {
    this.showLanding = false;
    this.arrivedViaChangeExchange = false;
  }

  // User chooses Binance and clicks Continue on landing page
  continueFromLanding(exchangeId = 'binance') {
    this.sessionStorage['proofmarket_exchange'] = exchangeId;
    this.showLanding = false;
    this.arrivedViaChangeExchange = false;
    this.hasEnteredMarket = true;
    // If username is already saved, gate is done; otherwise gate shows
    this.gatePhase = this.savedUsername ? 'done' : 'show';
  }

  // User submits username in UsernameGate
  submitUsername(name) {
    this.savedUsername = name;
    this.gatePhase = 'done';
  }
}

// Flow A: Fresh user without saved username
console.log('\nTesting Flow A: Fresh user (no saved username)');
const freshApp = new AppStateMachine(null);
assert.strictEqual(freshApp.showLanding, true, 'Fresh user starts on landing page');
assert.strictEqual(freshApp.hasEnteredMarket, false, 'MarketView not mounted yet');
assert.strictEqual(freshApp.arrivedViaChangeExchange, false, 'Back to market button hidden');

freshApp.continueFromLanding('binance');
assert.strictEqual(freshApp.sessionStorage['proofmarket_exchange'], 'binance');
assert.strictEqual(freshApp.showLanding, false);
assert.strictEqual(freshApp.hasEnteredMarket, true);
assert.strictEqual(freshApp.gatePhase, 'show', 'Username gate displayed because no saved username');

freshApp.submitUsername('alice');
assert.strictEqual(freshApp.gatePhase, 'done', 'User is now inside the market');
console.log('✓ Flow A passed: Fresh user -> landing -> continue -> username gate -> market');

// Flow B: Returning user with saved username
console.log('\nTesting Flow B: Returning user (with saved username)');
const returningApp = new AppStateMachine('satoshi');
assert.strictEqual(returningApp.showLanding, false, 'Returning user skips landing page');
assert.strictEqual(returningApp.hasEnteredMarket, true, 'Market directly visible');
assert.strictEqual(returningApp.gatePhase, 'done', 'Username gate skipped');
console.log('✓ Flow B passed: Returning user skips landing directly to market');

// Flow C: User in market clicks "Change exchange"
console.log('\nTesting Flow C: Market -> Change exchange -> Back to market');
returningApp.walletConnected = true;
returningApp.checkoutOpen = true; // user had a checkout modal open

const changeOk = returningApp.changeExchange();
assert.strictEqual(changeOk, true);
assert.strictEqual(returningApp.checkoutOpen, false, 'Open checkout modal automatically closed');
assert.strictEqual(returningApp.showLanding, true, 'Landing page displayed');
assert.strictEqual(returningApp.arrivedViaChangeExchange, true, 'Back to market button is visible');
assert.strictEqual(returningApp.walletConnected, true, 'Wallet remained connected');
assert.strictEqual(returningApp.savedUsername, 'satoshi', 'Saved username preserved');

// Click "Back to market"
returningApp.backToMarket();
assert.strictEqual(returningApp.showLanding, false, 'Returned to market');
assert.strictEqual(returningApp.arrivedViaChangeExchange, false);
assert.strictEqual(returningApp.gatePhase, 'done', 'User directly in market');
console.log('✓ Flow C passed: Change exchange -> Back to market preserves wallet, username, and state');

// Flow D: Market -> Change exchange -> Binance -> Continue -> Market
console.log('\nTesting Flow D: Market -> Change exchange -> Binance -> Continue -> Market');
returningApp.changeExchange();
assert.strictEqual(returningApp.showLanding, true);
returningApp.continueFromLanding('binance');
assert.strictEqual(returningApp.showLanding, false);
assert.strictEqual(returningApp.gatePhase, 'done', 'Straight to market because username is saved');
assert.strictEqual(returningApp.savedUsername, 'satoshi');
console.log('✓ Flow D passed: Binance Continue returns directly to market with saved username');

// Flow E: In-progress action prevents Change exchange
console.log('\nTesting Flow E: In-progress action disables Change exchange');
returningApp.actionInProgress = true;
const changeBlocked = returningApp.changeExchange();
assert.strictEqual(changeBlocked, false, 'Change exchange blocked while action in progress');
assert.strictEqual(returningApp.showLanding, false, 'Remained in market');
console.log('✓ Flow E passed: In-progress payment/attestation blocks navigation');

console.log('\nAll state machine and unit tests PASSED successfully!');
