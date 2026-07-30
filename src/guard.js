// Decide whether a fresh scrape result should overwrite the last-good .ics.
// prev: { availableCount, collapseStreak } from the previous index.json entry, or null.
// current: { ok, blocked, available, errors } counts from this scrape.
//
// Returns { write, reason, collapseStreak }. The caller MUST persist
// collapseStreak on the index entry even when write is false — see below.

// How many consecutive runs must agree that a unit's availability has collapsed
// before we believe them. At the 2h cadence that is ~6h of confirmation.
const COLLAPSE_CONFIRM_RUNS = 3;

function shouldWrite(prev, current, nights) {
  const { ok, blocked, available, errors } = current;
  // Every unhealthy exit resets the streak to 0: the collapse-confirmation below
  // is only meaningful because a REAL off-sale repeats identically run after run,
  // so a broken scrape must never be able to confirm itself.
  if (!ok) return { write: false, reason: 'scrape-not-ok', collapseStreak: 0 };

  const classified = blocked + available;
  if (classified === 0) return { write: false, reason: 'zero-classified', collapseStreak: 0 };
  // Errored nights publish as OPEN (the feed only emits BLOCKED dates), so a
  // sloppy scrape could re-open a real block. Demand near-complete coverage and
  // tolerate only a tiny error fraction; residual errored nights are then folded
  // into BLOCKED by the caller as a belt-and-braces conservative measure.
  if (classified < nights * 0.95) return { write: false, reason: 'low-coverage', collapseStreak: 0 };
  if (errors > nights * 0.05) return { write: false, reason: 'too-many-errors', collapseStreak: 0 };

  if (prev && typeof prev.availableCount === 'number' && prev.availableCount > 0) {
    if (available < prev.availableCount * 0.5) {
      // A halving of availability is usually a scrape glitch — but it is ALSO what
      // a unit going off-sale (long-term let, owner pulled it) looks like, and that
      // state is permanent. Suppressing it forever is not a safe default: this is
      // the one gate whose suppression fails OPEN (feed says available, reality says
      // blocked -> OTA double-booking), because the other four only ever suppress a
      // write that would RE-OPEN nights.
      //
      // Worse, the baseline we compare against (prev.availableCount) is refreshed
      // only when we write, so a permanent collapse used to deadlock the feed for
      // good: brassbell wp 70149 served a 39-day-stale "August is open" feed on an
      // apartment let until 2027-03-30. See L-074.
      //
      // So: still refuse on first sight, but count agreeing observations and accept
      // once enough runs concur. A false confirmation costs bookings (unit shows
      // blocked) — the safe direction — and self-heals, because writing it sets
      // availableCount to 0 and disables this gate until availability returns.
      const streak = (prev.collapseStreak || 0) + 1;
      if (streak >= COLLAPSE_CONFIRM_RUNS) {
        return { write: true, reason: 'availability-collapse-confirmed', collapseStreak: 0 };
      }
      return { write: false, reason: 'availability-collapse', collapseStreak: streak };
    }
  }
  return { write: true, reason: 'ok', collapseStreak: 0 };
}

module.exports = { shouldWrite, COLLAPSE_CONFIRM_RUNS };
