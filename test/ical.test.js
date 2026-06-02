const { test } = require('node:test');
const assert = require('node:assert');
const { buildIcal } = require('../src/ical');

test('buildIcal emits a VCALENDAR with one VEVENT per range', () => {
  const ics = buildIcal({
    title: 'Test Unit',
    ranges: [
      { start: '2026-06-02', endExclusive: '2026-06-05' },
      { start: '2026-06-10', endExclusive: '2026-06-11' },
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:Test Unit\r\n/);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20260602\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260605\r\n/);
  assert.match(ics, /SUMMARY:BLOCKED\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildIcal uses \\r\\n line endings throughout', () => {
  const ics = buildIcal({ title: 'X', ranges: [{ start: '2026-06-02', endExclusive: '2026-06-03' }] });
  assert.ok(!/[^\r]\n/.test(ics), 'every \\n must be preceded by \\r');
});

test('buildIcal escapes commas and semicolons in the title', () => {
  const ics = buildIcal({ title: 'A, B; C', ranges: [] });
  assert.match(ics, /X-WR-CALNAME:A\\, B\\; C\r\n/);
});

test('buildIcal with no ranges still produces a valid empty calendar', () => {
  const ics = buildIcal({ title: 'Empty', ranges: [] });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('buildIcal embeds the wp id and range start in the UID', () => {
  const ics = buildIcal({ wp: 99, title: 'X', ranges: [{ start: '2026-06-02', endExclusive: '2026-06-03' }] });
  assert.match(ics, /UID:brassbell-99-20260602@bluekeys\.co\r\n/);
});
