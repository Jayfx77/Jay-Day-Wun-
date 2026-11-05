// Phone number verification by SMS code. New accounts (and anyone who changes their number)
// must confirm their phone before messaging, booking viewings or listing property.
const crypto = require('crypto');
const config = require('./config');

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;

function createPhoneVerification(db, sms) {
  const hash = (codeId, code) => crypto.createHash('sha256').update(`${codeId}:${code}`).digest('hex');
  const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

  const latest = db.prepare(`SELECT * FROM phone_codes WHERE user_id = ? AND phone = ? AND used_at IS NULL
    ORDER BY id DESC LIMIT 1`);

  // Returns { ok: true } or { ok: false, error, wait } (wait = seconds until a resend is allowed).
  function sendCode(user) {
    const last = db.prepare('SELECT created_at FROM phone_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id);
    if (last) {
      const since = (Date.now() - new Date(last.created_at).getTime()) / 1000;
      if (since < RESEND_SECONDS) {
        const wait = Math.ceil(RESEND_SECONDS - since);
        return { ok: false, wait, error: `Please wait ${wait} seconds before requesting another code.` };
      }
    }
    const hourCount = db.prepare('SELECT COUNT(*) n FROM phone_codes WHERE user_id = ? AND created_at > ?').get(user.id, iso(-3600e3)).n;
    if (hourCount >= MAX_PER_HOUR) {
      return { ok: false, error: 'Too many codes requested. Please try again in an hour, or contact support.' };
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    db.transaction(() => {
      db.prepare('UPDATE phone_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(iso(), user.id);
      const id = db.prepare(`INSERT INTO phone_codes (user_id, phone, code_hash, expires_at) VALUES (?, ?, '', ?)`)
        .run(user.id, user.phone, iso(CODE_MINUTES * 60e3)).lastInsertRowid;
      db.prepare('UPDATE phone_codes SET code_hash = ? WHERE id = ?').run(hash(id, code), id);
    })();
    sms.send({
      userId: user.id, phone: user.phone, kind: 'verify',
      body: `${code} is your ${config.siteName} verification code. It expires in ${CODE_MINUTES} minutes. Never share this code with anyone.`,
    });
    return { ok: true };
  }

  // Returns { ok: true } or { ok: false, error }.
  function checkCode(user, input) {
    const code = String(input || '').replace(/\D/g, '');
    const row = latest.get(user.id, user.phone);
    if (!row || row.expires_at < iso()) return { ok: false, error: 'That code has expired. Tap “Send a new code”.' };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many wrong attempts. Tap “Send a new code”.' };
    const expected = Buffer.from(row.code_hash);
    const actual = Buffer.from(hash(row.id, code));
    if (code.length !== 6 || !crypto.timingSafeEqual(expected, actual)) {
      db.prepare('UPDATE phone_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      const left = MAX_ATTEMPTS - row.attempts - 1;
      return { ok: false, error: left > 0 ? `That code is wrong. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Tap “Send a new code”.' };
    }
    // One verified account per phone number (helps stop fake/duplicate landlord accounts).
    const taken = db.prepare('SELECT 1 FROM users WHERE phone = ? AND phone_verified = 1 AND id != ?').get(user.phone, user.id);
    if (taken) {
      return { ok: false, error: `This number is already verified on another ${config.siteName} account. Log in to that account, or contact ${config.supportEmail}.` };
    }
    db.transaction(() => {
      db.prepare('UPDATE phone_codes SET used_at = ? WHERE id = ?').run(iso(), row.id);
      db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id);
    })();
    return { ok: true };
  }

  return { sendCode, checkCode };
}

// Route guard: logged-in users with an unverified phone are sent to verify it first.
function requirePhoneVerified(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.user.phone_verified || req.user.role === 'admin') return next();
  // For form posts, come back to the page the form was on.
  let back = req.originalUrl;
  if (req.method !== 'GET') {
    try {
      const ref = new URL(req.get('referer') || '', 'http://x');
      back = ref.host === req.get('host') || ref.host === 'x' ? ref.pathname : '/dashboard';
    } catch { back = '/dashboard'; }
  }
  res.redirect(`/verify-phone?next=${encodeURIComponent(back)}`);
}

module.exports = { createPhoneVerification, requirePhoneVerified, CODE_MINUTES };
