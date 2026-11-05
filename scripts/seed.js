// Demo data for local development ONLY. Do not run against a production database.
// Usage: npm run seed            (all demo accounts use the password "demo-password")
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const config = require('../src/config');
const { hashPassword } = require('../src/auth');

if (config.isProd && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo data in production (pass --force to override).');
  process.exit(1);
}

// Minimal PNG encoder so the seed has no image dependencies: draws a simple house illustration.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function housePng(seed, w = 480, h = 360) {
  const rnd = (i) => (crypto.createHash('md5').update(`${seed}-${i}`).digest()[0]);
  const wall = [230 - rnd(1) % 60, 200 - rnd(2) % 60, 160 + rnd(3) % 60];
  const roof = [120 + rnd(4) % 80, 40 + rnd(5) % 40, 30 + rnd(6) % 30];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let c;
      const groundY = h * 0.78;
      const hx0 = w * 0.22, hx1 = w * 0.78, hy0 = h * 0.42;
      const roofTop = h * 0.18, cx = w / 2;
      const inRoof = y >= roofTop && y < hy0 && Math.abs(x - cx) < ((y - roofTop) / (hy0 - roofTop)) * (w * 0.33);
      const inWall = x >= hx0 && x < hx1 && y >= hy0 && y < groundY;
      const inDoor = x >= cx - 22 && x < cx + 22 && y >= groundY - 80 && y < groundY;
      const inWin = (x >= hx0 + 30 && x < hx0 + 90 || x >= hx1 - 90 && x < hx1 - 30) && y >= hy0 + 30 && y < hy0 + 80;
      if (inDoor) c = [90, 55, 30];
      else if (inWin) c = [150, 200, 230];
      else if (inWall) c = wall;
      else if (inRoof) c = roof;
      else if (y >= groundY) c = [70, 140 - (y - groundY) * 0.3, 60];
      else c = [140 + y * 0.25, 190 + y * 0.12, 240];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const db = require('../src/db').open();
const pw = hashPassword('demo-password');
const addUser = (name, email, phone, role, verification = 'unverified') => {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (row) return row.id;
  return db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, verification_status)
    VALUES (?, ?, ?, ?, ?, ?)`).run(name, email, phone, pw, role, verification).lastInsertRowid;
};

addUser('Demo Admin', 'admin@demo.local', '233200000001', 'admin', 'verified');
const ama = addUser('Ama Owusu', 'ama@demo.local', '233241000001', 'landlord', 'verified');
const kofi = addUser('Kofi Mensah', 'kofi@demo.local', '233201000002', 'landlord', 'verified');
const yaw = addUser('Yaw Boateng', 'yaw@demo.local', '233551000003', 'landlord', 'unverified');
addUser('Esi Tenant', 'esi@demo.local', '233271000004', 'tenant');

const listings = [
  [ama, 'Spacious 2-bedroom apartment off Spintex Road', 'apartment', 'Spintex', 'Behind Coca-Cola roundabout, Baatsona', 'GT-345-6789', 2, 2, 3500, 6, 'semi', 'water_reliable,prepaid_meter,security,parking,wardrobe,kitchen,porch', 'active'],
  [ama, 'Self-contained single room with porch, Madina Zongo Junction', 'self_contained', 'Madina', '5 mins walk from Zongo Junction', 'GM-071-2345', 1, 1, 900, 6, 'unfurnished', 'borehole,prepaid_meter,porch,kitchen', 'active'],
  [kofi, 'Executive 3-bedroom townhouse in East Legon with pool', 'townhouse', 'East Legon', 'Off American House road', 'GA-412-1122', 3, 4, 15000, 6, 'furnished', 'water_reliable,generator,ac,security,parking,pool,gym,internet,wardrobe', 'active'],
  [kofi, 'Chamber & hall self-contained, Dansoman Last Stop', 'chamber_hall', 'Dansoman', 'Near Dansoman Last Stop police station', null, 1, 1, 1200, 12, 'unfurnished', 'prepaid_meter,kitchen', 'active'],
  [kofi, 'Furnished studio near Osu Oxford Street', 'studio', 'Osu', '2 streets from Oxford Street, near Danquah Circle', 'GA-019-8765', 1, 1, 4200, 3, 'furnished', 'ac,internet,security,water_reliable,generator', 'active'],
  [ama, 'Newly built 1-bedroom apartment in Adenta Housing Down', 'apartment', 'Adenta', 'Adenta Housing Down, near SDA church', null, 1, 1, 1800, 6, 'unfurnished', 'borehole,prepaid_meter,security,wardrobe,kitchen', 'active'],
  [kofi, '4-bedroom detached house with boys quarters, Tema Community 25', 'house', 'Tema Community 25', 'Devtraco Estates', 'GT-201-3344', 4, 4, 6500, 6, 'unfurnished', 'water_reliable,security,parking,porch,generator,pets', 'active'],
  [yaw, 'Single room in compound house, Kasoa Old Barrier', 'single_room', 'Kasoa', 'Old Barrier, behind the market', null, 0, 1, 450, 12, 'unfurnished', 'borehole', 'pending'],
];

const insert = db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address, gps_address,
  bedrooms, bathrooms, rent_ghs, advance_months, furnishing, amenities, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
fs.mkdirSync(config.uploadDir, { recursive: true });

if (db.prepare('SELECT COUNT(*) n FROM listings').get().n === 0) {
  listings.forEach((l, i) => {
    const [landlord, title, type, area, address, gps, beds, baths, rent, adv, furn, amen, status] = l;
    const desc = `${title}. Located in a quiet, accessible part of ${area} (${address}). `
      + 'Clean, well-maintained compound with friendly neighbours. Water and electricity are reliable. '
      + 'Contact me directly to arrange a viewing — no agents, no viewing fees.\n\n'
      + 'DEMO LISTING — this is sample data for testing the platform.';
    const id = insert.run(landlord, title, desc, type, area, address, gps, beds, baths, rent, adv, furn, amen, status).lastInsertRowid;
    for (let p = 0; p < 3; p++) {
      const name = `${crypto.randomBytes(16).toString('hex')}.png`;
      fs.writeFileSync(path.join(config.uploadDir, name), housePng(`${i}-${p}`));
      db.prepare('INSERT INTO listing_photos (listing_id, filename, position) VALUES (?, ?, ?)').run(id, name, p);
    }
  });
  console.log(`Seeded ${listings.length} demo listings.`);
} else {
  console.log('Listings already exist; skipped listing seed.');
}
console.log('Demo logins (password "demo-password"): admin@demo.local, ama@demo.local (landlord), esi@demo.local (tenant)');
db.close();
