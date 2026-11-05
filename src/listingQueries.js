const { PROPERTY_TYPES, FURNISHING } = require('./constants');
const config = require('./config');

const PAGE_SIZE = 12;

const SORTS = {
  newest: 'l.created_at DESC, l.id DESC',
  price_asc: 'l.rent_ghs ASC, l.id DESC',
  price_desc: 'l.rent_ghs DESC, l.id DESC',
  upfront_asc: '(l.rent_ghs * l.advance_months) ASC, l.id DESC',
};

const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function listingCards(db) {
  const COLUMNS = `l.*, u.name landlord_name, u.verification_status landlord_verification,
    (SELECT filename FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position, id LIMIT 1) cover,
    (SELECT COUNT(*) FROM listing_photos p WHERE p.listing_id = l.id) photo_count`;

  // Builds a parameterised search over active listings from untrusted query-string filters.
  // opts (trusted, internal only): publishedAfter, publishedUntil, excludeLandlord.
  function search(q = {}, opts = {}) {
    const where = ["l.status = 'active'", 'u.suspended = 0'];
    const params = {};
    if (opts.publishedAfter) { where.push('l.published_at > @publishedAfter'); params.publishedAfter = opts.publishedAfter; }
    if (opts.publishedUntil) { where.push('l.published_at <= @publishedUntil'); params.publishedUntil = opts.publishedUntil; }
    if (opts.excludeLandlord) { where.push('l.landlord_id != @excludeLandlord'); params.excludeLandlord = opts.excludeLandlord; }
    if (q.area) { where.push('l.neighbourhood = @area'); params.area = String(q.area); }
    if (q.type && PROPERTY_TYPES[q.type]) { where.push('l.property_type = @type'); params.type = q.type; }
    if (q.furnishing && FURNISHING[q.furnishing]) { where.push('l.furnishing = @furn'); params.furn = q.furnishing; }
    if (int(q.min) !== null) { where.push('l.rent_ghs >= @min'); params.min = int(q.min); }
    if (int(q.max)) { where.push('l.rent_ghs <= @max'); params.max = int(q.max); }
    if (int(q.beds)) { where.push('l.bedrooms >= @beds'); params.beds = int(q.beds); }
    if (q.legal === '1') { where.push('l.advance_months <= @legal'); params.legal = config.legalAdvanceMonths; }
    if (q.verified === '1') where.push("u.verification_status = 'verified'");
    if (q.amenity) {
      const list = [].concat(q.amenity).slice(0, 10);
      list.forEach((a, i) => {
        where.push(`(',' || l.amenities || ',') LIKE @am${i}`);
        params[`am${i}`] = `%,${String(a).replace(/[%_,]/g, '')},%`;
      });
    }
    if (q.q) {
      where.push('(l.title LIKE @kw OR l.description LIKE @kw OR l.neighbourhood LIKE @kw OR l.address LIKE @kw)');
      params.kw = `%${String(q.q).slice(0, 80).replace(/[%_]/g, '')}%`;
    }
    const order = SORTS[q.sort] || SORTS.newest;
    const limit = Math.min(int(q.limit) || PAGE_SIZE, 48);
    const page = Math.max(int(q.page) || 1, 1);
    const base = `FROM listings l JOIN users u ON u.id = l.landlord_id WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(params).n;
    const rows = db.prepare(`SELECT ${COLUMNS} ${base} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(params);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  const byLandlordStmt = db.prepare(`SELECT ${COLUMNS} FROM listings l JOIN users u ON u.id = l.landlord_id
    WHERE l.landlord_id = ? ORDER BY l.updated_at DESC`);
  const favoritesStmt = db.prepare(`SELECT ${COLUMNS} FROM favorites f JOIN listings l ON l.id = f.listing_id
    JOIN users u ON u.id = l.landlord_id WHERE f.user_id = ? ORDER BY f.created_at DESC`);
  const pendingStmt = db.prepare(`SELECT ${COLUMNS} FROM listings l JOIN users u ON u.id = l.landlord_id
    WHERE l.status = 'pending' ORDER BY l.created_at`);

  return {
    search,
    byLandlord: (id) => byLandlordStmt.all(id),
    favorites: (id) => favoritesStmt.all(id),
    pending: () => pendingStmt.all(),
  };
}

module.exports = { listingCards, SORTS, PAGE_SIZE };
