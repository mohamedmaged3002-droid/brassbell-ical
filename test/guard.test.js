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
