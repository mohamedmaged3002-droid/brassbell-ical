// Email the CHANGED UNITS ONLY as an xlsx attachment — ONLY when prices-sync.js
// detected a real price change (out/change-message.json is non-null). The body is
// minimal (all detail is in the attached sheet); the full OTA sheet is NOT attached
// and the Drive link is NOT included (that sheet still refreshes to Drive daily).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { notifyEmail } = require('./src/notify');

(async () => {
  const msgPath = path.join(__dirname, 'out', 'change-message.json');
  if (!fs.existsSync(msgPath)) { console.log('send-alert: no change-message.json — skipping.'); return; }
  const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
  if (!msg || !msg.emailSubject) { console.log('send-alert: no price changes — no email.'); return; }

  const dateStr = new Date().toISOString().slice(0, 10);
  const changesXlsx = path.join(__dirname, 'out', 'brassbell-changes.xlsx');
  const attachments = fs.existsSync(changesXlsx)
    ? [{ filename: `Brassbell price changes ${dateStr}.xlsx`, path: changesXlsx }]
    : [];
  if (!attachments.length) console.log('send-alert: changes sheet not found — sending text-only.');

  const body = [
    `${msg.emailSubject}.`,
    '',
    'See the attached sheet — changed units only (old → new price + change, in USD).',
    '',
    'Source: brassbell.net daily scrape. Automated (brassbell-ical).',
  ].join('\n');

  const ok = await notifyEmail(msg.emailSubject, body, attachments);
  if (!ok) process.exitCode = 1;
})().catch((e) => { console.error(String(e)); process.exit(1); });
