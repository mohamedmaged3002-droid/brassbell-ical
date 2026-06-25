// Daily Brassbell PRICE refresh for BlueKeys.
//
//   published brassbell units -> scrape nightly USD from brassbell.net
//   -> convert USD->EGP at a LIVE rate -> replace unit_daily_prices (source='brassbell').
//
// Companion to sync.js (which refreshes AVAILABILITY/iCal). Run by
// .github/workflows/prices.yml daily. Safety: a flaky unit keeps yesterday's
// prices; the run aborts without writing if too many units fail or the FX
// lookup fails — we never wipe good prices with a bad scrape.
require('dotenv').config();
const { chromium } = require('playwright');
const { getSupabase } = require('./src/supabase');
const { loadBrassbellUnits } = require('./src/units');
const { scrapeUnitPrices } = require('./src/prices');
const { getUsdEgp } = require('./src/fx');
const { diffUnit, buildMessage } = require('./src/changes');
const { notifyAll } = require('./src/notify');
const cfg = require('./src/config');

const PRICE_HORIZON_DAYS = Number(process.env.PRICE_HORIZON_DAYS) || 365;
const MIN_OK_FRACTION = Number(process.env.MIN_OK_FRACTION) || 0.6;   // abort run below this
const MAX_UNIT_ERROR_RATE = Number(process.env.MAX_UNIT_ERROR_RATE) || 0.1; // skip a unit above this
const DRY_RUN = process.env.DRY_RUN === '1';

const isoToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// Replace one unit's brassbell rows: delete then insert fresh priced rows + blocked dates.
async function writeUnit(sb, wp, egpByDate, blocked) {
  await sb.from('unit_daily_prices').delete().eq('wp_post_id', wp).eq('source', 'brassbell');
  const priceRows = Object.entries(egpByDate).map(([date, price]) => ({
    wp_post_id: wp, date, price, currency: 'EGP', source: 'brassbell',
  }));
  for (const c of chunk(priceRows, 500)) {
    const { error } = await sb.from('unit_daily_prices').insert(c);
    if (error) throw new Error(`insert prices wp=${wp}: ${error.message}`);
  }
  await sb.from('unit_blocked_dates').delete().eq('wp_post_id', wp).eq('source', 'brassbell');
  const blkRows = blocked.map((date) => ({ wp_post_id: wp, date, source: 'brassbell' }));
  for (const c of chunk(blkRows, 500)) {
    const { error } = await sb.from('unit_blocked_dates').insert(c);
    if (error) throw new Error(`insert blocked wp=${wp}: ${error.message}`);
  }
  return priceRows.length;
}

(async () => {
  const sb = getSupabase();
  const { rate: FX, source: fxSrc } = await getUsdEgp();
  if (!(FX > 20 && FX < 200)) throw new Error(`implausible FX ${FX}`);
  console.log(`FX USD->EGP = ${FX} (${fxSrc})`);

  let units = await loadBrassbellUnits(sb);
  const LIMIT = Number(process.env.LIMIT) || 0;   // test aid: scrape only the first N units
  if (LIMIT > 0) units = units.slice(0, LIMIT);
  console.log(`Loaded ${units.length} published Brassbell units${LIMIT ? ` (LIMIT ${LIMIT})` : ''}; horizon ${PRICE_HORIZON_DAYS} nights; DRY_RUN=${DRY_RUN}`);

  const startDate = isoToday();
  const browser = await chromium.launch({ headless: true });

  // Scrape (units in parallel, each its own context).
  const results = await mapLimit(units, cfg.UNIT_CONCURRENCY, async (u) => {
    const ctx = await browser.newContext({ userAgent: cfg.USER_AGENT });
    try {
      const r = await scrapeUnitPrices(ctx, u, {
        startDate, nights: PRICE_HORIZON_DAYS, concurrency: cfg.NIGHT_CONCURRENCY,
      });
      const priced = Object.keys(r.prices).length;
      const probed = priced + r.blocked.length + r.errors.length;
      const errRate = probed ? r.errors.length / probed : 1;
      const cur = [...r.currencies];
      const usable = r.ok && errRate <= MAX_UNIT_ERROR_RATE && cur.length === 1 && cur[0] === 'USD';
      console.log(`  wp=${u.wp} ${u.bbSlug.slice(0, 40)} priced=${priced} blocked=${r.blocked.length} err=${r.errors.length} cur=${cur.join('|') || '-'} ${usable ? 'OK' : 'SKIP'}`);
      return { u, r, priced, errRate, usable };
    } finally {
      await ctx.close().catch(() => {});
    }
  });
  await browser.close();

  const okUnits = results.filter((x) => x.usable);
  const okFrac = results.length ? okUnits.length / results.length : 0;
  console.log(`Scraped OK ${okUnits.length}/${results.length} (${(okFrac * 100).toFixed(0)}%)`);

  if (okFrac < MIN_OK_FRACTION) {
    throw new Error(`ABORT: only ${(okFrac * 100).toFixed(0)}% of units scraped cleanly (< ${MIN_OK_FRACTION * 100}%). ` +
      `Likely site drift or a throttle — refusing to overwrite prices. No DB changes made.`);
  }

  // Convert to EGP and detect changes vs the current live DB (compared in USD) BEFORE writing.
  const changedUnits = [];
  for (const { u, r } of okUnits) {
    const egpByDate = {};
    for (const [date, usd] of Object.entries(r.prices)) egpByDate[date] = Math.round(usd * FX);
    u._egp = egpByDate;
    const { data: existing } = await sb.from('unit_daily_prices')
      .select('date,price').eq('wp_post_id', u.wp).eq('source', 'brassbell');
    const oldEgp = {};
    for (const row of existing || []) oldEgp[row.date] = row.price;
    const ranges = diffUnit(oldEgp, egpByDate, FX);
    if (ranges.length) changedUnits.push({ wp: u.wp, title: u.title, area: u.area, code: u.bbSlug, ranges });
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const msg = buildMessage(changedUnits, { sheetUrl: process.env.SHEET_URL, dateStr });
  console.log(`Detected price changes on ${changedUnits.length} unit(s) vs current DB.`);

  if (DRY_RUN) {
    let totRows = 0;
    for (const { u } of okUnits) totRows += Object.keys(u._egp).length;
    console.log(`DRY_RUN: would replace ${okUnits.length} units / ${totRows} priced rows at FX ${FX}. No writes, no notifications.`);
    if (msg) console.log('\n--- would notify (WhatsApp preview) ---\n' + msg.whatsapp + '\n---------------------------------------');
    return;
  }

  // Write each healthy unit (failed/flaky units keep their existing prices).
  let wroteUnits = 0, wroteRows = 0; const writeErrors = [];
  for (const { u, r } of okUnits) {
    try {
      wroteRows += await writeUnit(sb, u.wp, u._egp, r.blocked);
      wroteUnits += 1;
    } catch (e) {
      writeErrors.push(`wp=${u.wp}: ${String(e).slice(0, 120)}`);
    }
  }
  console.log(`DONE: wrote ${wroteUnits} units / ${wroteRows} EGP rows. skipped(scrape) ${results.length - okUnits.length}. write-errors ${writeErrors.length}`);

  // Notify only after a successful write and only when something actually changed.
  if (msg && wroteUnits > 0) await notifyAll(msg);
  else console.log('No price changes vs DB — no notification sent.');

  if (writeErrors.length) { console.log(writeErrors.join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(String(e)); process.exit(1); });
