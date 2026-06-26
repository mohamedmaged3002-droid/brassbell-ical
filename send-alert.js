// Email the OTA punch-list with the freshly-built sheet attached — ONLY when
// prices-sync.js detected a real price change (out/change-message.json is non-null).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { notifyEmail } = require('./src/notify');

(async () => {
  const msgPath = path.join(__dirname, 'out', 'change-message.json');
  if (!fs.existsSync(msgPath)) { console.log('send-alert: no change-message.json — skipping.'); return; }
  const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
  if (!msg || !msg.emailBody) { console.log('send-alert: no price changes — no email.'); return; }

  const xlsx = path.join(__dirname, 'Brassbell Onboarding OTAs - Full (iCal, Photos, Price).xlsx');
  const attachments = fs.existsSync(xlsx)
    ? [{ filename: path.basename(xlsx), path: xlsx }]
    : [];
  if (!attachments.length) console.log('send-alert: sheet not found — sending text-only.');

  const ok = await notifyEmail(msg.emailSubject, msg.emailBody, attachments);
  if (!ok) process.exitCode = 1;
})().catch((e) => { console.error(String(e)); process.exit(1); });
