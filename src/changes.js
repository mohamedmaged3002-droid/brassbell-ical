// Detect Brassbell price changes between the previous DB state and a fresh scrape,
// and format an OTA-facing notification. Prices compared in USD (what you enter on
// OTAs); the DB stores EGP = USD * FX, so USD = round(EGP / FX).
//
// Pure functions — no I/O — so the logic is unit-tested without scraping.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[+m - 1]} ${y.slice(2)}`;
};
const addDay = (iso) => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

// oldEgp / newEgp: { 'YYYY-MM-DD': egpInt }. Returns PRICE-CHANGE ranges only:
// [{ from, to, oldUsd, newUsd }] where a date had a real price on BOTH days and it
// changed. Availability flips (priced↔blocked) are intentionally ignored — those are
// bookings, handled by the iCal availability sync, not OTA rate changes.
function diffUnit(oldEgp, newEgp, fx) {
  const usd = (egp) => (egp == null ? null : Math.round(egp / fx));
  const dates = [...new Set([...Object.keys(oldEgp), ...Object.keys(newEgp)])].sort();
  const changed = [];
  for (const d of dates) {
    const o = usd(oldEgp[d]);
    const n = usd(newEgp[d]);
    if (o != null && n != null && o !== n) changed.push({ date: d, o, n });
  }
  const ranges = [];
  for (const c of changed) {
    const last = ranges[ranges.length - 1];
    if (last && last.oldUsd === c.o && last.newUsd === c.n && c.date === addDay(last.to)) {
      last.to = c.date;
    } else {
      ranges.push({ from: c.date, to: c.date, oldUsd: c.o, newUsd: c.n });
    }
  }
  return ranges;
}

const money = (u) => (u == null ? 'blocked' : `$${u}`);
function fmtRange(r) {
  const lbl = r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)}–${shortDate(r.to)}`;
  return `${lbl}: ${money(r.oldUsd)} → ${money(r.newUsd)}`;
}

// unitsChanged: [{ wp, title, area, code, ranges }]  (only units with >=1 range)
// Returns { whatsapp, emailSubject, emailBody } or null if nothing changed.
function buildMessage(unitsChanged, { sheetUrl, dateStr } = {}) {
  if (!unitsChanged.length) return null;
  const n = unitsChanged.length;
  const head = `BlueKeys · Brassbell price changes${dateStr ? ` (${dateStr})` : ''}`;
  const intro = `${n} unit${n > 1 ? 's' : ''} changed on brassbell.net — update ${n > 1 ? 'these' : 'this'} on the OTAs:`;

  const unitBlock = (u, full) => {
    const name = `${u.title || u.code || u.wp} [bb${u.wp}]${u.area ? ` (${u.area})` : ''}`;
    const rs = full ? u.ranges : u.ranges.slice(0, 3);
    const lines = rs.map((r) => `   • ${fmtRange(r)}`);
    if (!full && u.ranges.length > 3) lines.push(`   • …+${u.ranges.length - 3} more dates`);
    return `▸ ${name}\n${lines.join('\n')}`;
  };

  // Email: everything.
  const emailBody = [head, '', intro, '',
    ...unitsChanged.map((u) => unitBlock(u, true)),
    '', sheetUrl ? `Full sheet: ${sheetUrl}` : '',
  ].filter((x) => x !== undefined).join('\n');

  // WhatsApp: compact, capped so the URL/text stays sendable.
  const MAX = 12;
  const shown = unitsChanged.slice(0, MAX);
  let wa = [head, '', intro, '', ...shown.map((u) => unitBlock(u, false))].join('\n');
  if (unitsChanged.length > MAX) wa += `\n\n…+${unitsChanged.length - MAX} more units — see sheet.`;
  if (sheetUrl) wa += `\n\nSheet: ${sheetUrl}`;

  return { whatsapp: wa, emailSubject: `${head} — ${n} unit${n > 1 ? 's' : ''}`, emailBody };
}

module.exports = { diffUnit, buildMessage, fmtRange, shortDate };
