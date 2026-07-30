// Stale-feed detection (L-074).
//
// A skipped unit keeps serving its last-good .ics: HTTP 200, well-formed,
// parseable — and possibly months out of date. Every reachability and
// parseability check passes it, and so does membership in docs/index.json,
// because loadPrevIndex() carries skipped entries forward. The only artifact
// that ever knew was report.skipped[], and nothing read it for the 39 days
// wp 70149 told the OTAs an apartment let until 2027-03-30 was free in August.
//
// So make the age explicit and let CI fail on it (check-stale.js).

// A feed not rewritten in this long is serving stale availability.
const STALE_FEED_HOURS = Number(process.env.STALE_FEED_HOURS) || 48;

/**
 * Mutates `report`: always sets `filtered`; on a full run also sets
 * `staleFeedHours`, `staleFeeds` and `orphanFeeds`.
 *
 * @param report   the run report (needs `skipped`)
 * @param index    index.json entries for this run (needs wp, slug, lastWrittenAt)
 * @param units    the roster actually scraped this run
 * @param onlyArgs wp filter from argv, empty for a full run
 * @param now      injectable clock (ms) — tests only
 */
function annotateStaleFeeds(report, index, units, onlyArgs, now = Date.now()) {
  // A filtered/gap-fill run (`node sync.js 70149`) has a roster of one, so a
  // staleness verdict from it would be meaningless — and would read as an
  // all-clear. Emit no verdict rather than a false one: check-stale.js treats a
  // missing staleFeeds array as an error, so this fails CLOSED.
  report.filtered = onlyArgs.length > 0;
  if (report.filtered) return report;

  // Scoped to the CURRENT roster: index.json also carries entries for units since
  // drafted/delisted, whose feeds are a separate cleanup (orphanFeeds) and must
  // not hold the alarm permanently red.
  const roster = new Set(units.map((u) => u.wp));
  const cutoff = now - STALE_FEED_HOURS * 3600_000;
  report.staleFeedHours = STALE_FEED_HOURS;
  report.staleFeeds = index
    .filter((e) => roster.has(e.wp))
    .map((e) => ({ entry: e, at: e.lastWrittenAt ? Date.parse(e.lastWrittenAt) : NaN }))
    // A missing lastWrittenAt counts as stale: it means we have no evidence the
    // feed was ever written — exactly the 70149 case before this change.
    .filter(({ at }) => !Number.isFinite(at) || at < cutoff)
    .map(({ entry, at }) => ({
      wp: entry.wp,
      slug: entry.slug,
      lastWrittenAt: entry.lastWrittenAt || null,
      ageHours: Number.isFinite(at) ? Math.round((now - at) / 3600_000) : null,
      reason: (report.skipped.find((s) => s.wp === entry.wp) || {}).reason || 'not-scraped-this-run',
    }));
  report.orphanFeeds = index.filter((e) => !roster.has(e.wp)).map((e) => e.wp);
  return report;
}

module.exports = { annotateStaleFeeds, STALE_FEED_HOURS };
