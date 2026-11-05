// Phone number verification at sign-up.
process.env.NODE_ENV = 'test';
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ofie-phone-'));
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.PRIVATE_DIR = path.join(tmp, 'private');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

let server, base, db;

before(async () => {
  db = open(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const landlord = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES ('Kofi Landlord', 'kofi@test.gh', '233241000001', ?, 'landlord', 'verified', 1)`).run(hashPassword('password123')).lastInsertRowid;
  db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms, bathrooms,
    rent_ghs, advance_months, furnishing, status) VALUES (?, 'Studio in Labone', 'A quiet furnished studio close to the Labone shops.',
    'studio', 'Labone', 'Labone Crescent', 1, 1, 2500, 6, 'furnished', 'active')`).run(landlord);
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  const jar = {};
  async function req(method, url, body, headers = {}) {
    headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
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
    post: (u, b, h) => req('POST', u, b, h),
    async csrf(u = '/') { return (await req('GET', u)).text.match(/name="_csrf" value="([^"]+)"/)[1]; },
  };
}

const lastCode = (phone) => db.prepare("SELECT body FROM sms_log WHERE phone = ? AND kind = 'verify' ORDER BY id DESC").get(phone)?.body.slice(0, 6);
const userBy = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
// Pretend the last code was sent long enough ago to allow a resend.
const ageCodes = (email) => db.prepare("UPDATE phone_codes SET created_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(userBy(email).id);

async function signUp(c, email, phone) {
  const _csrf = await c.csrf('/register');
  return c.post('/register', {
    _csrf, role: 'tenant', name: 'Abena Tenant', email, phone, password: 'password123', password2: 'password123', agree: '1',
  });
}

test('sign-up texts a code; unverified users can browse but not contact landlords', async () => {
  const c = client();
  const r = await signUp(c, 'abena@test.gh', '055 123 4567');
  assert.match(r.headers.get('location'), /^\/verify-phone\?next=/);
  assert.match(lastCode('233551234567'), /^\d{6}$/);
  assert.equal(userBy('abena@test.gh').phone_verified, 0);

  const page = await c.get('/listings/1');
  assert.equal(page.status, 200);
  assert.match(page.text, /Verify your phone to contact the landlord/);
  assert.doesNotMatch(page.text, /024 100 0001/, 'landlord number hidden until verified');
  assert.match(page.text, /verify your phone number<\/a> to message landlords/);

  const _csrf = await c.csrf('/listings/1');
  const blocked = await c.post('/listings/1/contact', { _csrf, body: 'Hi' }, { referer: `${base}/listings/1` });
  assert.equal(blocked.headers.get('location'), `/verify-phone?next=${encodeURIComponent('/listings/1')}`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 0);
});

test('wrong codes are counted and lock out after 5 tries; resend is rate limited', async () => {
  const c = client();
  await signUp(c, 'yaa@test.gh', '0201112233');
  const _csrf = await c.csrf('/verify-phone');
  const good = lastCode('233201112233');
  const bad = good === '000000' ? '111111' : '000000';

  let r = await c.post('/verify-phone', { _csrf, code: bad });
  assert.equal(r.status, 400);
  assert.match(r.text, /4 attempts left/);
  for (let i = 0; i < 4; i++) await c.post('/verify-phone', { _csrf, code: bad });
  r = await c.post('/verify-phone', { _csrf, code: good });
  assert.match(r.text, /Too many wrong attempts/);
  assert.equal(userBy('yaa@test.gh').phone_verified, 0);

  r = await c.post('/verify-phone/resend', { _csrf });
  assert.match(r.text, /Please wait \d+ seconds/);

  ageCodes('yaa@test.gh');
  r = await c.post('/verify-phone/resend', { _csrf });
  assert.match(r.text, /A new code is on its way/);
  const fresh = lastCode('233201112233');
  // Old code no longer works after a resend.
  if (fresh !== good) assert.equal((await c.post('/verify-phone', { _csrf, code: good })).status, 400);
  r = await c.post('/verify-phone', { _csrf, code: fresh, next: '/listings/1' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/listings\/1\?ok=Phone/);
  assert.equal(userBy('yaa@test.gh').phone_verified, 1);

  // Now they can see the landlord's number and send a message.
  assert.match((await c.get('/listings/1')).text, /024 100 0001/);
  r = await c.post('/listings/1/contact', { _csrf, body: 'Is it available?' });
  assert.match(r.headers.get('location'), /^\/messages\/\d+$/);
});

test('expired codes are rejected', async () => {
  const c = client();
  await signUp(c, 'kwame@test.gh', '0209998877');
  db.prepare("UPDATE phone_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(userBy('kwame@test.gh').id);
  const r = await c.post('/verify-phone', { _csrf: await c.csrf('/verify-phone'), code: lastCode('233209998877') });
  assert.match(r.text, /code has expired/);
});

test('a number can only be verified on one account', async () => {
  const c = client();
  await signUp(c, 'copycat@test.gh', '0241000001'); // Kofi's verified number
  const r = await c.post('/verify-phone', { _csrf: await c.csrf('/verify-phone'), code: lastCode('233241000001') });
  assert.equal(r.status, 400);
  assert.match(r.text, /already verified on another/);
  assert.equal(userBy('copycat@test.gh').phone_verified, 0);
});

test('changing your number requires verifying the new one', async () => {
  const c = client();
  await signUp(c, 'efua@test.gh', '0205554444');
  let _csrf = await c.csrf('/verify-phone');
  await c.post('/verify-phone', { _csrf, code: lastCode('233205554444') });
  assert.equal(userBy('efua@test.gh').phone_verified, 1);

  ageCodes('efua@test.gh');
  _csrf = await c.csrf('/account');
  const r = await c.post('/account', { _csrf, name: 'Efua Tenant', phone: '0205556666', sms_alerts: '1' });
  assert.equal(r.headers.get('location'), '/verify-phone?next=/account');
  const u = userBy('efua@test.gh');
  assert.equal(u.phone, '233205556666');
  assert.equal(u.phone_verified, 0);
  await c.post('/verify-phone', { _csrf, code: lastCode('233205556666') });
  assert.equal(userBy('efua@test.gh').phone_verified, 1);
});
