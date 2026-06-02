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
const { horizonNights } = require('./src/scrape');
const cfg = require('./src/config');

const OUT = path.join(__dirname, 'docs');

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

  const sb = getSupabase();
  let units = await loadBrassbellUnits(sb);
  if (onlyArgs.length) units = units.filter((u) => onlyArgs.includes(u.wp));
  console.log(`Scraping ${units.length} units, horizon=${nights} nights, unit-concurrency=${cfg.UNIT_CONCURRENCY}`);

  const prev = loadPrevIndex();
  const browser = await chromium.launch({ headless: true });
  const index = [];
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
        index.push({ wp: unit.wp, slug: unit.slug, title: unit.title, blockedRanges: ranges.length, availableCount: counts.available, erroredBlocked: erroredDates.length });
        console.log(`  [${unit.wp}] WROTE blocked=${counts.blocked} available=${counts.available} errored->blocked=${erroredDates.length} ranges=${ranges.length}`);
      } else {
        // Keep last-good .ics; carry the previous index entry forward if it existed.
        if (prev[unit.wp]) index.push(prev[unit.wp]);
        report.skipped.push({ wp: unit.wp, reason: decision.reason, ...counts });
        console.log(`  [${unit.wp}] SKIP (${decision.reason}) blocked=${counts.blocked} available=${counts.available} errors=${counts.errors}`);
      }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: cfg.UNIT_CONCURRENCY }, () => worker()));
  await browser.close();

  index.sort((a, b) => a.wp - b.wp);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ updatedAt: report.finishedAt, properties: index }, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nDone: wrote ${report.written}, skipped ${report.skipped.length}, indexed ${index.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
