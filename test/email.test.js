// Email notifications for new messages.
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');
const { hashPassword } = require('../src/auth');

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
  const landlord = add.run('Ama Owusu', 'ama@test.gh', '233241000001', pw, 'landlord').lastInsertRowid;
  add.run('Kojo <b>Tenant</b>', 'kojo@test.gh', '233271000004', pw, 'tenant');
  db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms, bathrooms,
    rent_ghs, advance_months, furnishing, status) VALUES (?, '2-bed flat in Osu', 'A bright two bedroom flat a short walk from Oxford Street.',
    'apartment', 'Osu', 'Oxford St', 2, 1, 3000, 6, 'semi', 'active')`).run(landlord);
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
let tenant, conv, tcsrf;

test('a new message emails the recipient with an escaped preview, reply link and unsubscribe headers', async () => {
  tenant = client();
  await tenant.login('kojo@test.gh');
  tcsrf = await tenant.csrf('/listings/1');
  const r = await tenant.post('/listings/1/contact', { _csrf: tcsrf, body: 'Is it available?\n<script>alert(1)</script>' });
  conv = r.headers.get('location');
  await mailer.flush();

  const [m] = emailsTo('ama@test.gh');
  assert.ok(m, 'landlord was emailed');
  assert.match(m.subject, /^New message from Kojo <b>Tenant<\/b> about "2-bed flat in Osu"$/);
  assert.match(m.text, /> Is it available\?/);
  assert.match(m.text, new RegExp(`Reply here: https?://[^\\s]+${conv}\\n`));
  assert.match(m.html, /Kojo &lt;b&gt;Tenant&lt;\/b&gt;/);
  assert.match(m.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.headers['List-Unsubscribe'], /^<https?:\/\/[^/]+\/unsubscribe\?token=[\w-]+>$/);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind = 'message'").get().status, 'sent');
});

test('follow-up messages in the same chat within the cooldown are not emailed again', async () => {
  await tenant.post(conv, { _csrf: tcsrf, body: 'Hello?' });
  await mailer.flush();
  assert.equal(emailsTo('ama@test.gh').length, 1);
});

test('replies email the other person', async () => {
  const landlord = client();
  await landlord.login('ama@test.gh');
  await landlord.post(conv, { _csrf: await landlord.csrf('/messages'), body: 'Yes, come on Saturday.' });
  await mailer.flush();
  const [m] = emailsTo('kojo@test.gh');
  assert.match(m.subject, /New message from Ama Owusu/);
  assert.match(m.text, /Hello Kojo/);
});

test('unsubscribe link: GET only confirms, POST unsubscribes, and can be undone', async () => {
  const token = emailsTo('ama@test.gh')[0].headers['List-Unsubscribe'].match(/token=([\w-]+)/)[1];
  let r = await client().get(`/unsubscribe?token=${token}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Stop emails about new messages to <strong>a•+@test\.gh<\/strong>/);
  assert.equal(db.prepare("SELECT email_alerts FROM users WHERE email = 'ama@test.gh'").get().email_alerts, 1, 'GET does not unsubscribe');

  // RFC 8058 one-click POST from the mail client: no cookies, no CSRF token.
  r = await client().post(`/unsubscribe?token=${token}`, { 'List-Unsubscribe': 'One-Click' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT email_alerts FROM users WHERE email = 'ama@test.gh'").get().email_alerts, 0);

  db.prepare("DELETE FROM email_log").run();
  await tenant.post(conv, { _csrf: tcsrf, body: 'Another question' });
  await mailer.flush();
  assert.equal(emailsTo('ama@test.gh').length, 1, 'no new email after unsubscribing');

  await client().post('/unsubscribe', { token, action: 'resubscribe' });
  assert.equal(db.prepare("SELECT email_alerts FROM users WHERE email = 'ama@test.gh'").get().email_alerts, 1);
  assert.equal((await client().get('/unsubscribe?token=not-a-real-token-123456')).status, 404);
});

test('the account page toggle turns message emails off', async () => {
  const c = client();
  await c.login('kojo@test.gh');
  const _csrf = await c.csrf('/account');
  assert.match((await c.get('/account')).text, /Email me when I get a new message/);
  await c.post('/account', { _csrf, name: 'Kojo Tenant', phone: '0271000004', sms_alerts: '1' });
  assert.equal(db.prepare("SELECT email_alerts FROM users WHERE email = 'kojo@test.gh'").get().email_alerts, 0);
});

test('a failed send is recorded and does not count toward the cooldown', async () => {
  db.prepare("DELETE FROM email_log").run();
  failNext = true;
  await tenant.post(conv, { _csrf: tcsrf, body: 'Will this send?' });
  await mailer.flush();
  assert.equal(db.prepare("SELECT status FROM email_log ORDER BY id DESC").get().status, 'failed');
  const before = emailsTo('ama@test.gh').length;
  await tenant.post(conv, { _csrf: tcsrf, body: 'Trying again' });
  await mailer.flush();
  assert.equal(emailsTo('ama@test.gh').length, before + 1);
});
