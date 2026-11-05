const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

function open(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL,
    whatsapp INTEGER NOT NULL DEFAULT 1,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('tenant','landlord','admin')),
    verification_status TEXT NOT NULL DEFAULT 'unverified'
      CHECK (verification_status IN ('unverified','pending','verified','rejected')),
    ghana_card_number TEXT,
    ghana_card_file TEXT,
    verification_note TEXT,
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE listings (
    id INTEGER PRIMARY KEY,
    landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    property_type TEXT NOT NULL,
    neighbourhood TEXT NOT NULL,
    address TEXT NOT NULL,
    gps_address TEXT,
    bedrooms INTEGER NOT NULL DEFAULT 1,
    bathrooms INTEGER NOT NULL DEFAULT 1,
    rent_ghs INTEGER NOT NULL,
    advance_months INTEGER NOT NULL,
    furnishing TEXT NOT NULL,
    amenities TEXT NOT NULL DEFAULT '',
    available_from TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','rented','rejected','archived')),
    moderation_note TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_listings_search ON listings(status, neighbourhood, rent_ghs);
  CREATE INDEX idx_listings_landlord ON listings(landlord_id);

  CREATE TABLE listing_photos (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_photos_listing ON listing_photos(listing_id, position);

  CREATE TABLE favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, listing_id)
  );

  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (listing_id, tenant_id)
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

  CREATE TABLE viewings (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','confirmed','declined','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  ALTER TABLE users ADD COLUMN sms_alerts INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_resets_user ON password_resets(user_id, id);

  CREATE TABLE sms_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    phone TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sms_user ON sms_log(user_id, kind, ref, created_at);
  `,
  `
  ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET phone_verified = 1 WHERE role = 'admin';

  CREATE TABLE phone_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_phone_codes_user ON phone_codes(user_id, id);
  `,
  `
  ALTER TABLE users ADD COLUMN email_alerts INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;
  CREATE UNIQUE INDEX idx_users_unsub ON users(unsubscribe_token);

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_email_user ON email_log(user_id, kind, ref, created_at);
  `,
  `
  -- When a listing last became publicly visible (new, approved, or relisted). Maintained by triggers.
  ALTER TABLE listings ADD COLUMN published_at TEXT;
  UPDATE listings SET published_at = created_at WHERE status = 'active';
  CREATE INDEX idx_listings_published ON listings(status, published_at);
  CREATE TRIGGER listings_published_insert AFTER INSERT ON listings WHEN NEW.status = 'active'
  BEGIN UPDATE listings SET published_at = datetime('now') WHERE id = NEW.id; END;
  CREATE TRIGGER listings_published_update AFTER UPDATE OF status ON listings
    WHEN NEW.status = 'active' AND OLD.status != 'active'
  BEGIN UPDATE listings SET published_at = datetime('now') WHERE id = NEW.id; END;

  CREATE TABLE saved_searches (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,              -- normalised JSON of the search filters
    frequency TEXT NOT NULL DEFAULT 'instant' CHECK (frequency IN ('instant','daily','off')),
    token TEXT NOT NULL UNIQUE,       -- for the "stop these alerts" link in emails
    checked_until TEXT NOT NULL DEFAULT (datetime('now')),  -- listings published after this are new
    last_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, query)
  );

  -- Listings already sent for a saved search, so a relisted home isn't sent twice.
  CREATE TABLE saved_search_hits (
    saved_search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (saved_search_id, listing_id)
  );
  `,
];

function migrate(db) {
  const version = db.pragma('user_version', { simple: true });
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

module.exports = { open };
