const { test } = require('node:test');
const assert = require('node:assert');
const { ymd, iso, addDays, nightsAhead, collapseBlocked } = require('../src/dates');

test('ymd formats a Date as YYYYMMDD', () => {
  assert.strictEqual(ymd(new Date(2026, 5, 2)), '20260602'); // month is 0-based -> June
});

test('iso formats a Date as YYYY-MM-DD', () => {
  assert.strictEqual(iso(new Date(2026, 5, 2)), '2026-06-02');
});

test('addDays moves the date forward', () => {
  assert.strictEqual(iso(addDays(new Date(2026, 5, 30), 2)), '2026-07-02');
});

test('nightsAhead returns N consecutive dates from start', () => {
  const list = nightsAhead(new Date(2026, 5, 1), 3);
  assert.deepStrictEqual(list.map(iso), ['2026-06-01', '2026-06-02', '2026-06-03']);
});

test('collapseBlocked merges consecutive ISO dates into [start, endExclusive) ranges', () => {
  const ranges = collapseBlocked(['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-10']);
  assert.deepStrictEqual(ranges, [
    { start: '2026-06-02', endExclusive: '2026-06-05' },
    { start: '2026-06-10', endExclusive: '2026-06-11' },
  ]);
});

test('collapseBlocked sorts and de-dupes input', () => {
  const ranges = collapseBlocked(['2026-06-04', '2026-06-02', '2026-06-03', '2026-06-03']);
  assert.deepStrictEqual(ranges, [{ start: '2026-06-02', endExclusive: '2026-06-05' }]);
});

test('collapseBlocked on empty input returns empty array', () => {
  assert.deepStrictEqual(collapseBlocked([]), []);
});
