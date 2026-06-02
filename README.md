# brassbell-ical

Scrapes availability from brassbell.net and publishes one iCal (`.ics`) feed per
Brassbell unit, refreshed every 6 hours by GitHub Actions and served from GitHub
Pages. Feed URLs are auto-wired into the BlueKeys Supabase `listing_ical` table so
the live site (bluekeys.co) blocks booked dates automatically.

- `npm run sync`  — scrape brassbell.net, write `docs/{wp_post_id}.ics` + `index.json` + `report.json`
- `npm run wire`  — upsert feed URLs into Supabase `listing_ical`
- `npm test`      — run unit tests for the pure modules

Feed URL pattern: `https://mohamedmaged3002-droid.github.io/brassbell-ical/{wp_post_id}.ics`

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`).
