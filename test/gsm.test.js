// Texts use only plain SMS (GSM) characters, so they're billed at the cheaper rate.
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toGsm, isGsm } = require('../src/gsm');
const { open } = require('../src/db');
const { createSms } = require('../src/sms');
const { createNotifier } = require('../src/notify');
const { hashPassword } = require('../src/auth');

test('the cedi sign becomes GHS', () => {
  assert.equal(toGsm('GH₵ 3,500/mo'), 'GHS 3,500/mo');
  assert.equal(toGsm('GH₵3,500'), 'GHS 3,500');
  assert.equal(toGsm('₵ 900'), 'GHS 900');
});

test('typographic punctuation becomes plain', () => {
  assert.equal(toGsm('GH₵ 2,000–GH₵ 4,000'), 'GHS 2,000-GHS 4,000');
  assert.equal(toGsm('matching “near mall”'), 'matching "near mall"');
  assert.equal(toGsm('Ama’s flat…'), "Ama's flat...");
  assert.equal(toGsm('Osu · 2 bed'), 'Osu - 2 bed');
});

test('Twi letters and accents are simplified; emoji are dropped', () => {
  assert.equal(toGsm('Kwamɛ Ɔwusu'), 'Kwame Owusu');
  assert.equal(toGsm('Adɔma'), 'Adoma');
  assert.equal(toGsm('Kôfi Ânsah'), 'Kofi Ansah');
  assert.equal(toGsm('Great place 😀👍 ✔'), 'Great place');
});

test('characters GSM already has are kept', () => {
  assert.equal(toGsm('Café, déjà vu, £5, €10, [ok]'), 'Café, déjà vu, £5, €10, [ok]');
  assert.ok(isGsm(toGsm('Hello\nWorld')));
});

test('every kind of text is converted before sending and logging', async () => {
  const db = open(':memory:');
  const sms = createSms(db);
  const notify = createNotifier(db, sms);
  const pw = hashPassword('password123');
  const add = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES (?, ?, ?, ?, ?, 'verified', 1)`);
  const ama = add.run('Ama Ɔwusu ✨', 'ama@test.gh', '233241000001', pw, 'landlord').lastInsertRowid;
  const kojo = add.run('Kwamɛ “Kojo” Mensah', 'kojo@test.gh', '233271000004', pw, 'tenant').lastInsertRowid;
  const listing = db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, bedrooms,
    bathrooms, rent_ghs, advance_months, furnishing, status) VALUES (?, 'Lovely flat — near the mall 🏠 with a very long title that goes on',
    'A bright flat close to shops with reliable water.', 'apartment', 'Osu', 'Oxford St', 2, 1, 3500, 6, 'semi', 'active')`).run(ama).lastInsertRowid;
  const viewing = db.prepare(`INSERT INTO viewings (listing_id, tenant_id, preferred_date, preferred_time, status)
    VALUES (?, ?, '2030-03-10', 'afternoon', 'confirmed')`).run(listing, kojo).lastInsertRowid;

  notify.newMessage({ conversationId: 1, recipientId: ama, senderName: 'Kwamɛ “Kojo”', listingTitle: 'Lovely flat — near the mall', body: 'Is it free? 🙏 I’m keen…' });
  notify.viewingRequested({ viewingId: viewing });
  notify.viewingStatus({ viewingId: viewing, status: 'confirmed', byUserId: ama });
  notify.viewingReminder({ viewingId: viewing, when: 'tomorrow' });
  notify.listingModerated({ landlordId: ama, listingId: listing, listingTitle: 'Lovely flat — near the mall', action: 'reject', note: 'Photos look “borrowed”…' });
  notify.verificationResult({ userId: ama, status: 'rejected', note: 'Blurry ✗' });
  notify.passwordChanged({ userId: kojo, method: 'account' });
  notify.savedSearchMatches({
    search: { id: 1, user_id: kojo, token: 't' }, description: '2+ bed homes in Osu, GH₵ 2,000–GH₵ 4,000/month',
    listings: [{ id: listing, rent_ghs: 3500, bedrooms: 2, neighbourhood: 'Osu' }], total: 1, searchPath: '/listings?area=Osu',
    channels: { email: false, sms: true },
  });
  await sms.flush();

  const rows = db.prepare('SELECT kind, body FROM sms_log').all();
  assert.equal(rows.length, 9);
  for (const r of rows) assert.ok(isGsm(r.body), `${r.kind}: ${r.body}`);
  assert.match(rows.find((r) => r.kind === 'saved_search').body, /GHS 3,500\/mo/);
  assert.match(rows.find((r) => r.kind === 'viewing_reminder').body, /Landlord: Ama Owusu/);
});
