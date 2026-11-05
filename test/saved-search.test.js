// Saved searches and email alerts for new matching listings.
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');
const { hashPassword } = require('../src/auth');
const { normalise, describe } = require('../src/savedSearches');
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

test('filters are normalised and described in plain words', () => {
  const q = normalise({ area: 'East Legon', beds: '2', max: '5000', amenity: ['borehole', 'bogus'], page: '3', sort: 'price_asc', ok: 'x' });
  assert.deepEqual(q, { area: 'East Legon', max: '5000', beds: '2', amenity: ['borehole'] });
  assert.equal(describe(q), '2+ bed homes in East Legon, up to GH₵ 5,000/month, with borehole / poly tank');
  assert.equal(describe(normalise({ area: 'Nowhere' })), 'Homes anywhere in Accra');
});

test('a logged-in user can save a search; saving again does not duplicate it', async () => {
  const anon = await client().get('/listings?area=Osu&max=4000&beds=2&amenity=borehole');
  assert.match(anon.text, /Log in to get alerts for this search/);

  kojo = client();
  await kojo.login('kojo@test.gh');
  kcsrf = await kojo.csrf('/listings?area=Osu');
  const form = { _csrf: kcsrf, area: 'Osu', max: '4000', beds: '2', amenity: 'borehole', frequency: 'instant', alert_email: '1' };
  let r = await kojo.post('/saved-searches', form);
  assert.match(r.headers.get('location'), /^\/listings\?area=Osu&max=4000&beds=2&amenity=borehole&ok=Search%20saved/);
  r = await kojo.post('/saved-searches', form);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_searches').get().n, 1);

  assert.match((await kojo.get('/listings?area=Osu&max=4000&beds=2&amenity=borehole')).text, /Saved · manage/);
  const dash = await kojo.get('/dashboard');
  assert.match(dash.text, /2\+ bed homes in Osu, up to GH₵ 4,000\/month, with borehole/);
});

test('new matching listings are emailed once; non-matching and older ones are not', async () => {
  addListing({ title: 'Old flat already listed' }); // published before the search existed
  backdateSearches();
  db.prepare("UPDATE listings SET published_at = datetime('now', '-2 hours')").run();
  const match = addListing({ title: 'Bright 2-bed in Osu' });
  addListing({ title: 'Too expensive', rent: 9000 });
  addListing({ title: 'Wrong area', area: 'Madina' });
  addListing({ title: 'No borehole', amenities: 'ac' });
  addListing({ title: 'Pending review', status: 'pending' });

  await run(new Date(Date.now() + 2000));
  const [m] = alertsTo('kojo@test.gh');
  assert.ok(m, 'alert emailed');
  assert.equal(m.subject, '1 new home for "2+ bed homes in Osu, up to GH₵ 4,000/month, with borehole /…"', 'long names are shortened');
  assert.match(m.text, /your saved search: 2\+ bed homes in Osu, up to GH₵ 4,000\/month, with borehole \/ poly tank\n/);
  assert.match(m.text, /Bright 2-bed in Osu\n  GH₵ 3,000\/month · Osu · 2 bed · 6 months advance\n  https?:\/\/\S+\/listings\/\d+/);
  for (const t of ['Old flat', 'Too expensive', 'Wrong area', 'No borehole', 'Pending review']) assert.doesNotMatch(m.text, new RegExp(t));
  assert.match(m.text, /Stop alerts for this search: https?:\/\/\S+\/saved-searches\/stop\?token=[\w-]+/);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Next run: nothing new, nothing sent.
  await run(new Date(Date.now() + 4000));
  assert.equal(alertsTo('kojo@test.gh').length, 1);

  // Relisted after being rented: already sent, so not sent again.
  db.prepare("UPDATE listings SET status = 'rented' WHERE id = ?").run(match);
  db.prepare("UPDATE listings SET status = 'active' WHERE id = ?").run(match);
  backdateSearches();
  await run(new Date(Date.now() + 6000));
  assert.equal(alertsTo('kojo@test.gh').length, 1);
});

test('landlords are not alerted about their own listings', async () => {
  const ama = client();
  await ama.login('ama@test.gh');
  await ama.post('/saved-searches', { _csrf: await ama.csrf('/listings'), area: 'Osu', frequency: 'instant', alert_email: '1' });
  backdateSearches();
  addListing({ title: 'Ama own listing' });
  await run(new Date(Date.now() + 2000));
  assert.equal(alertsTo('ama@test.gh').length, 0);
  assert.match(alertsTo('kojo@test.gh').at(-1).text, /Ama own listing/, 'other people still get it');
  db.prepare("DELETE FROM saved_searches WHERE user_id = ?").run(landlordId);
});

// Fixed clock times on tomorrow's date, so they're always after the listings were published.
function tomorrowAt(hour, minute = 0) {
  const d = new Date(Date.now() + 864e5);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

test('daily searches send one digest after 7am GMT', async () => {
  const s = db.prepare('SELECT id FROM saved_searches').get().id;
  await kojo.post(`/saved-searches/${s}/frequency`, { _csrf: kcsrf, frequency: 'daily', alert_email: '1' });
  db.prepare('UPDATE saved_searches SET last_sent_at = NULL').run(); // no digest sent yet
  backdateSearches();
  addListing({ title: 'Digest one' });
  addListing({ title: 'Digest two' });
  const before = alertsTo('kojo@test.gh').length;

  await run(tomorrowAt(6, 30));
  assert.equal(alertsTo('kojo@test.gh').length, before, 'not before 7am');

  await run(tomorrowAt(9));
  assert.equal(alertsTo('kojo@test.gh').length, before + 1);
  const m = alertsTo('kojo@test.gh').at(-1);
  assert.match(m.subject, /^2 new homes for/);
  assert.match(m.text, /Digest one/);
  assert.match(m.text, /Digest two/);

  addListing({ title: 'Digest three' });
  await run(tomorrowAt(15));
  assert.equal(alertsTo('kojo@test.gh').length, before + 1, 'only one digest per day');
});

test('the stop link turns alerts off for that search; turning back on skips the backlog', async () => {
  const s = db.prepare('SELECT * FROM saved_searches').get();
  db.prepare("UPDATE saved_searches SET frequency = 'instant' WHERE id = ?").run(s.id);
  let r = await client().get(`/saved-searches/stop?token=${s.token}`);
  assert.match(r.text, /Stop emails about new homes for <strong>2\+ bed homes in Osu/);
  assert.equal(db.prepare('SELECT frequency FROM saved_searches WHERE id = ?').get(s.id).frequency, 'instant', 'GET changes nothing');
  r = await client().post(`/saved-searches/stop?token=${s.token}`, { 'List-Unsubscribe': 'One-Click' });
  assert.equal(db.prepare('SELECT frequency FROM saved_searches WHERE id = ?').get(s.id).frequency, 'off');

  backdateSearches();
  addListing({ title: 'Listed while off' });
  const before = alertsTo('kojo@test.gh').length;
  await run(new Date(Date.now() + 2000));
  assert.equal(alertsTo('kojo@test.gh').length, before);

  await kojo.post(`/saved-searches/${s.id}/frequency`, { _csrf: kcsrf, frequency: 'instant', alert_email: '1' });
  await run(new Date(Date.now() + 4000));
  assert.equal(alertsTo('kojo@test.gh').length, before, 'backlog from while it was off is not sent');
});

test('users with emails switched off get no alerts and no backlog later', async () => {
  db.prepare("UPDATE users SET email_alerts = 0 WHERE email = 'kojo@test.gh'").run();
  backdateSearches();
  addListing({ title: 'While emails off' });
  const before = alertsTo('kojo@test.gh').length;
  await run(new Date(Date.now() + 2000));
  db.prepare("UPDATE users SET email_alerts = 1 WHERE email = 'kojo@test.gh'").run();
  await run(new Date(Date.now() + 4000));
  assert.equal(alertsTo('kojo@test.gh').length, before);
});

test('people can delete saved searches, only their own, and are limited to 10', async () => {
  const ama = client();
  await ama.login('ama@test.gh');
  const s = db.prepare('SELECT id FROM saved_searches').get().id;
  await ama.post(`/saved-searches/${s}/delete`, { _csrf: await ama.csrf('/dashboard') });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_searches WHERE id = ?').get(s).n, 1, "can't delete someone else's");

  await kojo.post(`/saved-searches/${s}/delete`, { _csrf: kcsrf });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_searches').get().n, 0);

  for (let i = 1; i <= 10; i++) await kojo.post('/saved-searches', { _csrf: kcsrf, max: String(i * 1000), alert_email: '1' });
  const r = await kojo.post('/saved-searches', { _csrf: kcsrf, max: '99000', alert_email: '1' });
  assert.match(decodeURIComponent(r.headers.get('location')), /You can save up to 10 searches/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_searches').get().n, 10);
});
