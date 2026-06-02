const { test } = require('node:test');
const assert = require('node:assert');
const { bbSlug, slugFromSourceUrl } = require('../src/units');

test('bbSlug passes through a clean slug', () => {
  assert.strictEqual(bbSlug('1-bedroom-suite'), '1-bedroom-suite');
});
test('bbSlug strips a legacy brassbell- prefix', () => {
  assert.strictEqual(bbSlug('brassbell-1-bedroom-suite'), '1-bedroom-suite');
});

test('slugFromSourceUrl extracts the /property/ segment', () => {
  assert.strictEqual(
    slugFromSourceUrl('https://www.brassbell.net/property/1-bedroom-royal-suite-king-bed-nile-view/', 'x'),
    '1-bedroom-royal-suite-king-bed-nile-view'
  );
});
test('slugFromSourceUrl wins over a cleaned DB slug', () => {
  // DB slug was cleaned to drop the "brassbell-l-" prefix; the real URL keeps it.
  assert.strictEqual(
    slugFromSourceUrl('https://www.brassbell.net/property/brassbell-l-sh-zayed-aeon-towers-2br-w-kitchen-AEON-2BR-705/', 'sh-zayed-aeon-towers-2br-w-kitchen-AEON-2BR-705'),
    'brassbell-l-sh-zayed-aeon-towers-2br-w-kitchen-AEON-2BR-705'
  );
});
test('slugFromSourceUrl handles trailing query/hash', () => {
  assert.strictEqual(slugFromSourceUrl('https://www.brassbell.net/property/abc-123?x=1', 'y'), 'abc-123');
});
test('slugFromSourceUrl falls back to the bare slug when source_url is empty', () => {
  assert.strictEqual(slugFromSourceUrl(null, 'brassbell-fallback-slug'), 'fallback-slug');
});
