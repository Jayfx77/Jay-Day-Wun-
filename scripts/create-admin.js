// Usage: node scripts/create-admin.js "Full Name" admin@example.com 0241234567 'StrongPassword'
// Or set ADMIN_EMAIL / ADMIN_PASSWORD (and optionally ADMIN_NAME, ADMIN_PHONE) and start the server.
// When run directly, read .env first (before any settings are loaded).
if (require.main === module) require('../src/loadEnv');
const { hashPassword } = require('../src/auth');
const { normalisePhone } = require('../src/helpers');

function upsertAdmin(db, { name, email, phone, password }) {
  if (!email || !password || password.length < 10) {
    throw new Error('Admin needs an email and a password of at least 10 characters.');
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ?, suspended = 0 WHERE id = ?")
      .run(hashPassword(password), existing.id);
    return existing.id;
  }
  return db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES (?, ?, ?, ?, 'admin', 'verified', 1)`)
    .run(name || 'Administrator', email, normalisePhone(phone) || '233200000000', hashPassword(password))
    .lastInsertRowid;
}

function ensureAdminFromEnv(db) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const exists = db.prepare("SELECT 1 FROM users WHERE email = ? AND role = 'admin'").get(ADMIN_EMAIL);
  if (!exists) {
    upsertAdmin(db, { name: ADMIN_NAME, email: ADMIN_EMAIL, phone: ADMIN_PHONE, password: ADMIN_PASSWORD });
    console.log(`Admin account ready: ${ADMIN_EMAIL}`);
  }
}

if (require.main === module) {
  const [name, email, phone, password] = process.argv.slice(2);
  const db = require('../src/db').open();
  try {
    upsertAdmin(db, { name, email, phone, password });
    console.log(`Admin account ready: ${email}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  db.close();
}

module.exports = { upsertAdmin, ensureAdminFromEnv };
