const { ymd } = require('./dates');
const { findBlockedPerNight } = require('./probe');
const cfg = require('./config');

// Open the property page, trigger the booking calendar, and read property_id + token.
async function sniffPidToken(page, propertyUrl) {
  let pid = '';
  page.on('request', (r) => {
    if (r.url().includes('/requests/') && /update-receipt/.test(r.postData() || '')) {
      pid = (r.postData().match(/property_id=(\d+)/) || [])[1] || pid;
    }
  });

  let token = '';
  for (let attempt = 1; attempt <= 3 && (!pid || !token); attempt++) {
    await page.goto(propertyUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (!page.url().includes('/property/')) {
      throw new Error(`slug-not-found (redirected to ${page.url()})`);
    }
    token = await page.evaluate(() => document.querySelector('input[name="token"]')?.value || '');
    await page.evaluate(() => document.querySelector('#reservation_dates')?.click());
    await page.waitForTimeout(1500);
    try {
      await page.waitForSelector('.caleran-day:not(.caleran-not-in-month)', { state: 'visible', timeout: 8000 });
    } catch {}
    const cells = await page.$$('.caleran-day:not(.caleran-not-in-month)');
    const visible = [];
    for (const c of cells) if (await c.isVisible().catch(() => false)) visible.push(c);
    if (visible.length >= 5) {
      try {
        await visible[2].click({ force: true, timeout: 8000 });
        await page.waitForTimeout(400);
        await visible[4].click({ force: true, timeout: 8000 });
        await page.waitForTimeout(1700);
      } catch {}
    }
  }
  if (!pid || !token) throw new Error(`missing pid/token (pid=${pid} token=${token ? 'ok' : 'none'})`);
  return { pid, token };
}

// Build a probeRange(d1, d2) bound to one unit's page/pid/token.
function makeProbeRange(page, { pid, token }) {
  return async (d1, d2) => {
    const r = await page.request.post(cfg.RECEIPT_URL, {
      form: {
        token, language: 'en', on_application: '0', property_id: pid,
        start_date: ymd(d1), end_date: ymd(d2), guests: '1', action: 'update-receipt',
      },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      timeout: 30000,
    });
    const body = await r.text();
    if (/not available/i.test(body)) return 'blocked';
    if (r.status() === 200 && /Base Price|Grand Total/i.test(body)) return 'available';
    return 'error';
  };
}

// Compute how many nights the horizon spans (current month + HORIZON_MONTHS-1 ahead).
function horizonNights(startDate, months) {
  const end = new Date(startDate.getFullYear(), startDate.getMonth() + months, startDate.getDate());
  return Math.round((end - startDate) / 86400000);
}

// Scrape one unit. Returns { wp, pid, ok, blocked:[], available:[], errors:[] }.
async function scrapeUnit(context, unit, { startDate }) {
  const page = await context.newPage();
  const url = `${cfg.PROPERTY_BASE}/${unit.bbSlug}/`;
  try {
    const { pid, token } = await sniffPidToken(page, url);
    const nights = horizonNights(startDate, cfg.HORIZON_MONTHS);
    const probeRange = makeProbeRange(page, { pid, token });
    const { blocked, available, errors } = await findBlockedPerNight({
      startDate, nights, concurrency: cfg.NIGHT_CONCURRENCY, probeRange,
    });
    return { wp: unit.wp, pid, ok: true, blocked, available, errors };
  } catch (e) {
    return { wp: unit.wp, pid: '', ok: false, blocked: [], available: [], errors: [{ reason: String(e).slice(0, 160) }] };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { sniffPidToken, makeProbeRange, horizonNights, scrapeUnit };
