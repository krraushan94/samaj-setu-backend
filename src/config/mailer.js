const nodemailer = require('nodemailer');

// Gmail SMTP using an App Password (Google Account → Security → App Passwords).
// SMTP_USER / SMTP_APP_PASSWORD must be set in Render's environment variables —
// never commit real credentials to this file or to .env in git.
const transporter = (process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
    })
  : null;

// Sends an email if SMTP is configured; otherwise logs to console (dev fallback,
// same pattern already used for OTP in auth.controller.js).
async function sendMail({ to, subject, text }) {
  if (!transporter) {
    console.log(`[DEV] Email to ${to} — ${subject}\n${text}`);
    return { delivered: false };
  }
  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
  return { delivered: true };
}

module.exports = { sendMail };
