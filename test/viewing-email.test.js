// Email notifications for viewing requests.
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
    'apartment', 'Osu', 'Oxford St, behind the mall', 2, 1, 3000, 6, 'semi', 'active')`).run(landlord);
  db.prepare("UPDATE listings SET gps_address = 'GA-019-8765' WHERE id = 1").run();
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
const lastTo = (to) => emailsTo(to).at(-1);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
let tenant, landlord, tcsrf, lcsrf;

async function requestViewing(note = 'Coming with my sister & <b>mum</b>') {
  const r = await tenant.post('/listings/1/viewings', { _csrf: tcsrf, date: tomorrow, time: 'afternoon', note });
  assert.equal(r.status, 302);
  await mailer.flush();
  return db.prepare('SELECT id FROM viewings ORDER BY id DESC').get().id;
}

test('requesting a viewing emails the landlord with the date, tenant contact and note', async () => {
  tenant = client();
  await tenant.login('kojo@test.gh');
  tcsrf = await tenant.csrf('/listings/1');
  landlord = client();
  await landlord.login('ama@test.gh');
  lcsrf = await landlord.csrf('/dashboard');

  await requestViewing();
  const m = lastTo('ama@test.gh');
  assert.match(m.subject, /^Viewing request: Kojo <b>Tenant<\/b> wants to see "2-bed flat in Osu"$/);
  assert.match(m.text, /When: \w+day \d+ \w+ \d{4}, Afternoon \(12pm – 4pm\)/);
  assert.match(m.text, /Phone: 027 100 0004/);
  assert.match(m.text, /Note: Coming with my sister & <b>mum<\/b>/);
  assert.match(m.text, /Confirm or decline: https?:\/\/\S+\/dashboard/);
  assert.match(m.html, /Kojo &lt;b&gt;Tenant&lt;\/b&gt;/);
  assert.match(m.html, /sister &amp; &lt;b&gt;mum&lt;\/b&gt;/);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind = 'viewing'").get().status, 'sent');
});

test('confirming emails the tenant the address, landlord phone and a calendar invite', async () => {
  const id = db.prepare('SELECT id FROM viewings ORDER BY id DESC').get().id;
  await landlord.post(`/viewings/${id}/status`, { _csrf: lcsrf, status: 'confirmed' });
  await mailer.flush();
  const m = lastTo('kojo@test.gh');
  assert.match(m.subject, /^Viewing confirmed: "2-bed flat in Osu" on /);
  assert.match(m.text, /Address: Oxford St, behind the mall, Osu/);
  assert.match(m.text, /GhanaPost GPS: GA-019-8765/);
  assert.match(m.text, /Phone: 024 100 0001/);
  const [ics] = m.attachments;
  assert.equal(ics.filename, 'viewing.ics');
  const day = tomorrow.replace(/-/g, '');
  assert.match(ics.content, new RegExp(`DTSTART:${day}T120000Z\\r\\nDTEND:${day}T160000Z`));
  assert.match(ics.content, /LOCATION:Oxford St\\, behind the mall\\, Osu\\, Accra\\, GA-019-8765/);
  assert.match(ics.content, new RegExp(`UID:viewing-${id}@`));
});

test('cancelling emails the other party', async () => {
  const id = db.prepare('SELECT id FROM viewings ORDER BY id DESC').get().id;
  const before = emailsTo('ama@test.gh').length;
  await tenant.post(`/viewings/${id}/status`, { _csrf: tcsrf, status: 'cancelled' });
  await mailer.flush();
  assert.equal(emailsTo('ama@test.gh').length, before + 1);
  const m = lastTo('ama@test.gh');
  assert.match(m.subject, /^Viewing cancelled: "2-bed flat in Osu"/);
  assert.match(m.text, /Kojo <b>Tenant<\/b> cancelled the viewing/);
  assert.match(m.text, /Open your dashboard: /);
});

test('declining emails the tenant a link to similar homes', async () => {
  const id = await requestViewing('');
  await landlord.post(`/viewings/${id}/status`, { _csrf: lcsrf, status: 'declined' });
  await mailer.flush();
  const m = lastTo('kojo@test.gh');
  assert.match(m.subject, /^Viewing not available: "2-bed flat in Osu"$/);
  assert.match(m.text, /See more homes in Osu: https?:\/\/\S+\/listings\?area=Osu/);
  assert.doesNotMatch(m.text, /Note:/, 'empty note row is left out');
});

test('users who switched emails off get no viewing emails', async () => {
  db.prepare("UPDATE users SET email_alerts = 0 WHERE email = 'ama@test.gh'").run();
  const before = emailsTo('ama@test.gh').length;
  await requestViewing('');
  assert.equal(emailsTo('ama@test.gh').length, before);
  // SMS alerts are still sent (separate setting).
  assert.ok(db.prepare("SELECT 1 FROM sms_log WHERE phone = '233241000001' AND kind = 'viewing'").get());
});
