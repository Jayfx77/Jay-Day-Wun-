const express = require('express');
const { verifyCsrf, requireUser } = require('../auth');
const { createSavedSearches, normalise, describe, toQueryString } = require('../savedSearches');

const FREQUENCIES = ['instant', 'daily', 'off'];

module.exports = (db, { mailer }) => {
  const r = express.Router();
  const saved = createSavedSearches(db);
  const own = (req) => db.prepare('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  r.post('/saved-searches', requireUser, verifyCsrf, (req, res) => {
    const frequency = FREQUENCIES.includes(req.body.frequency) ? req.body.frequency : 'instant';
    const result = saved.save(req.user.id, req.body, frequency);
    const back = `/listings?${toQueryString(normalise(req.body))}`;
    const sep = back.endsWith('?') ? '' : '&';
    let msg = result.error;
    if (result.ok) {
      msg = mailer.enabled && frequency !== 'off'
        ? `Search saved. We'll email you ${frequency === 'daily' ? 'a daily summary of' : 'as soon as we list'} new homes that match.`
        : 'Search saved. Find it on your dashboard.';
    }
    res.redirect(`${back}${sep}ok=${encodeURIComponent(msg)}`);
  });

  r.post('/saved-searches/:id/frequency', requireUser, verifyCsrf, (req, res) => {
    const s = own(req);
    if (s && FREQUENCIES.includes(req.body.frequency)) {
      // Turning alerts back on shouldn't email about everything listed while they were off.
      const reset = s.frequency === 'off' && req.body.frequency !== 'off';
      db.prepare(`UPDATE saved_searches SET frequency = ?, checked_until = CASE WHEN ? THEN datetime('now') ELSE checked_until END
        WHERE id = ?`).run(req.body.frequency, reset ? 1 : 0, s.id);
    }
    res.redirect(`/dashboard?ok=${encodeURIComponent('Saved search updated.')}#saved-searches`);
  });

  r.post('/saved-searches/:id/delete', requireUser, verifyCsrf, (req, res) => {
    const s = own(req);
    if (s) db.prepare('DELETE FROM saved_searches WHERE id = ?').run(s.id);
    res.redirect(`/dashboard?ok=${encodeURIComponent('Saved search deleted.')}#saved-searches`);
  });

  // "Stop alerts for this search" link in emails: the token authorises it, so no login or CSRF token.
  // GET only shows a button, so email link scanners can't switch alerts off.
  const byToken = (t) => (typeof t === 'string' && /^[\w-]{20,64}$/.test(t)
    ? db.prepare('SELECT * FROM saved_searches WHERE token = ?').get(t) : null);

  r.get('/saved-searches/stop', (req, res) => {
    const s = byToken(req.query.token);
    if (!s) return res.status(404).render('error', { title: 'Link not valid', message: 'This link is not valid. You can manage saved searches on your dashboard.' });
    res.render('saved-search-stop', { title: 'Search alerts', token: req.query.token, description: describe(JSON.parse(s.query)), done: s.frequency === 'off' });
  });

  r.post('/saved-searches/stop', (req, res) => {
    const token = req.query.token || req.body.token;
    const s = byToken(token);
    if (!s) return res.status(404).render('error', { title: 'Link not valid', message: 'This link is not valid.' });
    db.prepare("UPDATE saved_searches SET frequency = 'off' WHERE id = ?").run(s.id);
    res.render('saved-search-stop', { title: 'Search alerts', token, description: describe(JSON.parse(s.query)), done: true });
  });

  return r;
};
