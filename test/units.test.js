const { test } = require('node:test');
const assert = require('node:assert');
const { bbSlug } = require('../src/units');

test('bbSlug passes through a clean slug', () => {
  assert.strictEqual(bbSlug('1-bedroom-suite'), '1-bedroom-suite');
});
test('bbSlug strips a legacy brassbell- prefix', () => {
  assert.strictEqual(bbSlug('brassbell-1-bedroom-suite'), '1-bedroom-suite');
});
