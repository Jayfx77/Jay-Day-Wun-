// Security notices when a password is changed.
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');
const { hashPassword } = require('../src/auth');
const { describeDevice, accraTime } = require('../src/helpers');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
let server, base, db, mailer;
const outbox = [];

before(async () => {
  db = open(':memory:');
  mailer = createMailer(db, { sendMail: async (m) => { outbox.push(m); } });
  server = createApp(db, { mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // Both alert settings OFF: security notices must still arrive.
  db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, phone_verified, sms_alerts, email_alerts)
    VALUES ('Esi Mensah', 'esi@test.gh', '233271000004', ?, 'tenant', 1, 0, 0)`).run(hashPassword('first-password'));
});
after(() => server.close());

function client() {
  const jar = {};
  async function req(method, url, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': ANDROID };
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
  };
}

const securityEmails = () => outbox.filter((m) => m.subject === 'Your Ofie Accra password was changed');
const securityTexts = () => db.prepare("SELECT body FROM sms_log WHERE kind = 'security' ORDER BY id").all();
let esi;

test('changing the password on the account page sends a security email and SMS, even with alerts off', async () => {
  esi = client();
  let _csrf = await esi.csrf('/login');
  await esi.post('/login', { _csrf, email: 'esi@test.gh', password: 'first-password' });
  _csrf = await esi.csrf('/account');
  await esi.post('/account', {
    _csrf, name: 'Esi Mensah', phone: '0271000004', current_password: 'first-password', new_password: 'second-password',
  });
  await mailer.flush();

  const [m] = securityEmails();
  assert.ok(m, 'security email sent');
  assert.equal(m.to, 'esi@test.gh');
  assert.match(m.text, /Your password was changed from your account page\. For your safety, you have been signed out everywhere else\./);
  assert.match(m.text, /When: \w+day \d+ \w+ \d{4} at \d{2}:\d{2} GMT/);
  assert.match(m.text, /Device: Chrome on Android/);
  assert.match(m.text, /IP address: \S+/);
  assert.match(m.text, /This wasn't me: secure my account: https?:\/\/\S+\/forgot/);
  assert.match(m.text, /always sent, even if you have turned off other emails/);
  assert.equal(m.headers, undefined, 'no unsubscribe headers on security email');
  assert.doesNotMatch(m.html, /Stop these emails/);
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind = 'security'").get().status, 'sent');

  const texts = securityTexts();
  assert.equal(texts.length, 1);
  assert.match(texts[0].body, /Your password was just changed\. If this wasn't you, reset it now at https?:\/\/\S+\/forgot/);
});

test('saving the account page without a new password sends nothing', async () => {
  const before = securityEmails().length;
  const _csrf = await esi.csrf('/account');
  await esi.post('/account', { _csrf, name: 'Esi A. Mensah', phone: '0271000004' });
  await mailer.flush();
  assert.equal(securityEmails().length, before);
});

test('a wrong current password changes nothing and sends nothing', async () => {
  const before = securityEmails().length;
  const _csrf = await esi.csrf('/account');
  const r = await esi.post('/account', { _csrf, name: 'Esi Mensah', phone: '0271000004', current_password: 'nope', new_password: 'third-password' });
  assert.equal(r.status, 400);
  await mailer.flush();
  assert.equal(securityEmails().length, before);
});

test('resetting with an SMS code says so in the security email', async () => {
  const c = client();
  const _csrf = await c.csrf('/forgot');
  await c.post('/forgot', { _csrf, identifier: '0271000004' });
  const code = db.prepare("SELECT body FROM sms_log WHERE kind = 'reset' ORDER BY id DESC").get().body.slice(0, 6);
  await c.post('/reset', { _csrf, identifier: '0271000004', code, password: 'code-password', password2: 'code-password' });
  await mailer.flush();
  assert.match(securityEmails().at(-1).text, /changed using a reset code sent by SMS/);
});

test('resetting with an email link says so in the security email', async () => {
  const c = client();
  const _csrf = await c.csrf('/forgot');
  await c.post('/forgot', { _csrf, identifier: 'esi@test.gh' });
  await mailer.flush();
  const link = outbox.filter((m) => /Reset your/.test(m.subject)).at(-1).text.match(/\/reset\?token=([\w-]+)/)[1];
  await c.post('/reset', { _csrf, token: link, password: 'link-password', password2: 'link-password' });
  await mailer.flush();
  assert.match(securityEmails().at(-1).text, /changed using a reset link sent by email/);
  assert.equal(securityTexts().length, 3, 'an SMS for each of the three changes');
});

test('device descriptions and times are readable', () => {
  assert.equal(describeDevice(ANDROID), 'Chrome on Android');
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'Safari on iPhone/iPad');
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Edge on Windows');
  assert.equal(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox on Mac');
  assert.equal(describeDevice(''), 'Unknown device');
  assert.equal(accraTime(new Date('2026-11-05T13:45:10Z')), 'Thursday 5 November 2026 at 13:45 GMT');
});
