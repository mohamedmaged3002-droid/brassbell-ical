const { test } = require('node:test');
const assert = require('node:assert');
const { findBlockedPerNight, findBlockedCoarse } = require('../src/probe');
const { iso } = require('../src/dates');

// Range-aware fake: a range [d1,d2) is 'blocked' if ANY night in it is blocked
// (mirrors brassbell's update-receipt behaviour). Counts calls.
function rangeProbe(blockedSet, counter) {
  return async (d1, d2) => {
    if (counter) counter.n++;
    for (let d = new Date(d1); d < d2; d.setDate(d.getDate() + 1)) {
      if (blockedSet.has(iso(d))) return 'blocked';
    }
    return 'available';
  };
}

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

test('findBlockedCoarse matches per-night results for a synthetic calendar', async () => {
  const start = new Date(2026, 5, 1);
  const blocked = new Set(['2026-06-05', '2026-06-06', '2026-06-20']);
  const counter = { n: 0 };
  const res = await findBlockedCoarse({
    startDate: start, nights: 30, chunk: 7, concurrency: 2, probeRange: rangeProbe(blocked, counter),
  });
  assert.deepStrictEqual(res.blocked.sort(), ['2026-06-05', '2026-06-06', '2026-06-20']);
  assert.strictEqual(res.available.length, 27);
  assert.strictEqual(res.errors.length, 0);
  assert.ok(counter.n < 30, `coarse should use fewer than 30 probes, used ${counter.n}`);
});

test('findBlockedCoarse on a fully-open calendar uses only chunk-count probes', async () => {
  const start = new Date(2026, 5, 1);
  const counter = { n: 0 };
  const res = await findBlockedCoarse({
    startDate: start, nights: 28, chunk: 14, concurrency: 1, probeRange: rangeProbe(new Set(), counter),
  });
  assert.strictEqual(res.blocked.length, 0);
  assert.strictEqual(res.available.length, 28);
  assert.strictEqual(counter.n, 2); // 28 nights / 14 = 2 chunk probes, no subdivision
});

test('findBlockedCoarse classifies a single trailing blocked night', async () => {
  const start = new Date(2026, 5, 1);
  const blocked = new Set(['2026-06-30']); // last night of a 30-night horizon
  const res = await findBlockedCoarse({
    startDate: start, nights: 30, chunk: 14, concurrency: 2, probeRange: rangeProbe(blocked),
  });
  assert.deepStrictEqual(res.blocked, ['2026-06-30']);
  assert.strictEqual(res.available.length, 29);
});
