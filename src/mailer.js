// Optional email (used for password-reset links). Disabled unless SMTP_HOST is set.
const nodemailer = require('nodemailer');
const config = require('./config');

function createMailer() {
  if (!config.smtp.host) return { enabled: false, send: async () => false };
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return {
    enabled: true,
    async send({ to, subject, text }) {
      try {
        await transport.sendMail({ from: config.smtp.from, to, subject, text });
        return true;
      } catch (err) {
        console.error('Email failed:', err.message);
        return false;
      }
    },
  };
}

module.exports = { createMailer };
