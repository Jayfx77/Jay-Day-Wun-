// One-click unsubscribe from notification emails (messages and viewings). The secret token in the link is the authorisation,
// so these routes need no login (and no CSRF token, which mail clients can't send).
const express = require('express');

module.exports = (db) => {
  const r = express.Router();
  const find = (token) => (typeof token === 'string' && /^[\w-]{20,64}$/.test(token)
    ? db.prepare('SELECT id, email, email_alerts FROM users WHERE unsubscribe_token = ?').get(token) : null);
  const mask = (e) => e.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 6))}${c}`);

  // GET only shows a confirmation button, so link scanners in email systems can't unsubscribe people.
  r.get('/unsubscribe', (req, res) => {
    const u = find(req.query.token);
    if (!u) return res.status(404).render('error', { title: 'Link not valid', message: 'This unsubscribe link is not valid. You can change notification settings on your account page.' });
    res.render('unsubscribe', { title: 'Email notifications', token: req.query.token, email: mask(u.email), done: !u.email_alerts });
  });

  r.post('/unsubscribe', (req, res) => {
    const token = req.query.token || req.body.token;
    const u = find(token);
    if (!u) return res.status(404).render('error', { title: 'Link not valid', message: 'This unsubscribe link is not valid.' });
    const resubscribe = req.body.action === 'resubscribe';
    db.prepare('UPDATE users SET email_alerts = ? WHERE id = ?').run(resubscribe ? 1 : 0, u.id);
    res.render('unsubscribe', { title: 'Email notifications', token, email: mask(u.email), done: !resubscribe, resubscribed: resubscribe });
  });

  return r;
};
