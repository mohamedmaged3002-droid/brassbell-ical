// Fail the CI run if any published unit's .ics has gone stale.
//
// Why this is a separate step and not an exit code inside sync.js: it must run
// AFTER the commit/push step. sync.js's whole job is to write docs/; aborting it
// on a stale feed would abandon 140 freshly-built feeds to save the alarm, and
// per L-062 the outward-facing step goes last.
//
// The signal is report.json.staleFeeds, computed in sync.js. Nothing read that
// file for 39 days while brassbell wp 70149 served a June snapshot claiming
// August was open on an apartment let until 2027-03-30 (L-074).
const fs = require('fs');
const path = require('path');

const REPORT = process.env.REPORT_FILE || path.join(__dirname, 'docs', 'report.json');

if (!fs.existsSync(REPORT)) {
  console.error('check-stale: docs/report.json missing — did sync.js run?');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
} catch (e) {
  console.error(`check-stale: docs/report.json is unparseable (${e.message})`);
  process.exit(1);
}

// A filtered run deliberately emits no verdict — its roster is a handful of units,
// so "nothing stale" would be a lie, not an all-clear.
if (report.filtered) {
  console.error('check-stale: report.json is from a FILTERED run — no fleet-wide verdict available. Re-run `node sync.js` with no arguments.');
  process.exit(1);
}

// An older report predates staleFeeds. Treat that as a setup error rather than a
// pass, so this check can never silently no-op — the failure mode it exists to
// catch is precisely "a check that quietly stopped looking".
if (!Array.isArray(report.staleFeeds)) {
  console.error('check-stale: report.json has no staleFeeds array — sync.js is out of date with this check.');
  process.exit(1);
}

const stale = report.staleFeeds;
const hours = report.staleFeedHours ?? 48;

if (report.orphanFeeds?.length) {
  console.log(`note: ${report.orphanFeeds.length} indexed feed(s) outside the published roster (separate cleanup): ${report.orphanFeeds.join(', ')}`);
}

if (!stale.length) {
  console.log(`check-stale: OK — every published feed written within ${hours}h (wrote ${report.written}, skipped ${report.skipped?.length ?? 0}).`);
  process.exit(0);
}

console.error(`\ncheck-stale: FAIL — ${stale.length} feed(s) not rewritten in >${hours}h.`);
console.error('These serve HTTP 200, well-formed, parseable — and WRONG — availability to the OTAs.\n');
for (const s of stale) {
  console.error(`  wp ${s.wp}  age=${s.ageHours === null ? 'unknown' : s.ageHours + 'h'}  reason=${s.reason}`);
  console.error(`      ${s.slug || ''}`);
  console.error(`      https://mohamedmaged3002-droid.github.io/brassbell-ical/${s.wp}.ics`);
}
console.error(`
What to do (see bluekeys-brain L-074):
  - reason=availability-collapse -> the unit may genuinely be off-sale. The guard
    now confirms it after 3 agreeing runs; if it is still stuck, the scrape is
    reading "not available" for another cause (min-stay, no rate plan, delisted).
  - reason=low-coverage / too-many-errors -> brassbell.net throttled us. Usually
    self-heals; if it persists, lower UNIT_CONCURRENCY * NIGHT_CONCURRENCY.
  - reason=scrape-not-ok -> check the slug against units.source_url (L-019).
  Cross-check the truth with unit_blocked_dates, which prices-sync.js maintains
  independently over a 365-night horizon and has no collapse gate.
`);
process.exit(1);
