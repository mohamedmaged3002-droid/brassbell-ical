// Push notifications for Brassbell price changes: WhatsApp (CallMeBot) + email (Gmail SMTP).
// Both are gated on their env vars — if a channel isn't configured, it's skipped (not an error),
// so the price refresh still succeeds even before the secrets are added.
let nodemailer;
try { nodemailer = require('nodemailer'); } catch { nodemailer = null; }

async function notifyWhatsApp(text) {
  const phone = process.env.CALLMEBOT_PHONE;
  const key = process.env.CALLMEBOT_APIKEY;
  if (!phone || !key) { console.log('WhatsApp: skipped (CALLMEBOT_PHONE/CALLMEBOT_APIKEY not set)'); return false; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}`
    + `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    const ok = res.ok && !/error|invalid|not found|apikey/i.test(body);
    console.log(`WhatsApp: HTTP ${res.status} ${ok ? 'sent' : 'FAILED'} — ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    return ok;
  } catch (e) { console.log('WhatsApp: error', String(e).slice(0, 140)); return false; }
}

async function notifyEmail(subject, text) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.NOTIFY_EMAIL || user;
  if (!user || !pass) { console.log('Email: skipped (SMTP_USER/SMTP_PASS not set)'); return false; }
  if (!nodemailer) { console.log('Email: skipped (nodemailer not installed)'); return false; }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: `BlueKeys Pricing <${user}>`, to, subject, text });
    console.log(`Email: sent to ${to}`);
    return true;
  } catch (e) { console.log('Email: error', String(e).slice(0, 200)); return false; }
}

async function notifyAll(msg) {
  if (!msg) return { whatsapp: false, email: false };
  const [whatsapp, email] = await Promise.all([
    notifyWhatsApp(msg.whatsapp),
    notifyEmail(msg.emailSubject, msg.emailBody),
  ]);
  console.log(`Notifications: whatsapp=${whatsapp} email=${email}`);
  return { whatsapp, email };
}

module.exports = { notifyWhatsApp, notifyEmail, notifyAll };
