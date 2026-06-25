const test = require('node:test');
const assert = require('node:assert');
const { diffUnit, buildMessage } = require('../src/changes');

const FX = 50;
const egp = (usd) => usd * FX;

test('no change → empty', () => {
  const o = { '2026-08-01': egp(255), '2026-08-02': egp(255) };
  assert.deepStrictEqual(diffUnit(o, { ...o }, FX), []);
});

test('flat price bump collapses to one range', () => {
  const o = {}, n = {};
  for (let d = 1; d <= 5; d++) { o[`2026-08-0${d}`] = egp(255); n[`2026-08-0${d}`] = egp(270); }
  const r = diffUnit(o, n, FX);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0], { from: '2026-08-01', to: '2026-08-05', oldUsd: 255, newUsd: 270 });
});

test('two distinct changes → two ranges', () => {
  const o = { '2026-12-30': egp(78), '2026-12-31': egp(100) };
  const n = { '2026-12-30': egp(85), '2026-12-31': egp(110) };
  const r = diffUnit(o, n, FX);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map((x) => [x.oldUsd, x.newUsd]), [[78, 85], [100, 110]]);
});

test('availability flips (priced↔blocked) are IGNORED — only real reprices count', () => {
  const o = { '2026-09-01': egp(120), '2026-09-03': egp(120) };  // 09-01 priced, 09-03 priced
  const n = { '2026-09-02': egp(120), '2026-09-03': egp(140) };  // 09-01 booked, 09-02 freed, 09-03 repriced
  const r = diffUnit(o, n, FX);
  // 09-01 (priced→gone) and 09-02 (gone→priced) are availability, ignored.
  // Only 09-03 is a real price change.
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0], { from: '2026-09-03', to: '2026-09-03', oldUsd: 120, newUsd: 140 });
});

test('buildMessage formats WhatsApp + email', () => {
  const units = [
    { wp: 70001, title: '1 Bedroom Royal suite', area: 'Zamalek', ranges: diffUnit({ '2026-08-01': egp(255) }, { '2026-08-01': egp(270) }, FX) },
    { wp: 70063, title: 'One Bedroom Apt', area: 'Alexandria', ranges: diffUnit({ '2026-12-31': egp(100) }, { '2026-12-31': egp(110) }, FX) },
  ];
  const m = buildMessage(units, { sheetUrl: 'https://drive/x', dateStr: '2026-06-26' });
  assert.match(m.whatsapp, /Brassbell price changes \(2026-06-26\)/);
  assert.match(m.whatsapp, /2 units changed/);
  assert.match(m.whatsapp, /\[bb70001\]/);
  assert.match(m.whatsapp, /\$255 → \$270/);
  assert.match(m.whatsapp, /Sheet: https:\/\/drive\/x/);
  assert.match(m.emailSubject, /2 units/);
  assert.strictEqual(buildMessage([], {}), null);
  console.log('\n--- sample WhatsApp message ---\n' + m.whatsapp + '\n');
});
