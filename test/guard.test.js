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
  assert.strictEqual(shouldWrite(null, ok({ available: 50, errors: 120 }), NIGHTS).write, false);
});

test('refuses a suspicious availability collapse vs previous run', () => {
  const prev = { availableCount: 200 };
  // previously 200 available, now only 40 -> likely a scrape glitch, keep last-good
  assert.strictEqual(shouldWrite(prev, ok({ available: 40, blocked: 5 }), NIGHTS).write, false);
});

test('accepts a legitimate availability drop (still > 50% of prior)', () => {
  const prev = { availableCount: 200 };
  assert.strictEqual(shouldWrite(prev, ok({ available: 150, blocked: 55 }), NIGHTS).write, true);
});
