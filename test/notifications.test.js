// SMS alerts, password reset, and SMS provider request formats.
process.env.NODE_ENV = 'test';
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ofie-notify-'));
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.PRIVATE_DIR = path.join(tmp, 'private');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createSms } = require('../src/sms');
const { hashPassword } = require('../src/auth');

let server, base, db, sms;
const emails = [];

before(async () => {
  db = open(':memory:');
  sms = createSms(db);
  const mailer = { enabled: true, send: async (m) => { emails.push(m); return true; } };
  server = createApp(db, { sms, mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const add = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const pw = hashPassword('old-password');
  const landlord = add.run('Ama Landlord', 'ama@test.gh', '233241000001', pw, 'landlord', 'verified').lastInsertRowid;
  add.run('Esi Tenant', 'esi@test.gh', '233271000004', pw, 'tenant', 'unverified');
  db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms, bathrooms,
    rent_ghs, advance_months, furnishing, status) VALUES (?, 'Nice flat in Osu', 'A lovely flat close to everything you need in Osu.',
    'apartment', 'Osu', 'Oxford St', 2, 1, 3000, 6, 'semi', 'active')`).run(landlord);
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

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
    async login(email, password) {
      const _csrf = await this.csrf('/login');
      return req('POST', '/login', { _csrf, email, password });
    },
  };
}

const texts = (phone, kind) => db.prepare('SELECT * FROM sms_log WHERE phone = ? AND kind = ? ORDER BY id').all(phone, kind);

test('messages and viewings trigger SMS alerts, with a cooldown per chat', async () => {
  const tenant = client();
  await tenant.login('esi@test.gh', 'old-password');
  const _csrf = await tenant.csrf('/listings/1');
  const r = await tenant.post('/listings/1/contact', { _csrf, body: 'Is it available?' });
  const conv = r.headers.get('location');
  await tenant.post(conv, { _csrf, body: 'Hello again' });
  await sms.flush();

  const toLandlord = texts('233241000001', 'message');
  assert.equal(toLandlord.length, 1, 'second message within cooldown does not text again');
  assert.match(toLandlord[0].body, /New message from Esi Tenant about "Nice flat in Osu"/);
  assert.equal(toLandlord[0].status, 'logged');

  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await tenant.post('/listings/1/viewings', { _csrf, date: tomorrow, time: 'afternoon' });
  await sms.flush();
  assert.match(texts('233241000001', 'viewing')[0].body, /Esi Tenant wants to view "Nice flat in Osu"/);

  // Landlord confirms → tenant is texted.
  const landlord = client();
  await landlord.login('ama@test.gh', 'old-password');
  const lcsrf = await landlord.csrf('/dashboard');
  await landlord.post('/viewings/1/status', { _csrf: lcsrf, status: 'confirmed' });
  await sms.flush();
  assert.match(texts('233271000004', 'viewing')[0].body, /Ama Landlord CONFIRMED the viewing/);

  // Turning alerts off stops them.
  await landlord.post('/account', { _csrf: lcsrf, name: 'Ama Landlord', phone: '0241000001', whatsapp: '1' });
  assert.equal(db.prepare("SELECT sms_alerts FROM users WHERE email = 'ama@test.gh'").get().sms_alerts, 0);
  db.prepare('DELETE FROM sms_log').run();
  await tenant.post(conv, { _csrf, body: 'Third message' });
  await sms.flush();
  assert.equal(texts('233241000001', 'message').length, 0);
});

test('password reset by SMS code', async () => {
  const c = client();
  let _csrf = await c.csrf('/forgot');
  let r = await c.post('/forgot', { _csrf, identifier: '027 100 0004' });
  assert.equal(r.status, 200);
  assert.match(r.text, /we've sent a 6-digit code/);
  await sms.flush();
  const code = texts('233271000004', 'reset').at(-1).body.match(/^(\d{6})/)[1];

  // Wrong code is rejected and counted.
  r = await c.post('/reset', { _csrf, identifier: '0271000004', code: code === '000000' ? '111111' : '000000', password: 'brand-new-pass', password2: 'brand-new-pass' });
  assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT attempts FROM password_resets ORDER BY id DESC').get().attempts, 1);

  r = await c.post('/reset', { _csrf, identifier: '0271000004', code, password: 'brand-new-pass', password2: 'brand-new-pass' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/dashboard/);
  await sms.flush();
  assert.match(texts('233271000004', 'security').at(-1).body, /password was just changed/);

  // Old password no longer works, new one does; code can't be reused.
  assert.equal((await client().login('esi@test.gh', 'old-password')).status, 401);
  assert.equal((await client().login('esi@test.gh', 'brand-new-pass')).status, 302);
  const c2 = client();
  r = await c2.post('/reset', { _csrf: await c2.csrf('/reset'), identifier: '0271000004', code, password: 'another-pass-1', password2: 'another-pass-1' });
  assert.equal(r.status, 400);
});

test('password reset by email link, and lockout after 5 wrong codes', async () => {
  const c = client();
  const _csrf = await c.csrf('/forgot');
  await c.post('/forgot', { _csrf, identifier: 'ama@test.gh' });
  const mail = emails.at(-1);
  assert.equal(mail.to, 'ama@test.gh');
  const link = mail.text.match(/\/reset\?token=([\w-]+)/)[0];
  let r = await c.get(link);
  assert.equal(r.status, 200);
  assert.match(r.text, /name="token"/);
  const token = link.split('=')[1];
  r = await c.post('/reset', { _csrf, token, password: 'linked-password', password2: 'linked-password' });
  assert.equal(r.status, 302);
  assert.equal((await client().login('ama@test.gh', 'linked-password')).status, 302);
  // Link is single-use.
  assert.match((await c.get(link)).text, /expired or was already used/);

  // Brute force protection.
  const b = client();
  const bcsrf = await b.csrf('/forgot');
  await b.post('/forgot', { _csrf: bcsrf, identifier: 'ama@test.gh' });
  for (let i = 0; i < 5; i++) {
    await b.post('/reset', { _csrf: bcsrf, identifier: 'ama@test.gh', code: '99999' + i, password: 'xxxxxxxxx', password2: 'xxxxxxxxx' });
  }
  await sms.flush();
  const realCode = texts('233241000001', 'reset').at(-1).body.slice(0, 6);
  r = await b.post('/reset', { _csrf: bcsrf, identifier: 'ama@test.gh', code: realCode, password: 'xxxxxxxxx', password2: 'xxxxxxxxx' });
  assert.match(r.text, /Too many wrong attempts/);
});

test('unknown accounts get the same response (no account enumeration)', async () => {
  const c = client();
  const _csrf = await c.csrf('/forgot');
  const before = db.prepare('SELECT COUNT(*) n FROM sms_log').get().n;
  const r = await c.post('/forgot', { _csrf, identifier: 'nobody@nowhere.gh' });
  assert.equal(r.status, 200);
  assert.match(r.text, /If an account matches/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sms_log').get().n, before);
});

test('Arkesel and Hubtel requests are well-formed; failures are recorded, not thrown', async () => {
  const realFetch = global.fetch;
  const saved = { ...config.sms };
  const calls = [];
  try {
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    };
    Object.assign(config.sms, { provider: 'arkesel', arkeselApiKey: 'ark-key', senderId: 'OfieAccra' });
    const ark = createSms(db);
    await ark.send({ phone: '233241000001', kind: 'test', body: 'Hello' });
    assert.equal(calls[0].url, 'https://sms.arkesel.com/api/v2/sms/send');
    assert.equal(calls[0].opts.headers['api-key'], 'ark-key');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { sender: 'OfieAccra', message: 'Hello', recipients: ['233241000001'] });

    Object.assign(config.sms, { provider: 'hubtel', hubtelClientId: 'cid', hubtelClientSecret: 'sec' });
    await createSms(db).send({ phone: '233241000001', kind: 'test', body: 'Hi there' });
    const u = new URL(calls[1].url);
    assert.equal(u.origin + u.pathname, 'https://smsc.hubtel.com/v1/messages/send');
    assert.equal(u.searchParams.get('to'), '233241000001');
    assert.equal(u.searchParams.get('content'), 'Hi there');
    assert.equal(u.searchParams.get('clientid'), 'cid');

    global.fetch = async () => new Response('nope', { status: 401 });
    await createSms(db).send({ phone: '233241000001', kind: 'test', body: 'Will fail' });
    const failed = db.prepare("SELECT * FROM sms_log WHERE body = 'Will fail'").get();
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /Hubtel 401/);
  } finally {
    global.fetch = realFetch;
    Object.assign(config.sms, saved);
  }
});
