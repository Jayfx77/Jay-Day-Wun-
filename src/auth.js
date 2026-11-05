const crypto = require('crypto');
const config = require('./config');

const COOKIE = 'ofie_sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: 16384, r: 8, p: 1,
  });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires,
    path: '/',
  });
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

// Loads req.user and a CSRF token. Anonymous visitors get a cookie-bound CSRF token too.
function sessionMiddleware(db) {
  const findSession = db.prepare(`
    SELECT s.csrf, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`);
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.cookies = cookies;
    req.user = null;
    const token = cookies[COOKIE];
    if (token) {
      const row = findSession.get(sha256(token));
      if (row && new Date(row.expires_at) > new Date() && !row.suspended) {
        const { csrf, expires_at, password_hash, ...user } = row;
        req.user = user;
        req.csrfToken = csrf;
      } else {
        res.clearCookie(COOKIE, { path: '/' });
      }
    }
    if (!req.csrfToken) {
      let anon = cookies.ofie_csrf;
      if (!anon || !/^[\w-]{32}$/.test(anon)) {
        anon = crypto.randomBytes(24).toString('base64url');
        res.cookie('ofie_csrf', anon, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
      }
      req.csrfToken = anon;
    }
    res.locals.user = req.user;
    res.locals.csrfToken = req.csrfToken;
    next();
  };
}

// Must run after body parsing (including multer for multipart forms).
function verifyCsrf(req, res, next) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(req.csrfToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', {
      title: 'Session expired',
      message: 'Your form expired or was submitted from another site. Go back, refresh the page and try again.',
    });
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', { title: 'Not allowed', message: 'Your account type cannot access this page.' });
    }
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  sessionMiddleware, verifyCsrf, requireUser, requireRole,
};
