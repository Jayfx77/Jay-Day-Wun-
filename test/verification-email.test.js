// Email notifications for Ghana Card verification results.
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');
const { hashPassword } = require('../src/auth');
const { upsertAdmin } = require('../scripts/create-admin');

let server, base, db, mailer, port;
const outbox = [];
let failNext = false;
const transport = {
  sendMail: async (m) => {
    if (failNext) { failNext = false; throw new Error('SMTP 421 try later'); }
    outbox.push(m);
  },
};

before(async () => {
  db = open(':memory:');
  mailer = createMailer(db, transport);
  server = createApp(db, { mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  const add = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES (?, ?, ?, ?, ?, 'verified', 1)`);
  const pw = hashPassword('password123');
  upsertAdmin(db, { name: 'Admin', email: 'admin@test.gh', phone: '0200000000', password: 'admin-password-123' });
  const landlord = add.run('Ama Owusu', 'ama@test.gh', '233241000001', pw, 'landlord').lastInsertRowid;
  add.run('Kojo <b>Tenant</b>', 'kojo@test.gh', '233271000004', pw, 'tenant');
  // Ama: pending verification, no listings. Yaw: pending verification, one pending listing.
  db.prepare("UPDATE users SET verification_status = 'pending', ghana_card_number = 'GHA-555666777-1' WHERE id = ?").run(landlord);
  const yaw = add.run('Yaw Boateng', 'yaw@test.gh', '233551000003', pw, 'landlord').lastInsertRowid;
  db.prepare("UPDATE users SET verification_status = 'pending', ghana_card_number = 'GHA-987654321-0' WHERE id = ?").run(yaw);
  db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms,
    bathrooms, rent_ghs, advance_months, furnishing, status) VALUES (?, 'Studio in Dansoman', 'A quiet studio close to the main road and shops.',
    'studio', 'Dansoman', 'Last Stop', 1, 1, 900, 6, 'semi', 'pending')`).run(yaw);
});
after(() => server.close());

function client() {
  const jar = {};
  async function req(method, url, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    res.text = await res.text();
    return res;
  }
  return {
    cookie: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    async csrf(u = '/') { return (await req('GET', u)).text.match(/name="_csrf" value="([^"]+)"/)[1]; },
    async login(email) {
      const _csrf = await this.csrf('/login');
      await req('POST', '/login', { _csrf, email, password: 'password123' });
    },
  };
}

const emailsTo = (to) => outbox.filter((m) => m.to === to);
const idOf = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
let admin, acsrf;

async function decide(email, action, note = '') {
  await admin.post(`/admin/users/${idOf(email)}/verification`, { _csrf: acsrf, action, note });
  await mailer.flush();
}

test('rejection emails the reason and a link to try again, without the card number', async () => {
  admin = client();
  const _csrf = await admin.csrf('/login');
  await admin.post('/login', { _csrf, email: 'admin@test.gh', password: 'admin-password-123' });
  acsrf = await admin.csrf('/admin');

  await decide('ama@test.gh', 'reject', 'Photo is blurry & <unreadable>');
  const [m] = emailsTo('ama@test.gh');
  assert.equal(m.subject, "We couldn't verify your Ghana Card");
  assert.match(m.text, /Reason: Photo is blurry & <unreadable>/);
  assert.match(m.text, /Upload your Ghana Card again: https?:\/\/\S+\/account\n/);
  assert.match(m.html, /Photo is blurry &amp; &lt;unreadable&gt;/);
  assert.doesNotMatch(m.text + m.html, /555666777/, 'card number is never emailed');
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(db.prepare("SELECT ref FROM email_log WHERE kind = 'verification'").get().ref, 'rejected');
});

test('verification with no waiting listings invites the landlord to post one', async () => {
  db.prepare("UPDATE users SET verification_status = 'pending' WHERE email = 'ama@test.gh'").run(); // resubmitted
  await decide('ama@test.gh', 'verify');
  const m = emailsTo('ama@test.gh').at(-1);
  assert.equal(m.subject, 'Your Ghana Card is verified');
  assert.match(m.text, /verified-landlord badge/);
  assert.match(m.text, /Post a property: https?:\/\/\S+\/listings\/new/);
  assert.doesNotMatch(m.text + m.html, /555666777/);
});

test('a repeated verify click does not email or text again', async () => {
  const emails = emailsTo('ama@test.gh').length;
  const texts = db.prepare("SELECT COUNT(*) n FROM sms_log WHERE kind = 'verification'").get().n;
  await decide('ama@test.gh', 'verify');
  assert.equal(emailsTo('ama@test.gh').length, emails);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sms_log WHERE kind = 'verification'").get().n, texts);
});

test('verification that publishes one waiting listing links straight to it', async () => {
  await decide('yaw@test.gh', 'verify');
  const mails = emailsTo('yaw@test.gh');
  assert.equal(mails.length, 1, 'one combined email');
  assert.equal(mails[0].subject, "You're verified, and your listing is live");
  assert.match(mails[0].text, /Your listing that was waiting for review is now live/);
  assert.match(mails[0].text, /Dansoman: Studio in Dansoman \(GH₵ 900 \/ month\)/);
  assert.match(mails[0].text, /View your listing: https?:\/\/\S+\/listings\/1\n/);
  assert.equal(db.prepare('SELECT status FROM listings WHERE id = 1').get().status, 'active');
});

test('landlords who switched emails off get no verification email, but still get the SMS', async () => {
  db.prepare("UPDATE users SET email_alerts = 0, verification_status = 'pending' WHERE email = 'ama@test.gh'").run();
  const before = emailsTo('ama@test.gh').length;
  await decide('ama@test.gh', 'reject', 'Expired card');
  assert.equal(emailsTo('ama@test.gh').length, before);
  assert.match(db.prepare("SELECT body FROM sms_log WHERE kind = 'verification' ORDER BY id DESC").get().body, /Expired card/);
});
