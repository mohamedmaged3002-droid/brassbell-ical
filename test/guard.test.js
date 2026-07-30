const { test } = require('node:test');
const assert = require('node:assert');
const { shouldWrite } = require('../src/guard');

const NIGHTS = 210;
const ok = (over = {}) => ({ ok: true, blocked: 5, available: 200, errors: 0, ...over });

test('writes a healthy scrape', () => {
  assert.strictEqual(shouldWrite(null, ok(), NIGHTS).write, true);
});

test('refuses a scrape that did not complete (ok=false)', () => {
  assert.strictEqual(shouldWrite(null, ok({ ok: false }), NIGHTS).write, false);
});

test('refuses a scrape with zero classified nights', () => {
  assert.strictEqual(shouldWrite(null, ok({ blocked: 0, available: 0 }), NIGHTS).write, false);
});

test('refuses a scrape that errored on too many nights', () => {
  // Coverage is fine (205/210) but >5% of nights errored -> reject.
  const r = shouldWrite(null, ok({ blocked: 5, available: 200, errors: 20 }), NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'too-many-errors');
});

test('refuses a scrape with low coverage', () => {
  // Only 55 of 210 nights classified -> reject before any collapse check.
  const r = shouldWrite(null, ok({ blocked: 5, available: 50, errors: 0 }), NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'low-coverage');
});

test('refuses a suspicious availability collapse vs previous run', () => {
  const prev = { availableCount: 200 };
  // Coverage is fine (205/210) but availability halved vs prior -> likely a
  // scrape glitch, keep last-good.
  const r = shouldWrite(prev, ok({ blocked: 115, available: 90, errors: 0 }), NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'availability-collapse');
});

test('accepts a legitimate availability drop (still > 50% of prior)', () => {
  const prev = { availableCount: 200 };
  assert.strictEqual(shouldWrite(prev, ok({ available: 150, blocked: 55 }), NIGHTS).write, true);
});

// --- collapse confirmation (L-074) ---------------------------------------
// A unit that legitimately goes off-sale (long-term let) reads as 100% blocked
// forever. The collapse gate used to reject that permanently, because sync.js
// refreshes the availableCount baseline ONLY on a successful write — so the
// feed deadlocked and kept serving a months-old "available" snapshot to OTAs.

test('a first collapse observation is still refused, and starts the streak', () => {
  const r = shouldWrite({ availableCount: 192 }, ok({ blocked: 210, available: 0 }), NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'availability-collapse');
  assert.strictEqual(r.collapseStreak, 1);
});

test('the streak advances while the collapse keeps being re-observed', () => {
  const r = shouldWrite({ availableCount: 192, collapseStreak: 1 }, ok({ blocked: 210, available: 0 }), NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.collapseStreak, 2);
});

test('a collapse confirmed by 3 consecutive runs is finally believed', () => {
  const r = shouldWrite({ availableCount: 192, collapseStreak: 2 }, ok({ blocked: 210, available: 0 }), NIGHTS);
  assert.strictEqual(r.write, true, 'third agreeing run must break the deadlock');
  assert.strictEqual(r.reason, 'availability-collapse-confirmed');
  assert.strictEqual(r.collapseStreak, 0, 'streak resets once acted on');
});

test('a recovered scrape resets the streak (flaky runs must not accumulate)', () => {
  const r = shouldWrite({ availableCount: 192, collapseStreak: 2 }, ok({ blocked: 5, available: 200 }), NIGHTS);
  assert.strictEqual(r.write, true);
  assert.strictEqual(r.reason, 'ok');
  assert.strictEqual(r.collapseStreak, 0);
});

test('an UNHEALTHY scrape never advances the streak toward confirmation', () => {
  // The whole point of the streak is that a real off-sale repeats identically.
  // A broken scrape must not be able to confirm itself, so the pre-gates
  // (ok/coverage/errors) reset the counter rather than passing it through.
  for (const bad of [{ ok: false }, { blocked: 0, available: 0 }, { blocked: 5, available: 50 }, { errors: 20, blocked: 205, available: 0 }]) {
    const r = shouldWrite({ availableCount: 192, collapseStreak: 2 }, ok(bad), NIGHTS);
    assert.strictEqual(r.write, false, `must refuse ${JSON.stringify(bad)}`);
    assert.strictEqual(r.collapseStreak, 0, `must reset streak for ${JSON.stringify(bad)}`);
  }
});

test('a unit with no prior baseline is not subject to the collapse gate at all', () => {
  // First-ever scrape of a brand-new unit: nothing to compare against, and a
  // fully-blocked new unit is a legitimate state.
  const r = shouldWrite(null, ok({ blocked: 210, available: 0 }), NIGHTS);
  assert.strictEqual(r.write, true);
  assert.strictEqual(r.reason, 'ok');
});
