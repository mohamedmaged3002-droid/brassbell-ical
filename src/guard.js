// Decide whether a fresh scrape result should overwrite the last-good .ics.
// prev: { availableCount } from the previous index.json entry, or null.
// current: { ok, blocked, available, errors } counts from this scrape.
function shouldWrite(prev, current, nights) {
  const { ok, blocked, available, errors } = current;
  if (!ok) return { write: false, reason: 'scrape-not-ok' };

  const classified = blocked + available;
  if (classified === 0) return { write: false, reason: 'zero-classified' };
  // Errored nights publish as OPEN (the feed only emits BLOCKED dates), so a
  // sloppy scrape could re-open a real block. Demand near-complete coverage and
  // tolerate only a tiny error fraction; residual errored nights are then folded
  // into BLOCKED by the caller as a belt-and-braces conservative measure.
  if (classified < nights * 0.95) return { write: false, reason: 'low-coverage' };
  if (errors > nights * 0.05) return { write: false, reason: 'too-many-errors' };

  if (prev && typeof prev.availableCount === 'number' && prev.availableCount > 0) {
    if (available < prev.availableCount * 0.5) {
      return { write: false, reason: 'availability-collapse' };
    }
  }
  return { write: true, reason: 'ok' };
}

module.exports = { shouldWrite };
