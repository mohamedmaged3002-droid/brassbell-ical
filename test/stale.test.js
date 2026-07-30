const { test } = require('node:test');
const assert = require('node:assert');
const { annotateStaleFeeds } = require('../src/stale');

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

const UNITS = [{ wp: 1 }, { wp: 2 }, { wp: 3 }];
const INDEX = [
  { wp: 1, slug: 'fresh', lastWrittenAt: hoursAgo(2) },
  { wp: 2, slug: 'stale-72h', lastWrittenAt: hoursAgo(72) },
  { wp: 3, slug: 'never-written' },                              // no lastWrittenAt at all
  { wp: 9, slug: 'orphan-outside-roster', lastWrittenAt: hoursAgo(900) },
];

const run = (index = INDEX, units = UNITS, onlyArgs = [], skipped = [{ wp: 2, reason: 'availability-collapse' }]) =>
  annotateStaleFeeds({ skipped }, index, units, onlyArgs, NOW);

test('flags a feed not rewritten inside the window, with its skip reason', () => {
  const r = run();
  const s = r.staleFeeds.find((x) => x.wp === 2);
  assert.ok(s, 'the 72h-old feed must be flagged');
  assert.strictEqual(s.ageHours, 72);
  assert.strictEqual(s.reason, 'availability-collapse');
});

test('a feed with no lastWrittenAt is stale, not assumed fresh', () => {
  // This is the 70149 case: no evidence it was ever written must never read as OK.
  const s = run().staleFeeds.find((x) => x.wp === 3);
  assert.ok(s, 'a feed with no write record must be flagged');
  assert.strictEqual(s.ageHours, null);
  assert.strictEqual(s.reason, 'not-scraped-this-run');
});

test('a freshly written feed is not flagged', () => {
  assert.strictEqual(run().staleFeeds.some((x) => x.wp === 1), false);
});

test('entries outside the published roster are reported separately, not as stale', () => {
  // Drafted/delisted units keep an index entry; counting them as stale would hold
  // the CI alarm permanently red and train everyone to ignore it.
  const r = run();
  assert.deepStrictEqual(r.orphanFeeds, [9]);
  assert.strictEqual(r.staleFeeds.some((x) => x.wp === 9), false);
});

test('a clean full run emits an empty verdict, not a missing one', () => {
  const r = run([{ wp: 1, slug: 'fresh', lastWrittenAt: hoursAgo(1) }], [{ wp: 1 }], [], []);
  assert.deepStrictEqual(r.staleFeeds, []);
  assert.strictEqual(r.filtered, false);
});

test('a FILTERED run emits no verdict at all (fails closed downstream)', () => {
  // A 1-unit roster cannot speak for the fleet. check-stale.js rejects a report
  // with no staleFeeds array, so withholding the verdict is the safe move.
  const r = run(INDEX, UNITS, [70149]);
  assert.strictEqual(r.filtered, true);
  assert.strictEqual(r.staleFeeds, undefined, 'must NOT publish a fleet verdict from a filtered run');
  assert.strictEqual(r.orphanFeeds, undefined);
});
