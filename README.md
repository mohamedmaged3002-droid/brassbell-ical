# brassbell-ical

Two daily/6-hourly GitHub Actions jobs keep the live BlueKeys site (bluekeys.co)
in sync with brassbell.net, since Brassbell has no API or operator feed:

1. **Availability → iCal** (`sync.yml`, every 6h) — scrapes blocked dates, publishes
   one `.ics` feed per unit on GitHub Pages, auto-wires URLs into Supabase `listing_ical`.
2. **Prices → unit_daily_prices** (`prices.yml`, daily) — scrapes the nightly USD rate
   per unit, converts USD→EGP at a **live** FX rate, and replaces `unit_daily_prices`
   (`source='brassbell'`). This is the only guest-facing price source, so it keeps the
   site's Brassbell prices current instead of a frozen one-off snapshot.

## Scripts
- `npm run sync`    — availability scrape → `docs/{wp}.ics` + `index.json` + `report.json`
- `npm run wire`    — upsert feed URLs into Supabase `listing_ical`
- `npm run prices`  — nightly-price scrape → USD→EGP → replace `unit_daily_prices`
- `npm test`        — unit tests for the pure modules

Feed URL pattern: `https://mohamedmaged3002-droid.github.io/brassbell-ical/{wp_post_id}.ics`

## Price sync details (`prices-sync.js`)
- Scrapes each **published** Brassbell unit's nightly "Base Price" (USD) for the next
  `PRICE_HORIZON_DAYS` nights (default 365) via the same calendar/`update-receipt` flow.
- **FX:** the workflow pins `FX_RATE=50` (operator choice 2026-06-25), so website EGP =
  USD × 50. `src/fx.js` can instead fetch a live USD→EGP rate (keyless, dual-source) when
  `FX_RATE` is unset — the pound drifts (~53 in May 2026, ~49.6 in June 2026).
- **Safety:** per-unit replace — a flaky unit keeps yesterday's prices rather than going
  blank; the whole run **aborts without writing** if `<60%` of units scrape cleanly
  (`MIN_OK_FRACTION`) or the FX lookup fails. Test with `DRY_RUN=1 LIMIT=3`.
- Prices appear on the live site within ~1h (Next.js `unit-daily-prices` cache revalidate).

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`).
