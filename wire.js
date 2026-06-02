require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./src/supabase');
const { wireUnits } = require('./src/wire');
const cfg = require('./src/config');

async function main() {
  const indexPath = path.join(__dirname, 'docs', 'index.json');
  const { properties } = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  // Only wire units that actually have a committed .ics file.
  const entries = properties
    .filter((p) => fs.existsSync(path.join(__dirname, 'docs', `${p.wp}.ics`)))
    .map((p) => ({ wp: p.wp, slug: p.slug, ical_url: `${cfg.PAGES_BASE_URL}/${p.wp}.ics` }));

  const sb = getSupabase();
  const { upserted } = await wireUnits(sb, entries);
  console.log(`Wired ${upserted} listing_ical rows (of ${properties.length} indexed).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
