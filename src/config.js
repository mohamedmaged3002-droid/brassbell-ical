// Central tunables. Keep concurrency conservative — brassbell.net is a small site.
module.exports = {
  HORIZON_MONTHS: 7,          // current month + 6 ahead
  // Concurrency (env-overridable for tuning). Keep the product low — brassbell.net
  // rate-limits: UNIT_CONCURRENCY*NIGHT_CONCURRENCY ~18 tripped a throttle mid-run.
  UNIT_CONCURRENCY: Number(process.env.UNIT_CONCURRENCY) || 2,   // units scraped in parallel (each owns a browser context)
  NIGHT_CONCURRENCY: Number(process.env.NIGHT_CONCURRENCY) || 5, // concurrent range-probes within a single unit
  COARSE_CHUNK: Number(process.env.COARSE_CHUNK) || 14,          // coarse-probe window size (nights); subdivide only blocked chunks
  PROPERTY_BASE: 'https://www.brassbell.net/property',
  RECEIPT_URL: 'https://www.brassbell.net/requests/',
  PAGES_BASE_URL: 'https://mohamedmaged3002-droid.github.io/brassbell-ical',
  USER_AGENT:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};
