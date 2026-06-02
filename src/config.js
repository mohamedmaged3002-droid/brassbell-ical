// Central tunables. Keep concurrency conservative — brassbell.net is a small site.
module.exports = {
  HORIZON_MONTHS: 7,          // current month + 6 ahead
  UNIT_CONCURRENCY: 3,        // units scraped in parallel (each owns a browser context)
  NIGHT_CONCURRENCY: 6,       // concurrent night-probes within a single unit
  PROPERTY_BASE: 'https://www.brassbell.net/property',
  RECEIPT_URL: 'https://www.brassbell.net/requests/',
  PAGES_BASE_URL: 'https://mohamedmaged3002-droid.github.io/brassbell-ical',
  USER_AGENT:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};
