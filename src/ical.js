const { ymd, parseIso } = require('./dates');

function esc(text) {
  return String(text || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
}

// { wp, title, ranges:[{start, endExclusive}] } -> iCal text (\r\n terminated).
function buildIcal({ wp, title, ranges = [] }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BlueKeys Brassbell iCal Bridge//EN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(title)}`,
    'CALSCALE:GREGORIAN',
  ];
  for (const r of ranges) {
    const startYmd = ymd(parseIso(r.start));
    lines.push(
      'BEGIN:VEVENT',
      `UID:brassbell-${wp}-${startYmd}@bluekeys.co`,
      `DTSTART;VALUE=DATE:${startYmd}`,
      `DTEND;VALUE=DATE:${ymd(parseIso(r.endExclusive))}`,
      'SUMMARY:BLOCKED',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildIcal };
