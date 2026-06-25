// Per-unit NIGHTLY PRICE scrape (vs src/scrape.js which only reads availability).
// For each night POST /requests/ update-receipt and parse the "Base Price" cell
// (USD). 200+price => priced; "not available" => blocked. Reuses sniffPidToken.
const cfg = require('./config');
const { sniffPidToken } = require('./scrape');

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Probe one night -> { kind:'price', usd } | { kind:'blocked' } | { kind:'error', reason }
function makePriceProbe(page, { pid, token }) {
  return async (d) => {
    const d2 = new Date(d); d2.setDate(d2.getDate() + 1);
    try {
      const r = await page.request.post(cfg.RECEIPT_URL, {
        form: {
          token, language: 'en', on_application: '0', property_id: pid,
          start_date: ymd(d), end_date: ymd(d2), guests: '1', action: 'update-receipt',
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        timeout: 30000,
      });
      const body = await r.text();
      if (r.status() === 200) {
        const m = body.match(/Base Price[^<]*<\/td>\s*<td>\s*([\d.]+)\s*([A-Z]{3})/i)
          || body.match(/Grand Total[\s\S]*?<b>\s*([\d.]+)\s*([A-Z]{3})/i);
        if (m) return { kind: 'price', usd: Math.round(parseFloat(m[1])), cur: m[2].toUpperCase() };
        return { kind: 'error', reason: 'no-price-match' };
      }
      if (/not available/i.test(body)) return { kind: 'blocked' };
      return { kind: 'error', reason: `http-${r.status()}` };
    } catch (e) {
      return { kind: 'error', reason: String(e).slice(0, 100) };
    }
  };
}

// Scrape NIGHTS nightly prices for one unit.
// Returns { wp, pid, ok, prices:{iso:usd}, blocked:[iso], errors:[], currencies:Set }
async function scrapeUnitPrices(context, unit, { startDate, nights, concurrency }) {
  const page = await context.newPage();
  const url = `${cfg.PROPERTY_BASE}/${unit.bbSlug}/`;
  try {
    const { pid, token } = await sniffPidToken(page, url);
    const probe = makePriceProbe(page, { pid, token });
    const dates = [];
    for (let n = 0; n < nights; n++) { const d = new Date(startDate); d.setDate(d.getDate() + n); dates.push(d); }

    const prices = {}; const blocked = []; const errors = []; const currencies = new Set();
    let idx = 0;
    async function worker() {
      while (idx < dates.length) {
        const d = dates[idx++];
        const res = await probe(d);
        if (res.kind === 'price') { prices[iso(d)] = res.usd; currencies.add(res.cur); }
        else if (res.kind === 'blocked') blocked.push(iso(d));
        else errors.push({ date: iso(d), reason: res.reason });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { wp: unit.wp, pid, ok: Object.keys(prices).length > 0, prices, blocked: blocked.sort(), errors, currencies };
  } catch (e) {
    return { wp: unit.wp, pid: '', ok: false, prices: {}, blocked: [], errors: [{ reason: String(e).slice(0, 160) }], currencies: new Set() };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { makePriceProbe, scrapeUnitPrices };
