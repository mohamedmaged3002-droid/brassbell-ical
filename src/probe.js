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

module.exports = { findBlockedPerNight };
