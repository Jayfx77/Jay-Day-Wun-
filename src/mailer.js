// Email via SMTP (password-reset links and message alerts). Disabled unless SMTP_HOST is set.
// Every email is recorded in email_log; failures are logged, never thrown.
const nodemailer = require('nodemailer');
const config = require('./config');

function createMailer(db, transport) {
  if (!transport && !config.smtp.host) return { enabled: false, send: async () => false, flush: async () => {} };
  const t = transport || nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  const insert = db && db.prepare(`INSERT INTO email_log (user_id, email, kind, ref, subject, status) VALUES (?, ?, ?, ?, ?, 'queued')`);
  const finish = db && db.prepare('UPDATE email_log SET status = ?, error = ? WHERE id = ?');
  const pending = new Set();

  function send({ to, subject, text, html, headers, userId = null, kind = 'other', ref = null }) {
    const id = insert ? insert.run(userId, to, kind, ref == null ? null : String(ref), subject).lastInsertRowid : null;
    const p = t.sendMail({ from: `${config.siteName} <${config.smtp.from}>`, to, subject, text, html, headers })
      .then(() => { if (id) finish.run('sent', null, id); return true; })
      .catch((err) => {
        console.error(`Email ${id || ''} failed:`, err.message);
        if (id) finish.run('failed', String(err.message).slice(0, 500), id);
        return false;
      })
      .finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }

  return { enabled: true, send, flush: () => Promise.all([...pending]) };
}

module.exports = { createMailer };
