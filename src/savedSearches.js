// Saved searches: normalising filters, describing them in plain words, and finding new matches.
const crypto = require('crypto');
const { PROPERTY_TYPES, FURNISHING, AMENITIES, NEIGHBOURHOODS } = require('./constants');
const config = require('./config');

const MAX_PER_USER = 10;
const cedis = (n) => `GH₵ ${Number(n).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
const posInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

// Keeps only known filters with valid values, in a fixed order, so equal searches compare equal.
function normalise(q = {}) {
  const out = {};
  if (q.area && NEIGHBOURHOODS.includes(q.area)) out.area = q.area;
  if (q.type && PROPERTY_TYPES[q.type]) out.type = q.type;
  if (q.furnishing && FURNISHING[q.furnishing]) out.furnishing = q.furnishing;
  if (posInt(q.min)) out.min = String(posInt(q.min));
  if (posInt(q.max)) out.max = String(posInt(q.max));
  if (posInt(q.beds)) out.beds = String(Math.min(posInt(q.beds), 20));
  if (q.legal === '1') out.legal = '1';
  if (q.verified === '1') out.verified = '1';
  const amenity = [...new Set([].concat(q.amenity || []).filter((a) => AMENITIES[a]))].sort();
  if (amenity.length) out.amenity = amenity;
  const kw = String(q.q || '').trim().slice(0, 80);
  if (kw) out.q = kw;
  return out;
}

// "2+ bed apartment in East Legon, up to GH₵ 5,000/month, furnished, with borehole"
function describe(q) {
  const parts = [];
  let head = q.type ? PROPERTY_TYPES[q.type] : 'Homes';
  if (q.beds) head = `${q.beds}+ bed ${q.type ? PROPERTY_TYPES[q.type].toLowerCase() : 'homes'}`;
  head += q.area ? ` in ${q.area}` : ' anywhere in Accra';
  parts.push(head);
  if (q.min && q.max) parts.push(`${cedis(q.min)}–${cedis(q.max)}/month`);
  else if (q.max) parts.push(`up to ${cedis(q.max)}/month`);
  else if (q.min) parts.push(`from ${cedis(q.min)}/month`);
  if (q.furnishing) parts.push(FURNISHING[q.furnishing].toLowerCase());
  if (q.legal) parts.push(`max ${config.legalAdvanceMonths} months advance`);
  if (q.verified) parts.push('verified landlords');
  if (q.amenity) parts.push(`with ${q.amenity.map((a) => AMENITIES[a].toLowerCase()).join(', ')}`);
  if (q.q) parts.push(`matching “${q.q}”`);
  return parts.join(', ');
}

function toQueryString(q) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) [].concat(v).forEach((x) => u.append(k, x));
  return u.toString();
}

function createSavedSearches(db) {
  const list = (userId) => db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC').all(userId)
    .map((s) => ({ ...s, filters: JSON.parse(s.query) }))
    .map((s) => ({ ...s, description: describe(s.filters), url: `/listings?${toQueryString(s.filters)}` }));

  // Returns { ok, error?, id? }.
  // channels: { email: bool, sms: bool }
  function save(userId, rawQuery, frequency = 'instant', channels = { email: true, sms: false }) {
    const filters = normalise(rawQuery);
    const query = JSON.stringify(filters);
    const email = channels.email ? 1 : 0;
    const sms = channels.sms ? 1 : 0;
    const existing = db.prepare('SELECT id FROM saved_searches WHERE user_id = ? AND query = ?').get(userId, query);
    if (existing) {
      db.prepare('UPDATE saved_searches SET frequency = ?, email = ?, sms = ? WHERE id = ?').run(frequency, email, sms, existing.id);
      return { ok: true, id: existing.id, existed: true };
    }
    const count = db.prepare('SELECT COUNT(*) n FROM saved_searches WHERE user_id = ?').get(userId).n;
    if (count >= MAX_PER_USER) return { ok: false, error: `You can save up to ${MAX_PER_USER} searches. Delete one on your dashboard first.` };
    const id = db.prepare('INSERT INTO saved_searches (user_id, query, frequency, token, email, sms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, query, frequency, crypto.randomBytes(24).toString('base64url'), email, sms).lastInsertRowid;
    return { ok: true, id };
  }

  return { list, save, MAX_PER_USER };
}

module.exports = { createSavedSearches, normalise, describe, toQueryString };
