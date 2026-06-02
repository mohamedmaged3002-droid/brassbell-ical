const { nightsAhead, iso, addDays } = require('./dates');

// probeRange(d1Date, d2Date) -> Promise<'available'|'blocked'|'error'>
// Probes each night [d, d+1) across the horizon with bounded concurrency.
async function findBlockedPerNight({ startDate, nights, concurrency, probeRange }) {
  const days = nightsAhead(startDate, nights);
  const blocked = [];
  const available = [];
  const errors = [];

  let idx = 0;
  async function worker() {
    while (idx < days.length) {
      const d = days[idx++];
      const next = addDays(d, 1);
      let verdict;
      try {
        verdict = await probeRange(d, next);
      } catch (e) {
        verdict = 'error';
        errors.push({ date: iso(d), reason: String(e).slice(0, 120) });
        continue;
      }
      if (verdict === 'blocked') blocked.push(iso(d));
      else if (verdict === 'available') available.push(iso(d));
      else errors.push({ date: iso(d), reason: 'unclassified' });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return { blocked, available, errors };
}

// Coarse-to-fine: probe `chunk`-night windows; only subdivide a window that comes
// back 'blocked', down to exact nights. For mostly-open calendars this uses far
// fewer requests than per-night (which keeps us under brassbell.net's volume
// throttle). Relies on update-receipt rejecting a whole range if ANY night in it
// is blocked (verified empirically). Equivalent results to findBlockedPerNight.
async function findBlockedCoarse({ startDate, nights, chunk = 14, concurrency, probeRange }) {
  const base = new Date(startDate); base.setHours(12, 0, 0, 0);
  const blocked = [];
  const available = [];
  const errors = [];

  const windows = [];
  for (let off = 0; off < nights; off += chunk) windows.push([off, Math.min(chunk, nights - off)]);

  async function resolve(off, len) {
    const d1 = addDays(base, off);
    const d2 = addDays(base, off + len);
    let verdict;
    try {
      verdict = await probeRange(d1, d2);
    } catch (e) {
      // A failed range probe (e.g. throttled): mark its nights errored rather
      // than subdividing — subdividing on error would amplify request volume,
      // the exact thing we're avoiding. sync.js treats errored nights as BLOCKED
      // and the guard skips the unit if too many error (keeps last-good).
      for (let i = 0; i < len; i++) errors.push({ date: iso(addDays(base, off + i)), reason: String(e).slice(0, 120) });
      return;
    }
    if (verdict === 'available') {
      for (let i = 0; i < len; i++) available.push(iso(addDays(base, off + i)));
    } else if (verdict === 'blocked') {
      if (len === 1) { blocked.push(iso(d1)); return; }
      const half = Math.floor(len / 2);
      await resolve(off, half);
      await resolve(off + half, len - half);
    } else {
      for (let i = 0; i < len; i++) errors.push({ date: iso(addDays(base, off + i)), reason: 'unclassified' });
    }
  }

  let idx = 0;
  async function worker() {
    while (idx < windows.length) {
      const [off, len] = windows[idx++];
      await resolve(off, len);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return { blocked, available, errors };
}

module.exports = { findBlockedPerNight, findBlockedCoarse };
