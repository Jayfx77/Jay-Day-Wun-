// SMS reminders for confirmed viewings.
process.env.NODE_ENV = 'test';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { shortViewingTime } = require('../src/helpers');
const { runViewingReminders } = require('../src/jobs/viewingReminders');

let db, app, listing, tenant, landlord;
const DAY = '2030-03-10'; // a Sunday
const t = (date, hhmm) => new Date(`${date}T${hhmm}:00Z`);
const run = (now) => runViewingReminders(db, app.locals.ctx, now);
const reminders = (phone) => db.prepare("SELECT body FROM sms_log WHERE kind = 'viewing_reminder' AND phone = ? ORDER BY id").all(phone).map((r) => r.body);
const TENANT = '233271000004';
const LANDLORD = '233241000001';

before(() => {
  db = open(':memory:');
  app = createApp(db);
  const add = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status, phone_verified)
    VALUES (?, ?, ?, ?, ?, 'verified', 1)`);
  const pw = hashPassword('password123');
  landlord = add.run('Ama Owusu', 'ama@test.gh', LANDLORD, pw, 'landlord').lastInsertRowid;
  tenant = add.run('Kojo Mensah', 'kojo@test.gh', TENANT, pw, 'tenant').lastInsertRowid;
  listing = db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, gps_address,
    bedrooms, bathrooms, rent_ghs, advance_months, furnishing, status) VALUES (?, '2-bed flat in Osu',
    'A bright flat close to Oxford Street with reliable water.', 'apartment', 'Osu', 'Oxford St', 'GA-019-8765', 2, 1, 3000, 6, 'semi', 'active')`)
    .run(landlord).lastInsertRowid;
});

function viewing({ date = DAY, time = 'afternoon', status = 'confirmed' } = {}) {
  db.prepare('DELETE FROM sms_log').run();
  return db.prepare('INSERT INTO viewings (listing_id, tenant_id, preferred_date, preferred_time, status) VALUES (?, ?, ?, ?, ?)')
    .run(listing, tenant, date, time, status).lastInsertRowid;
}
const clear = (id) => db.prepare("UPDATE viewings SET status = 'cancelled' WHERE id = ?").run(id);

test('short viewing times read naturally', () => {
  assert.equal(shortViewingTime('2030-03-10', 'afternoon'), 'Sun 10 Mar, 12-4pm');
  assert.equal(shortViewingTime('2030-03-11', 'morning'), 'Mon 11 Mar, 8am-12pm');
});

// Characters outside the GSM 7-bit SMS alphabet (basic set and extension table).
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€';
const nonGsm = (s) => [...s].filter((c) => !GSM.includes(c));

test('the evening before: one reminder each to tenant and landlord, from 6pm', () => {
  const id = viewing();
  assert.equal(run(t('2030-03-09', '17:50')).sent, 0, 'not before 6pm');
  assert.equal(run(t('2030-03-09', '18:05')).sent, 1);
  assert.equal(run(t('2030-03-09', '21:00')).sent, 0, 'not twice');

  const [toTenant] = reminders(TENANT);
  assert.match(toTenant, /^Ofie Accra reminder: viewing tomorrow \(Sun 10 Mar, 12-4pm\) at "2-bed flat in Osu", Oxford St, Osu \(GA-019-8765\)\. Landlord: Ama Owusu 024 100 0001\. Can't make it\? Cancel: https?:\/\/\S+\/dashboard$/);
  const [toLandlord] = reminders(LANDLORD);
  assert.match(toLandlord, /^Ofie Accra reminder: Kojo Mensah \(027 100 0004\) is viewing "2-bed flat in Osu" tomorrow \(Sun 10 Mar, 12-4pm\)\. Need to cancel\? https?:\/\/\S+\/dashboard$/);
  // Plain SMS characters only, and short enough for at most 2 SMS segments (306 chars).
  for (const body of [toTenant, toLandlord]) {
    assert.deepEqual(nonGsm(body), [], 'no characters that force Unicode SMS');
    assert.ok(body.length <= 306, `${body.length} chars`);
  }
  clear(id);
});

test('on the day: 2 hours before the window, with a safety tip for the tenant', () => {
  const id = viewing();
  run(t('2030-03-09', '18:30')); // evening-before reminder
  assert.equal(run(t(DAY, '09:55')).sent, 0, 'afternoon window starts 12pm, so not before 10am');
  assert.equal(run(t(DAY, '10:00')).sent, 1);
  assert.equal(run(t(DAY, '11:00')).sent, 0, 'not twice');
  const tenantTexts = reminders(TENANT);
  assert.equal(tenantTexts.length, 2);
  assert.match(tenantTexts[1], /viewing today \(Sun 10 Mar, 12-4pm\).*Call ahead to agree the exact time\. Never pay before viewing\./);
  assert.match(reminders(LANDLORD)[1], /is viewing "2-bed flat in Osu" today/);
  clear(id);
});

test('morning viewings are reminded at 7am, not 6am', () => {
  const id = viewing({ time: 'morning' });
  db.prepare('UPDATE viewings SET reminded_day_before = ? WHERE id = ?').run('x', id);
  assert.equal(run(t(DAY, '06:30')).sent, 0);
  assert.equal(run(t(DAY, '07:00')).sent, 1);
  clear(id);
});

test('confirmed on the day: only the "today" reminder, no late "tomorrow" one', () => {
  const id = viewing({ time: 'evening' });
  assert.equal(run(t(DAY, '13:00')).sent, 0, 'evening window: from 2pm');
  assert.equal(run(t(DAY, '14:10')).sent, 1);
  assert.equal(reminders(TENANT).length, 1);
  assert.match(reminders(TENANT)[0], /viewing today/);
  clear(id);
});

test('no reminder once the time window is over', () => {
  const id = viewing({ time: 'morning' });
  assert.equal(run(t(DAY, '12:30')).sent, 0);
  assert.ok(db.prepare('SELECT reminded_day_of FROM viewings WHERE id = ?').get(id).reminded_day_of, 'marked so it is never sent late');
  clear(id);
});

test('requested, declined and cancelled viewings get no reminders', () => {
  for (const status of ['requested', 'declined', 'cancelled']) {
    const id = viewing({ status });
    assert.equal(run(t('2030-03-09', '19:00')).sent, 0, status);
    assert.equal(run(t(DAY, '11:00')).sent, 0, status);
    clear(id);
  }
});

test('a viewing cancelled after the first reminder gets no second one', () => {
  const id = viewing();
  run(t('2030-03-09', '18:30'));
  db.prepare("UPDATE viewings SET status = 'cancelled' WHERE id = ?").run(id);
  assert.equal(run(t(DAY, '10:30')).sent, 0);
  assert.equal(reminders(TENANT).length, 1);
});

test('no reminders if the listing is no longer live', () => {
  const id = viewing();
  db.prepare("UPDATE listings SET status = 'rented' WHERE id = ?").run(listing);
  assert.equal(run(t('2030-03-09', '19:00')).sent, 0);
  db.prepare("UPDATE listings SET status = 'active' WHERE id = ?").run(listing);
  clear(id);
});

test('people who turned SMS alerts off are not texted; the other person still is', () => {
  const id = viewing();
  db.prepare('UPDATE users SET sms_alerts = 0 WHERE id = ?').run(landlord);
  run(t('2030-03-09', '18:30'));
  assert.equal(reminders(LANDLORD).length, 0);
  assert.equal(reminders(TENANT).length, 1);
  db.prepare('UPDATE users SET sms_alerts = 1 WHERE id = ?').run(landlord);
  clear(id);
});
