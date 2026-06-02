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
  try {
    const j = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    const map = {};
    for (const e of j.properties || []) map[e.wp] = e;
    return map;
  } catch { return {}; }
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
        const ranges = collapseBlocked(res.blocked);
        const ics = buildIcal({ wp: unit.wp, title: unit.title, ranges });
        fs.writeFileSync(path.join(OUT, `${unit.wp}.ics`), ics, 'utf8');
        report.written++;
        index.push({ wp: unit.wp, slug: unit.slug, title: unit.title, blockedRanges: ranges.length, availableCount: counts.available });
        console.log(`  [${unit.wp}] WROTE blocked=${counts.blocked} available=${counts.available} ranges=${ranges.length}`);
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
