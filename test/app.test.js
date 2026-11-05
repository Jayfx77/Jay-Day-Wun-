// End-to-end tests over HTTP against an in-memory database.
process.env.NODE_ENV = 'test';
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ofie-test-'));
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.PRIVATE_DIR = path.join(tmp, 'private');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { upsertAdmin } = require('../scripts/create-admin');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
  '53de0000000c4944415408d763f8cfc000000301010018dd8db40000000049454e44ae426082', 'hex');

let server, base, db;

before(async () => {
  db = open(':memory:');
  upsertAdmin(db, { name: 'Admin', email: 'admin@test.gh', phone: '0200000000', password: 'admin-password-123' });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Tiny cookie-keeping client.
function client() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(method, url, body) {
    const headers = { cookie: cookieHeader() };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    }
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
    async csrf(u = '/') {
      const r = await req('GET', u);
      const m = r.text.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(m, `no csrf token on ${u}`);
      return m[1];
    },
  };
}

async function register(c, role, email) {
  const _csrf = await c.csrf('/register');
  const r = await c.post('/register', {
    _csrf, role, name: `Test ${role}`, email, phone: '024 123 4567', password: 'password123', password2: 'password123', agree: '1', whatsapp: '1',
  });
  assert.equal(r.status, 302, r.text.slice(0, 500));
  return r;
}

function listingForm(csrf, extra = {}) {
  const fd = new FormData();
  const fields = {
    _csrf: csrf, title: 'Lovely 2 bedroom flat in Osu', description: 'A bright, airy flat close to Oxford Street with reliable water and power.',
    property_type: 'apartment', neighbourhood: 'Osu', address: 'Near Danquah Circle', gps_address: 'GA-019-8765',
    bedrooms: '2', bathrooms: '1', rent_ghs: '3000', advance_months: '6', furnishing: 'semi', owner_confirm: '1', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('amenities', 'borehole');
  fd.append('amenities', 'security');
  fd.append('photos', new Blob([PNG], { type: 'image/png' }), 'room.png');
  return fd;
}

test('public pages render', async () => {
  const c = client();
  for (const u of ['/', '/listings', '/how-it-works', '/safety', '/terms', '/login', '/register']) {
    const r = await c.get(u);
    assert.equal(r.status, 200, u);
  }
  assert.equal((await c.get('/nope')).status, 404);
  assert.equal((await c.get('/healthz')).status, 200);
});

test('forms reject requests without a CSRF token', async () => {
  const c = client();
  const r = await c.post('/login', { email: 'x@y.z', password: 'x' });
  assert.equal(r.status, 403);
});

test('registration validates input', async () => {
  const c = client();
  const _csrf = await c.csrf('/register');
  const r = await c.post('/register', { _csrf, role: 'tenant', name: 'A', email: 'bad', phone: '123', password: 'x', password2: 'y' });
  assert.equal(r.status, 400);
  assert.match(r.text, /valid Ghanaian mobile number/);
});

test('full landlord → admin → tenant flow', async () => {
  const landlord = client();
  await register(landlord, 'landlord', 'landlord@test.gh');

  // Tenants cannot create listings.
  const tenant = client();
  await register(tenant, 'tenant', 'tenant@test.gh');
  assert.equal((await tenant.get('/listings/new')).status, 403);

  // Unverified landlord listing goes to review.
  const csrf = await landlord.csrf('/listings/new');
  let r = await landlord.post('/listings', listingForm(csrf));
  assert.equal(r.status, 302, r.text.slice(0, 800));
  const listingUrl = r.headers.get('location').split('?')[0];
  const id = listingUrl.split('/').pop();
  assert.equal(db.prepare('SELECT status FROM listings WHERE id = ?').get(id).status, 'pending');
  assert.equal((await tenant.get(listingUrl)).status, 404, 'pending listing hidden from public');
  assert.equal((await landlord.get(listingUrl)).status, 200, 'owner can preview');

  // Non-image upload is rejected.
  const bad = listingForm(csrf);
  bad.set('photos', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  r = await landlord.post('/listings', bad);
  assert.equal(r.status, 400);

  // Landlord submits Ghana Card verification.
  const acsrf = await landlord.csrf('/account');
  const vf = new FormData();
  vf.append('_csrf', acsrf);
  vf.append('ghana_card_number', 'GHA-123456789-0');
  vf.append('ghana_card', new Blob([PNG], { type: 'image/png' }), 'card.png');
  r = await landlord.post('/account/verification', vf);
  assert.equal(r.status, 302, r.text.slice(0, 800));
  const landlordId = db.prepare("SELECT id FROM users WHERE email = 'landlord@test.gh'").get().id;
  assert.equal((await tenant.get(`/admin/users/${landlordId}/ghana-card`)).status, 403, 'card not visible to others');

  // Admin verifies → pending listing goes live.
  const admin = client();
  let lcsrf = await admin.csrf('/login');
  r = await admin.post('/login', { _csrf: lcsrf, email: 'admin@test.gh', password: 'admin-password-123' });
  assert.equal(r.headers.get('location'), '/admin');
  const adminPage = await admin.get('/admin');
  assert.match(adminPage.text, /GHA-123456789-0/);
  assert.equal((await admin.get(`/admin/users/${landlordId}/ghana-card`)).status, 200);
  const admCsrf = adminPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await admin.post(`/admin/users/${landlordId}/verification`, { _csrf: admCsrf, action: 'verify' });
  assert.equal(db.prepare('SELECT status FROM listings WHERE id = ?').get(id).status, 'active');

  // Search finds it with filters; excludes it with incompatible ones.
  r = await tenant.get('/listings?area=Osu&max=3500&beds=2&amenity=borehole&legal=1&verified=1');
  assert.match(r.text, /Lovely 2 bedroom flat in Osu/);
  r = await tenant.get('/listings?area=Osu&max=2000');
  assert.doesNotMatch(r.text, /Lovely 2 bedroom flat in Osu/);

  // Anonymous users don't see the landlord's phone.
  const anon = await client().get(listingUrl);
  assert.doesNotMatch(anon.text, /024 123 4567/);

  // Tenant sees phone, messages landlord, books viewing, saves listing.
  let page = await tenant.get(listingUrl);
  assert.match(page.text, /024 123 4567/);
  assert.match(page.text, /GH₵ 18,000/, 'shows total move-in cost');
  const tcsrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  r = await tenant.post(`${listingUrl}/contact`, { _csrf: tcsrf, body: 'Is it still available?' });
  const convUrl = r.headers.get('location');
  assert.match(convUrl, /^\/messages\/\d+$/);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  r = await tenant.post(`${listingUrl}/viewings`, { _csrf: tcsrf, date: tomorrow, time: 'morning' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Viewing requested/);
  await tenant.post(`${listingUrl}/favorite`, { _csrf: tcsrf });
  assert.match((await tenant.get('/dashboard')).text, /Lovely 2 bedroom flat in Osu/);

  // Landlord sees unread message, replies, and confirms the viewing.
  page = await landlord.get('/dashboard');
  assert.match(page.text, /class="pill">1</);
  const dcsrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const viewingId = db.prepare('SELECT id FROM viewings').get().id;
  await landlord.post(`/viewings/${viewingId}/status`, { _csrf: dcsrf, status: 'confirmed' });
  assert.equal(db.prepare('SELECT status FROM viewings WHERE id = ?').get(viewingId).status, 'confirmed');
  page = await landlord.get(convUrl);
  assert.match(page.text, /Is it still available\?/);
  await landlord.post(convUrl, { _csrf: dcsrf, body: 'Yes, come on Saturday.' });
  assert.match((await tenant.get(convUrl)).text, /come on Saturday/);

  // A stranger cannot read the conversation or edit the listing.
  const stranger = client();
  await register(stranger, 'landlord', 'stranger@test.gh');
  assert.equal((await stranger.get(convUrl)).status, 404);
  assert.equal((await stranger.get(`${listingUrl}/edit`)).status, 404);

  // Report → admin takedown hides listing.
  await tenant.post(`${listingUrl}/report`, { _csrf: tcsrf, reason: 'agent', details: 'Asked for agent fee' });
  assert.match((await admin.get('/admin')).text, /Asked for agent fee/);
  await admin.post(`/admin/listings/${id}/moderate`, { _csrf: admCsrf, action: 'takedown' });
  assert.equal((await tenant.get(listingUrl)).status, 404);
});

test('XSS in user content is escaped', async () => {
  const c = client();
  const _csrf = await c.csrf('/register');
  await c.post('/register', {
    _csrf, role: 'landlord', name: '<script>alert(1)</script>', email: 'xss@test.gh', phone: '0241112222',
    password: 'password123', password2: 'password123', agree: '1',
  });
  const r = await c.get('/dashboard');
  assert.doesNotMatch(r.text, /<script>alert\(1\)<\/script>/);
});

test('open redirect is blocked on login', async () => {
  const c = client();
  await register(c, 'tenant', 'redir@test.gh');
  await c.post('/logout', { _csrf: await c.csrf('/') });
  const _csrf = await c.csrf('/login');
  const r = await c.post('/login', { _csrf, email: 'redir@test.gh', password: 'password123', next: '//evil.com' });
  assert.equal(r.headers.get('location'), '/dashboard');
});
