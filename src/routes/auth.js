const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const rateLimit = require('express-rate-limit');
const { hashPassword, verifyPassword, createSession, destroySession, verifyCsrf, requireUser } = require('../auth');
const { CODE_MINUTES } = require('../phoneVerification');
const { normalisePhone } = require('../helpers');

const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/dashboard');

module.exports = (db, { sms, mailer, phone: phoneCheck }) => {
  const r = express.Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (req, res) => res.status(429).render('error', {
      title: 'Too many attempts', message: 'Please wait 15 minutes and try again.',
    }),
  });

  r.get('/register', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('register', { title: 'Create account', values: { role: req.query.role === 'landlord' ? 'landlord' : 'tenant' }, errors: [], next: req.query.next });
  });

  r.post('/register', limiter, verifyCsrf, (req, res) => {
    const v = {
      name: String(req.body.name || '').trim().slice(0, 80),
      email: String(req.body.email || '').trim().toLowerCase().slice(0, 120),
      phone: String(req.body.phone || '').trim(),
      role: req.body.role === 'landlord' ? 'landlord' : 'tenant',
      whatsapp: req.body.whatsapp === '1' ? 1 : 0,
    };
    const password = String(req.body.password || '');
    const errors = [];
    if (v.name.length < 2) errors.push('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push('Enter a valid email address.');
    const phone = normalisePhone(v.phone);
    if (!phone) errors.push('Enter a valid Ghanaian mobile number, e.g. 024 123 4567.');
    if (password.length < 8) errors.push('Password must be at least 8 characters.');
    if (password !== req.body.password2) errors.push('Passwords do not match.');
    if (req.body.agree !== '1') errors.push('You must accept the terms to continue.');
    if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) {
      errors.push('An account with that email already exists. Try logging in.');
    }
    if (errors.length) {
      return res.status(400).render('register', { title: 'Create account', values: v, errors, next: req.body.next });
    }
    const id = db.prepare(`INSERT INTO users (name, email, phone, whatsapp, password_hash, role)
      VALUES (?, ?, ?, ?, ?, ?)`).run(v.name, v.email, phone, v.whatsapp, hashPassword(password), v.role).lastInsertRowid;
    createSession(db, res, id);
    phoneCheck.sendCode(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    const dest = v.role === 'landlord' ? '/account?welcome=1' : safeNext(req.body.next);
    res.redirect(`/verify-phone?next=${encodeURIComponent(dest)}`);
  });

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('login', { title: 'Log in', email: '', error: null, next: req.query.next });
  });

  r.post('/login', limiter, verifyCsrf, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user && verifyPassword(String(req.body.password || ''), user.password_hash);
    if (!ok || user.suspended) {
      return res.status(401).render('login', {
        title: 'Log in', email, next: req.body.next,
        error: user && user.suspended && ok ? 'This account has been suspended. Contact support.' : 'Wrong email or password.',
      });
    }
    createSession(db, res, user.id);
    res.redirect(user.role === 'admin' && !req.body.next ? '/admin' : safeNext(req.body.next));
  });

  // ---------- Password reset ----------
  // A 6-digit code is texted to the account's phone; if email is configured, a one-click link is emailed too.
  // Responses never reveal whether an account exists.
  const RESET_MINUTES = 15;
  const MAX_ATTEMPTS = 5;
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const codeHash = (tokenHash, code) => sha(`${tokenHash}:${code}`);
  const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const now = () => new Date().toISOString();

  function findAccount(identifier) {
    const id = String(identifier || '').trim().toLowerCase();
    if (id.includes('@')) return db.prepare('SELECT * FROM users WHERE email = ?').get(id);
    const phone = normalisePhone(id);
    return phone ? db.prepare('SELECT * FROM users WHERE phone = ? ORDER BY phone_verified DESC, id DESC LIMIT 1').get(phone) : null;
  }

  const activeReset = db.prepare(`SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
    ORDER BY id DESC LIMIT 1`);

  function finishReset(req, res, reset, password, password2, renderError) {
    if (password.length < 8) return renderError('New password must be at least 8 characters.');
    if (password !== password2) return renderError('Passwords do not match.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(reset.user_id);
    if (!user || user.suspended) return renderError('This account cannot be reset. Contact support.');
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now(), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();
    // Security notice, sent even if the user turned off alerts.
    sms.send({
      userId: user.id, phone: user.phone, kind: 'security',
      body: `${config.siteName}: Your password was just changed. If this wasn't you, contact ${config.supportEmail} immediately.`,
    });
    createSession(db, res, user.id);
    res.redirect(`/dashboard?ok=${encodeURIComponent('Password updated. You are now logged in.')}`);
  }

  r.get('/forgot', (req, res) => res.render('forgot', { title: 'Reset password', error: null, identifier: '' }));

  r.post('/forgot', limiter, verifyCsrf, (req, res) => {
    const identifier = String(req.body.identifier || '').trim().slice(0, 120);
    if (!identifier) return res.status(400).render('forgot', { title: 'Reset password', error: 'Enter your email or phone number.', identifier });
    const user = findAccount(identifier);
    if (user && !user.suspended) {
      const recent = db.prepare(`SELECT COUNT(*) n FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`)
        .get(user.id).n;
      if (recent < 3) {
        const token = crypto.randomBytes(32).toString('base64url');
        const tokenHash = sha(token);
        const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
        const expires = new Date(Date.now() + RESET_MINUTES * 60e3).toISOString();
        db.transaction(() => {
          db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now(), user.id);
          db.prepare('INSERT INTO password_resets (user_id, code_hash, token_hash, expires_at) VALUES (?, ?, ?, ?)')
            .run(user.id, codeHash(tokenHash, code), tokenHash, expires);
        })();
        sms.send({
          userId: user.id, phone: user.phone, kind: 'reset',
          body: `${code} is your ${config.siteName} password reset code. It expires in ${RESET_MINUTES} minutes. Never share this code with anyone.`,
        });
        if (mailer.enabled) {
          mailer.send({
            to: user.email,
            subject: `Reset your ${config.siteName} password`,
            text: `Hello ${user.name},\n\nSomeone (hopefully you) asked to reset your ${config.siteName} password.\n\n`
              + `Reset it here: ${config.baseUrl}/reset?token=${token}\n\nOr enter this code: ${code}\n\n`
              + `This link and code expire in ${RESET_MINUTES} minutes. If you didn't ask for this, ignore this email.`,
          });
        }
      }
    }
    res.render('reset', { title: 'Enter your code', identifier, token: null, error: null, sent: true });
  });

  r.get('/reset', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (token) {
      const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha(token), now());
      if (!reset) {
        return res.render('forgot', { title: 'Reset password', identifier: '', error: 'That reset link has expired or was already used. Request a new one.' });
      }
    }
    res.render('reset', { title: 'Choose a new password', identifier: String(req.query.identifier || ''), token, error: null, sent: false });
  });

  r.post('/reset', limiter, verifyCsrf, (req, res) => {
    const identifier = String(req.body.identifier || '').trim().slice(0, 120);
    const token = typeof req.body.token === 'string' && req.body.token ? req.body.token : null;
    const password = String(req.body.password || '');
    const fail = (error) => res.status(400).render('reset', { title: 'Choose a new password', identifier, token, error, sent: false });

    if (token) {
      const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha(token), now());
      if (!reset) return fail('That reset link has expired or was already used. Request a new one.');
      return finishReset(req, res, reset, password, String(req.body.password2 || ''), fail);
    }

    const code = String(req.body.code || '').replace(/\D/g, '');
    const user = findAccount(identifier);
    const reset = user && activeReset.get(user.id, now());
    if (!reset) return fail('That code is wrong or has expired. Request a new one.');
    if (reset.attempts >= MAX_ATTEMPTS) return fail('Too many wrong attempts. Request a new code.');
    if (!sameHash(codeHash(reset.token_hash, code), reset.code_hash)) {
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
      return fail('That code is wrong or has expired. Request a new one.');
    }
    finishReset(req, res, reset, password, String(req.body.password2 || ''), fail);
  });

  // ---------- Phone verification ----------
  const verifyView = (req, res, extra = {}) => res.status(extra.error ? 400 : 200).render('verify-phone', {
    title: 'Verify your phone', next: safeNext(req.query.next || req.body?.next), error: null, info: null, minutes: CODE_MINUTES, ...extra,
  });

  r.get('/verify-phone', requireUser, (req, res) => {
    if (req.user.phone_verified) return res.redirect(safeNext(req.query.next));
    verifyView(req, res);
  });

  r.post('/verify-phone', requireUser, limiter, verifyCsrf, (req, res) => {
    if (req.user.phone_verified) return res.redirect(safeNext(req.body.next));
    const result = phoneCheck.checkCode(req.user, req.body.code);
    if (!result.ok) return verifyView(req, res, { error: result.error });
    res.redirect(`${safeNext(req.body.next)}${safeNext(req.body.next).includes('?') ? '&' : '?'}ok=${encodeURIComponent('Phone number verified. Thank you!')}`);
  });

  r.post('/verify-phone/resend', requireUser, limiter, verifyCsrf, (req, res) => {
    if (req.user.phone_verified) return res.redirect(safeNext(req.body.next));
    const result = phoneCheck.sendCode(req.user);
    verifyView(req, res, result.ok ? { info: 'A new code is on its way.' } : { error: result.error });
  });

  r.post('/logout', verifyCsrf, (req, res) => {
    destroySession(db, req, res);
    res.redirect('/');
  });

  return r;
};
