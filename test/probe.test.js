const { test } = require('node:test');
const assert = require('node:assert');
const { findBlockedPerNight } = require('../src/probe');
const { iso } = require('../src/dates');

// Fake probe: dates in `blockedSet` are blocked, everything else available.
function fakeProbe(blockedSet, errorSet = new Set()) {
  return async (d1) => {
    const key = iso(d1);
    if (errorSet.has(key)) return 'error';
    return blockedSet.has(key) ? 'blocked' : 'available';
  };
}

test('classifies every night via the injected probe', async () => {
  const start = new Date(2026, 5, 1); // 2026-06-01
  const blocked = new Set(['2026-06-03', '2026-06-04']);
  const res = await findBlockedPerNight({
    startDate: start, nights: 5, concurrency: 2, probeRange: fakeProbe(blocked),
  });
  assert.deepStrictEqual(res.blocked.sort(), ['2026-06-03', '2026-06-04']);
  assert.strictEqual(res.available.length, 3);
  assert.strictEqual(res.errors.length, 0);
});

test('records errored nights separately', async () => {
  const start = new Date(2026, 5, 1);
  const res = await findBlockedPerNight({
    startDate: start, nights: 3, concurrency: 3,
    probeRange: fakeProbe(new Set(), new Set(['2026-06-02'])),
  });
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].date, '2026-06-02');
  assert.strictEqual(res.available.length, 2);
});
