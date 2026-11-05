const express = require('express');
const rateLimit = require('express-rate-limit');
const { hashPassword, verifyPassword, createSession, destroySession, verifyCsrf } = require('../auth');
const { normalisePhone } = require('../helpers');

const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/dashboard');

module.exports = (db) => {
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
    const dest = v.role === 'landlord' ? '/account?welcome=1' : safeNext(req.body.next);
    res.redirect(dest);
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

  r.post('/logout', verifyCsrf, (req, res) => {
    destroySession(db, req, res);
    res.redirect('/');
  });

  return r;
};
