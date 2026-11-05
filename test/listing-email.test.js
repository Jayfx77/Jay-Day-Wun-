// Email notifications for listing approvals, rejections and takedowns.
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
  const insert = db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms,
    bathrooms, rent_ghs, advance_months, furnishing, status) VALUES (?, ?, 'A bright flat with reliable water, close to shops and transport.',
    'apartment', ?, 'Main road', 2, 1, ?, 6, 'semi', 'pending')`);
  insert.run(landlord, '2-bed flat in Osu', 'Osu', 3000);
  insert.run(landlord, 'Chamber & hall in <Madina>', 'Madina', 1200);
  // A second, unverified landlord whose pending listings go live when verified.
  const yaw = add.run('Yaw Boateng', 'yaw@test.gh', '233551000003', pw, 'landlord').lastInsertRowid;
  db.prepare("UPDATE users SET verification_status = 'pending' WHERE id = ?").run(yaw);
  insert.run(yaw, 'Single room in Kasoa', 'Kasoa', 450);
  insert.run(yaw, 'Studio in Dansoman', 'Dansoman', 900);
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
const lastTo = (to) => emailsTo(to).at(-1);
let admin, acsrf;

async function moderate(id, action, note = '') {
  await admin.post(`/admin/listings/${id}/moderate`, { _csrf: acsrf, action, note });
  await mailer.flush();
}

test('approving a listing emails the landlord that it is live', async () => {
  admin = client();
  const _csrf = await admin.csrf('/login');
  await admin.post('/login', { _csrf, email: 'admin@test.gh', password: 'admin-password-123' });
  acsrf = await admin.csrf('/admin');

  await moderate(1, 'approve');
  const m = lastTo('ama@test.gh');
  assert.equal(m.subject, 'Your listing is live: "2-bed flat in Osu"');
  assert.match(m.text, /Listing: 2-bed flat in Osu\nArea: Osu\nRent: GH₵ 3,000 \/ month, 6 months advance/);
  assert.match(m.text, /View your listing: https?:\/\/\S+\/listings\/1\n/);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind = 'listing'").get().status, 'sent');
});

test('re-approving an already live listing sends nothing', async () => {
  const before = emailsTo('ama@test.gh').length;
  await moderate(1, 'approve');
  assert.equal(emailsTo('ama@test.gh').length, before);
});

test('rejecting emails the reason and an edit link, escaped', async () => {
  await moderate(2, 'reject', 'Photos look like <stock> images');
  const m = lastTo('ama@test.gh');
  assert.equal(m.subject, 'Your listing needs changes: "Chamber & hall in <Madina>"');
  assert.match(m.text, /Reason: Photos look like <stock> images/);
  assert.match(m.text, /Edit and resubmit: https?:\/\/\S+\/listings\/2\/edit/);
  assert.match(m.html, /Photos look like &lt;stock&gt; images/);
  assert.match(m.html, /Chamber &amp; hall in &lt;Madina&gt;/);
  assert.doesNotMatch(m.html, /<stock>|<Madina>/);
});

test('a verified landlord editing a rejected listing sends it back for review', async () => {
  db.prepare("UPDATE users SET verification_status = 'verified' WHERE email = 'ama@test.gh'").run();
  const ama = client();
  await ama.login('ama@test.gh');
  const _csrf = await ama.csrf('/listings/2/edit');
  const fd = new FormData();
  const fields = {
    _csrf, title: 'Chamber & hall in Madina', description: 'A bright flat with reliable water, close to shops and transport.',
    property_type: 'chamber_hall', neighbourhood: 'Madina', address: 'Main road', bedrooms: '1', bathrooms: '1',
    rent_ghs: '1200', advance_months: '6', furnishing: 'unfurnished',
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const jarCookie = ama.cookie();
  const r = await fetch(`${base}/listings/2`, { method: 'POST', body: fd, headers: { cookie: jarCookie }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(db.prepare('SELECT status FROM listings WHERE id = 2').get().status, 'pending');
});

test('taking a listing down emails the reason and support contact', async () => {
  await moderate(1, 'takedown', 'Reported as already rented');
  const m = lastTo('ama@test.gh');
  assert.equal(m.subject, 'Your listing was removed: "2-bed flat in Osu"');
  assert.match(m.text, /Reason: Reported as already rented/);
  assert.match(m.text, /Contact support: mailto:/);
});

test('verifying a landlord sends one email listing all newly published listings', async () => {
  const yaw = db.prepare("SELECT id FROM users WHERE email = 'yaw@test.gh'").get().id;
  await admin.post(`/admin/users/${yaw}/verification`, { _csrf: acsrf, action: 'verify' });
  await mailer.flush();
  const mails = emailsTo('yaw@test.gh');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, 'Your 2 listings are live');
  assert.match(mails[0].text, /Kasoa: Single room in Kasoa \(GH₵ 450 \/ month\)/);
  assert.match(mails[0].text, /Dansoman: Studio in Dansoman \(GH₵ 900 \/ month\)/);
  assert.match(mails[0].text, /Open your dashboard: /);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM listings WHERE landlord_id = ? AND status = 'active'").get(yaw).n, 2);
});

test('landlords who switched emails off get no listing emails, but still get SMS', async () => {
  db.prepare("UPDATE users SET email_alerts = 0 WHERE email = 'ama@test.gh'").run();
  db.prepare('DELETE FROM sms_log').run();
  const before = emailsTo('ama@test.gh').length;
  await moderate(2, 'approve');
  assert.equal(emailsTo('ama@test.gh').length, before);
  assert.ok(db.prepare("SELECT 1 FROM sms_log WHERE phone = '233241000001' AND kind = 'listing'").get());
});
