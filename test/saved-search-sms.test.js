// SMS alerts for saved searches.
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');
const { hashPassword } = require('../src/auth');
const { runSavedSearchAlerts } = require('../src/jobs/savedSearchAlerts');

let server, base, db, mailer, app;
const outbox = [];
let landlordId;

before(async () => {
  db = open(':memory:');
  mailer = createMailer(db, { sendMail: async (m) => { outbox.push(m); } });
  app = createApp(db, { mailer });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const add = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES (?, ?, ?, ?, ?, 'verified', 1)`);
  const pw = hashPassword('password123');
  landlordId = add.run('Ama Owusu', 'ama@test.gh', '233241000001', pw, 'landlord').lastInsertRowid;
  add.run('Kojo Tenant', 'kojo@test.gh', '233271000004', pw, 'tenant');
  add.run('Efua Unverified', 'efua@test.gh', '233201234567', pw, 'tenant');
  db.prepare("UPDATE users SET phone_verified = 0 WHERE email = 'efua@test.gh'").run();
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

// Adds a listing; status 'active' makes the trigger stamp published_at.
function addListing({ title, area = 'Osu', rent = 3000, beds = 2, amenities = 'borehole', status = 'active', landlord = landlordId }) {
  return db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms, bathrooms,
    rent_ghs, advance_months, furnishing, amenities, status) VALUES (?, ?, 'A bright home close to shops, with reliable water and power.',
    'apartment', ?, 'Main road', ?, 1, ?, 6, 'semi', ?, ?)`).run(landlord, title, area, beds, rent, amenities, status).lastInsertRowid;
}
// Pretend the saved searches were created in the past, so "new" listings are after them.
const backdateSearches = () => db.prepare("UPDATE saved_searches SET checked_until = datetime('now', '-1 hour')").run();
const run = async (now = new Date()) => { const r = runSavedSearchAlerts(db, app.locals.ctx, now); await mailer.flush(); return r; };
const alertsTo = (to) => outbox.filter((m) => m.to === to && /new home/.test(m.subject));
let kojo, kcsrf;

const texts = () => db.prepare("SELECT * FROM sms_log WHERE kind = 'saved_search' ORDER BY id").all();
const searchOf = (email) => db.prepare('SELECT s.* FROM saved_searches s JOIN users u ON u.id = s.user_id WHERE u.email = ?').get(email);
const later = (h) => new Date(Date.now() + h * 3600e3);

test('a search saved with SMS texts the user about a new match, and emails too', async () => {
  kojo = client();
  await kojo.login('kojo@test.gh');
  kcsrf = await kojo.csrf('/listings');
  assert.match((await kojo.get('/listings?area=Osu')).text, /name="alert_sms"/);
  const r = await kojo.post('/saved-searches', { _csrf: kcsrf, area: 'Osu', beds: '2', frequency: 'instant', alert_email: '1', alert_sms: '1' });
  assert.match(decodeURIComponent(r.headers.get('location')), /We'll email and text you as soon as we list new homes/);
  const s = searchOf('kojo@test.gh');
  assert.equal(s.email, 1);
  assert.equal(s.sms, 1);

  backdateSearches();
  const id = addListing({ title: 'Bright 2-bed in Osu', rent: 3500 });
  const res = await run(later(0.001));
  assert.deepEqual([res.emailed, res.texted], [1, 1]);
  const [t] = texts();
  assert.equal(t.phone, '233271000004');
  assert.match(t.body, new RegExp(`^Ofie Accra: New home for your search "2\\+ bed homes in Osu": GH₵ 3,500/mo, 2-bed in Osu\\. https?://\\S+/listings/${id} Manage alerts: https?://\\S+/dashboard$`));
  assert.equal(alertsTo('kojo@test.gh').length, 1);
});

test('several new homes are summarised in one text with the cheapest rent and a link to all of them', async () => {
  backdateSearches();
  addListing({ title: 'A', rent: 5000 });
  addListing({ title: 'B', rent: 2800 });
  addListing({ title: 'C', rent: 4100 });
  await run(later(0.002));
  assert.match(texts().at(-1).body, /^Ofie Accra: 3 new homes for your search "2\+ bed homes in Osu", from GH₵ 2,800\/mo\. See them: https?:\/\/\S+\/listings\?area=Osu&beds=2 Manage alerts: /);
});

test('SMS-only searches send no email', async () => {
  const s = searchOf('kojo@test.gh');
  await kojo.post(`/saved-searches/${s.id}/frequency`, { _csrf: kcsrf, frequency: 'instant', alert_sms: '1' });
  assert.equal(searchOf('kojo@test.gh').email, 0);
  const emails = alertsTo('kojo@test.gh').length;
  backdateSearches();
  addListing({ title: 'SMS only home' });
  const before = texts().length;
  await run(later(0.003));
  assert.equal(texts().length, before + 1);
  assert.equal(alertsTo('kojo@test.gh').length, emails);
});

test('over the daily text limit, SMS-only matches wait for the next day and arrive together', async () => {
  // Kojo has had 3 texts in the last 24 hours (the default limit).
  assert.equal(texts().length, 3);
  backdateSearches();
  const held = addListing({ title: 'Held for tomorrow' });
  let r = await run(later(0.004));
  assert.equal(r.texted, 0);
  assert.equal(texts().length, 3, 'no fourth text today');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_search_hits WHERE listing_id = ?').get(held).n, 0, 'not marked as sent');

  addListing({ title: 'Also tomorrow' });
  r = await run(later(25));
  assert.equal(r.texted, 1);
  assert.match(texts().at(-1).body, /2 new homes for your search/);
});

test('over the limit with email ticked: the email still goes out, without a text', async () => {
  const s = searchOf('kojo@test.gh');
  await kojo.post(`/saved-searches/${s.id}/frequency`, { _csrf: kcsrf, frequency: 'instant', alert_email: '1', alert_sms: '1' });
  db.prepare("UPDATE sms_log SET created_at = datetime('now') WHERE kind = 'saved_search'").run(); // all texts "today" again
  backdateSearches();
  addListing({ title: 'Email only today' });
  const emails = alertsTo('kojo@test.gh').length;
  const before = texts().length;
  await run(later(0.005));
  assert.equal(texts().length, before);
  assert.equal(alertsTo('kojo@test.gh').length, emails + 1);
});

test('turning SMS alerts off on the account page stops search texts', async () => {
  db.prepare("DELETE FROM sms_log WHERE kind = 'saved_search'").run();
  db.prepare("UPDATE users SET sms_alerts = 0 WHERE email = 'kojo@test.gh'").run();
  backdateSearches();
  addListing({ title: 'No text please' });
  await run(later(0.006));
  assert.equal(texts().length, 0);
  db.prepare("UPDATE users SET sms_alerts = 1 WHERE email = 'kojo@test.gh'").run();
});

test('users without a verified phone cannot turn on SMS alerts', async () => {
  const efua = client();
  await efua.login('efua@test.gh');
  const _csrf = await efua.csrf('/listings');
  assert.match((await efua.get('/listings?area=Osu')).text, /Verify phone for SMS/);
  await efua.post('/saved-searches', { _csrf, area: 'Madina', frequency: 'instant', alert_email: '1', alert_sms: '1' });
  assert.equal(searchOf('efua@test.gh').sms, 0);
});

test('choosing neither email nor SMS is refused when saving, and turns alerts off on the dashboard', async () => {
  let r = await kojo.post('/saved-searches', { _csrf: kcsrf, area: 'Labone', frequency: 'instant' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Choose email, SMS or both/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM saved_searches WHERE query LIKE '%Labone%'").get().n, 0);

  const s = searchOf('kojo@test.gh');
  r = await kojo.post(`/saved-searches/${s.id}/frequency`, { _csrf: kcsrf, frequency: 'instant' });
  assert.match(decodeURIComponent(r.headers.get('location')), /No email or SMS ticked, so alerts for this search are off/);
  assert.equal(searchOf('kojo@test.gh').frequency, 'off');
});
