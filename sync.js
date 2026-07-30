require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getSupabase } = require('./src/supabase');
const { loadBrassbellUnits } = require('./src/units');
const { scrapeUnit } = require('./src/scrape');
const { collapseBlocked } = require('./src/dates');
const { buildIcal } = require('./src/ical');
const { shouldWrite } = require('./src/guard');
const { annotateStaleFeeds } = require('./src/stale');
const { horizonNights } = require('./src/scrape');
const cfg = require('./src/config');

const { bbSlug } = require('./src/units');

const OUT = path.join(__dirname, 'docs');

// Default source is Supabase. If BRASSBELL_UNITS_FILE is set, load the unit list
// from that JSON file instead (array of { wp, slug?, bbSlug?, title? }). Useful
// for bootstrap/offline runs and as a CI fallback if Supabase is unreachable.
async function loadUnits() {
  const file = process.env.BRASSBELL_UNITS_FILE;
  if (file) {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`Loaded ${arr.length} units from file ${file}`);
    return arr.map((u) => {
      const slug = u.slug || u.bbSlug;
      return { wp: u.wp, slug, bbSlug: u.bbSlug || bbSlug(slug), title: u.title || slug };
    });
  }
  return loadBrassbellUnits(getSupabase());
}

function loadPrevIndex() {
  const p = path.join(OUT, 'index.json');
  if (!fs.existsSync(p)) return {}; // legit first run — no prior index
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // File exists but is unreadable/corrupt. Fail CLOSED: running with an empty
    // prev would silently disable the availability-collapse guard and drop the
    // index carry-forward for skipped units. Abort so the last-good docs/ tree
    // on disk is preserved untouched.
    throw new Error(
      `docs/index.json exists but could not be parsed (${e.message}). ` +
      `Aborting to preserve last-good feeds — fix or delete docs/index.json before re-running.`
    );
  }
  const map = {};
  for (const e of j.properties || []) map[e.wp] = e;
  return map;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const onlyArgs = process.argv.slice(2).map(Number).filter(Boolean); // optional wp filter
  const startDate = new Date(); startDate.setHours(12, 0, 0, 0);
  const nights = horizonNights(startDate, cfg.HORIZON_MONTHS);

  let units = await loadUnits();
  if (onlyArgs.length) units = units.filter((u) => onlyArgs.includes(u.wp));
  console.log(`Scraping ${units.length} units, horizon=${nights} nights, unit-concurrency=${cfg.UNIT_CONCURRENCY}`);

  const prev = loadPrevIndex();
  // Seed the index map with all prior entries so a filtered/gap-fill run
  // preserves units it doesn't touch this pass. Written units overwrite their
  // entry; skipped units keep their prior (last-good) entry.
  const indexMap = {};
  for (const wp of Object.keys(prev)) indexMap[wp] = prev[wp];
  const browser = await chromium.launch({ headless: true });
  const report = { startedAt: new Date().toISOString(), nights, written: 0, skipped: [], units: [] };

  let idx = 0;
  async function worker() {
    const ctx = await browser.newContext({ userAgent: cfg.USER_AGENT });
    while (idx < units.length) {
      const unit = units[idx++];
      const res = await scrapeUnit(ctx, unit, { startDate });
      const counts = { ok: res.ok, blocked: res.blocked.length, available: res.available.length, errors: res.errors.length };
      const decision = shouldWrite(prev[unit.wp] || null, counts, nights);
      report.units.push({ wp: unit.wp, ...counts, decision: decision.reason });

      if (decision.write) {
        // Conservative: treat any night we couldn't classify as BLOCKED rather
        // than OPEN, so a probe failure never re-opens a date (worst case a free
        // night shows the WhatsApp CTA; far safer than a double-booking).
        const erroredDates = res.errors.filter((e) => e.date).map((e) => e.date);
        const ranges = collapseBlocked([...res.blocked, ...erroredDates]);
        const ics = buildIcal({ wp: unit.wp, title: unit.title, ranges });
        fs.writeFileSync(path.join(OUT, `${unit.wp}.ics`), ics, 'utf8');
        report.written++;
        indexMap[unit.wp] = {
          wp: unit.wp, slug: unit.slug, title: unit.title, blockedRanges: ranges.length,
          availableCount: counts.available, erroredBlocked: erroredDates.length,
          // Freshness of THIS feed, and the collapse counter reset. lastWrittenAt is
          // the only trustworthy age signal: GitHub Pages re-stamps Last-Modified on
          // every deploy, and index.json's own updatedAt is global, not per-unit.
          lastWrittenAt: new Date().toISOString(), collapseStreak: 0,
        };
        console.log(`  [${unit.wp}] WROTE (${decision.reason}) blocked=${counts.blocked} available=${counts.available} errored->blocked=${erroredDates.length} ranges=${ranges.length}`);
      } else {
        // Keep the last-good .ics and its prior index entry, but carry the collapse
        // streak forward — the guard cannot confirm a real off-sale across runs if
        // the counter it compares against is only ever written on success (L-074).
        //
        // Only ever UPDATE an existing entry, never create one: a unit whose first
        // scrape fails has no .ics on Pages, and inventing an index entry would put
        // a 404 URL into links.csv and let wire.js wire it into listing_ical — where
        // a 404 feed reads as fully available (fails open).
        const priorEntry = prev[unit.wp];
        if (priorEntry) indexMap[unit.wp] = { ...priorEntry, collapseStreak: decision.collapseStreak };
        report.skipped.push({ wp: unit.wp, reason: decision.reason, collapseStreak: decision.collapseStreak, ...counts });
        console.log(`  [${unit.wp}] SKIP (${decision.reason}${decision.collapseStreak ? ` ${decision.collapseStreak}/3` : ''}) blocked=${counts.blocked} available=${counts.available} errors=${counts.errors}`);
      }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: cfg.UNIT_CONCURRENCY }, () => worker()));
  await browser.close();

  const index = Object.values(indexMap).sort((a, b) => a.wp - b.wp);
  report.finishedAt = new Date().toISOString();

  // Stale-feed verdict (L-074). src/stale.js stays pure so it can be tested;
  // the operator-facing narration lives here. check-stale.js turns this into a
  // CI failure, in a step deliberately placed AFTER the commit/push.
  annotateStaleFeeds(report, index, units, onlyArgs);
  if (report.filtered) {
    console.log(`\n(i) filtered run (${onlyArgs.join(', ')}) — no stale-feed verdict; it is only meaningful over the full roster.`);
  } else {
    if (report.staleFeeds.length) {
      console.log(`\n!! ${report.staleFeeds.length} feed(s) not written in >${report.staleFeedHours}h — these serve stale availability to the OTAs:`);
      for (const s of report.staleFeeds) {
        console.log(`   [${s.wp}] age=${s.ageHours === null ? 'unknown' : s.ageHours + 'h'} reason=${s.reason} ${s.slug || ''}`);
      }
    }
    if (report.orphanFeeds.length) {
      console.log(`\n(i) ${report.orphanFeeds.length} indexed feed(s) outside the published roster: ${report.orphanFeeds.join(', ')}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ updatedAt: report.finishedAt, properties: index }, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  // links.csv — downloadable directory of every unit + its feed URL, refreshed each run.
  const bySlug = {};
  for (const u of units) bySlug[u.wp] = u.bbSlug;
  const csvEsc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [['wp_post_id', 'title', 'ical_url', 'brassbell_url', 'blocked_ranges', 'available_nights'].join(',')];
  for (const e of index) {
    csv.push([
      e.wp,
      csvEsc(e.title),
      `${cfg.PAGES_BASE_URL}/${e.wp}.ics`,
      bySlug[e.wp] ? `${cfg.PROPERTY_BASE}/${bySlug[e.wp]}/` : '',
      e.blockedRanges ?? '',
      e.availableCount ?? '',
    ].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'links.csv'), csv.join('\n') + '\n');

  console.log(`\nDone: wrote ${report.written}, skipped ${report.skipped.length}, indexed ${index.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
