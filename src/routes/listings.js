const express = require('express');
const config = require('../config');
const { PROPERTY_TYPES, FURNISHING, AMENITIES, NEIGHBOURHOODS, REPORT_REASONS } = require('../constants');
const { verifyCsrf, requireUser, requireRole } = require('../auth');
const { validGps } = require('../helpers');
const uploads = require('../uploads');
const { listingCards } = require('../listingQueries');

const clampInt = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : null;
};

function readListingForm(body) {
  const amenities = [].concat(body.amenities || []).filter((a) => AMENITIES[a]);
  const v = {
    title: String(body.title || '').trim().slice(0, 120),
    description: String(body.description || '').trim().slice(0, 5000),
    property_type: String(body.property_type || ''),
    neighbourhood: String(body.neighbourhood || ''),
    address: String(body.address || '').trim().slice(0, 200),
    gps_address: String(body.gps_address || '').trim().toUpperCase().slice(0, 20),
    bedrooms: clampInt(body.bedrooms, 0, 20),
    bathrooms: clampInt(body.bathrooms, 0, 20),
    rent_ghs: clampInt(String(body.rent_ghs || '').replace(/[,\s]/g, ''), 0, 10_000_000),
    advance_months: clampInt(body.advance_months, 0, 36),
    furnishing: String(body.furnishing || ''),
    amenities: amenities.join(','),
    available_from: /^\d{4}-\d{2}-\d{2}$/.test(body.available_from || '') ? body.available_from : null,
  };
  const errors = [];
  if (v.title.length < 10) errors.push('Give your listing a clear title (at least 10 characters).');
  if (v.description.length < 40) errors.push('Describe the property in at least 40 characters.');
  if (!PROPERTY_TYPES[v.property_type]) errors.push('Choose a property type.');
  if (!NEIGHBOURHOODS.includes(v.neighbourhood)) errors.push('Choose a neighbourhood.');
  if (v.address.length < 5) errors.push('Enter the street / landmark address.');
  if (v.gps_address && !validGps(v.gps_address)) errors.push('GhanaPost GPS address should look like GA-123-4567.');
  if (v.bedrooms === null) errors.push('Enter number of bedrooms (0 for single room / studio).');
  if (v.bathrooms === null) errors.push('Enter number of bathrooms.');
  if (!v.rent_ghs || v.rent_ghs < 50) errors.push('Enter the monthly rent in Ghana cedis.');
  if (v.advance_months === null || v.advance_months < 1) errors.push('Enter how many months of advance rent you require.');
  if (!FURNISHING[v.furnishing]) errors.push('Choose the furnishing level.');
  return { v, errors };
}

module.exports = (db, { notify }) => {
  const r = express.Router();
  const cards = listingCards(db);

  const getListing = db.prepare(`SELECT l.*, u.name landlord_name, u.phone landlord_phone, u.whatsapp landlord_whatsapp,
    u.verification_status landlord_verification, u.created_at landlord_since, u.suspended landlord_suspended
    FROM listings l JOIN users u ON u.id = l.landlord_id WHERE l.id = ?`);
  const getPhotos = db.prepare('SELECT * FROM listing_photos WHERE listing_id = ? ORDER BY position, id');

  const canManage = (user, listing) => user && (user.role === 'admin' || user.id === listing.landlord_id);

  function loadOwned(req, res) {
    const listing = getListing.get(req.params.id);
    if (!listing || !canManage(req.user, listing)) {
      res.status(404).render('error', { title: 'Listing not found', message: 'That listing does not exist or is not yours.' });
      return null;
    }
    return listing;
  }

  function addPhotos(listingId, files) {
    const start = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM listing_photos WHERE listing_id = ?').get(listingId).p;
    const existing = getPhotos.all(listingId).length;
    const insert = db.prepare('INSERT INTO listing_photos (listing_id, filename, position) VALUES (?, ?, ?)');
    let rejected = 0;
    let added = 0;
    for (const file of files || []) {
      if (existing + added >= config.maxPhotos) { rejected++; continue; }
      const name = uploads.savePhoto(file);
      if (!name) { rejected++; continue; }
      insert.run(listingId, name, start + added);
      added++;
    }
    return { added, rejected };
  }

  // ---------- Browse ----------
  r.get('/listings', (req, res) => {
    const result = cards.search(req.query);
    const favs = req.user
      ? new Set(db.prepare('SELECT listing_id FROM favorites WHERE user_id = ?').all(req.user.id).map((f) => f.listing_id))
      : new Set();
    res.render('listings', { title: 'Apartments for rent in Accra', result, favs });
  });

  // ---------- Create ----------
  r.get('/listings/new', requireRole('landlord', 'admin'), (req, res) => {
    res.render('listing-form', {
      title: 'List your property', listing: { advance_months: 6, bedrooms: 1, bathrooms: 1, furnishing: 'unfurnished', amenities: '' },
      photos: [], errors: [],
    });
  });

  r.post('/listings', requireRole('landlord', 'admin'), uploads.parse('photos', config.maxPhotos), verifyCsrf, (req, res) => {
    const { v, errors } = readListingForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (!req.files || !req.files.length) errors.push('Add at least one real photo of the property.');
    if (req.body.owner_confirm !== '1') errors.push('Confirm that you own or are authorised by the owner to let this property.');
    if (errors.length) {
      return res.status(400).render('listing-form', { title: 'List your property', listing: v, photos: [], errors });
    }
    const status = req.user.verification_status === 'verified' || req.user.role === 'admin' ? 'active' : 'pending';
    const id = db.prepare(`INSERT INTO listings (landlord_id, title, description, property_type, neighbourhood, address,
        gps_address, bedrooms, bathrooms, rent_ghs, advance_months, furnishing, amenities, available_from, status)
        VALUES (@landlord_id, @title, @description, @property_type, @neighbourhood, @address, @gps_address, @bedrooms,
        @bathrooms, @rent_ghs, @advance_months, @furnishing, @amenities, @available_from, @status)`)
      .run({ ...v, landlord_id: req.user.id, status }).lastInsertRowid;
    const { added } = addPhotos(id, req.files);
    if (!added) {
      db.prepare('DELETE FROM listings WHERE id = ?').run(id);
      return res.status(400).render('listing-form', {
        title: 'List your property', listing: v, photos: [], errors: ['Photos must be JPG, PNG or WebP images.'],
      });
    }
    const msg = status === 'active'
      ? 'Your listing is live.'
      : 'Listing submitted. It will go live after a quick review — verify your Ghana Card to skip reviews in future.';
    res.redirect(`/listings/${id}?ok=${encodeURIComponent(msg)}`);
  });

  // ---------- Detail ----------
  r.get('/listings/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const listing = getListing.get(req.params.id);
    const visible = listing && ((['active', 'rented'].includes(listing.status) && !listing.landlord_suspended) || canManage(req.user, listing));
    if (!visible) {
      return res.status(404).render('error', { title: 'Listing not found', message: 'This listing has been removed or is not available.' });
    }
    if (!req.user || req.user.id !== listing.landlord_id) {
      db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
    }
    const photos = getPhotos.all(listing.id);
    const isFav = req.user && !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(req.user.id, listing.id);
    const conversation = req.user && db.prepare('SELECT id FROM conversations WHERE listing_id = ? AND tenant_id = ?').get(listing.id, req.user.id);
    const myViewing = req.user && db.prepare(`SELECT * FROM viewings WHERE listing_id = ? AND tenant_id = ?
      AND status IN ('requested','confirmed') ORDER BY id DESC LIMIT 1`).get(listing.id, req.user.id);
    const similar = cards.search({ area: listing.neighbourhood, limit: 4 }).rows.filter((s) => s.id !== listing.id).slice(0, 3);
    res.render('listing', {
      title: listing.title, listing, photos, isFav, conversation, myViewing, similar,
      isOwner: canManage(req.user, listing),
      today: new Date().toISOString().slice(0, 10),
    });
  });

  // ---------- Edit ----------
  r.get('/listings/:id/edit', requireRole('landlord', 'admin'), (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    res.render('listing-form', { title: 'Edit listing', listing, photos: getPhotos.all(listing.id), errors: [] });
  });

  r.post('/listings/:id', requireRole('landlord', 'admin'), uploads.parse('photos', config.maxPhotos), verifyCsrf, (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    const { v, errors } = readListingForm(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(400).render('listing-form', {
        title: 'Edit listing', listing: { ...listing, ...v }, photos: getPhotos.all(listing.id), errors,
      });
    }
    const trusted = req.user.role === 'admin' || req.user.verification_status === 'verified';
    let status = listing.status;
    if (!trusted && ['active', 'rejected'].includes(status)) status = 'pending';
    db.prepare(`UPDATE listings SET title=@title, description=@description, property_type=@property_type,
      neighbourhood=@neighbourhood, address=@address, gps_address=@gps_address, bedrooms=@bedrooms, bathrooms=@bathrooms,
      rent_ghs=@rent_ghs, advance_months=@advance_months, furnishing=@furnishing, amenities=@amenities,
      available_from=@available_from, status=@status, updated_at=datetime('now') WHERE id=@id`)
      .run({ ...v, status, id: listing.id });
    const { rejected } = addPhotos(listing.id, req.files);
    let msg = status === 'pending' ? 'Changes saved and sent for review.' : 'Changes saved.';
    if (rejected) msg += ` ${rejected} photo(s) were skipped (limit ${config.maxPhotos}, JPG/PNG/WebP only).`;
    res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent(msg)}`);
  });

  r.post('/listings/:id/photos/:photoId/delete', requireRole('landlord', 'admin'), verifyCsrf, (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    const photos = getPhotos.all(listing.id);
    const photo = photos.find((p) => String(p.id) === req.params.photoId);
    if (photo && photos.length > 1) {
      db.prepare('DELETE FROM listing_photos WHERE id = ?').run(photo.id);
      uploads.removePhoto(photo.filename);
    }
    res.redirect(`/listings/${listing.id}/edit`);
  });

  r.post('/listings/:id/photos/:photoId/cover', requireRole('landlord', 'admin'), verifyCsrf, (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    const min = db.prepare('SELECT COALESCE(MIN(position), 0) - 1 p FROM listing_photos WHERE listing_id = ?').get(listing.id).p;
    db.prepare('UPDATE listing_photos SET position = ? WHERE id = ? AND listing_id = ?').run(min, req.params.photoId, listing.id);
    res.redirect(`/listings/${listing.id}/edit`);
  });

  // Landlord status changes: mark as rented, archive, relist.
  r.post('/listings/:id/status', requireRole('landlord', 'admin'), verifyCsrf, (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    const to = req.body.status;
    const allowed = {
      rented: ['active'],
      archived: ['active', 'rented', 'pending', 'rejected'],
      relist: ['rented', 'archived'],
    };
    if (!allowed[to] || !allowed[to].includes(listing.status)) return res.redirect('/dashboard');
    let next = to;
    if (to === 'relist') next = (req.user.role === 'admin' || req.user.verification_status === 'verified') ? 'active' : 'pending';
    db.prepare("UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, listing.id);
    res.redirect(`/dashboard?ok=${encodeURIComponent('Listing updated.')}`);
  });

  r.post('/listings/:id/delete', requireRole('landlord', 'admin'), verifyCsrf, (req, res) => {
    const listing = loadOwned(req, res);
    if (!listing) return;
    const photos = getPhotos.all(listing.id);
    db.prepare('DELETE FROM listings WHERE id = ?').run(listing.id);
    photos.forEach((p) => uploads.removePhoto(p.filename));
    res.redirect(`/dashboard?ok=${encodeURIComponent('Listing deleted.')}`);
  });

  // ---------- Tenant actions ----------
  const activeListing = (id) => {
    const l = getListing.get(id);
    return l && l.status === 'active' && !l.landlord_suspended ? l : null;
  };

  r.post('/listings/:id/favorite', requireUser, verifyCsrf, (req, res) => {
    const listing = getListing.get(req.params.id);
    if (listing) {
      const removed = db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, listing.id).changes;
      if (!removed) db.prepare('INSERT INTO favorites (user_id, listing_id) VALUES (?, ?)').run(req.user.id, listing.id);
    }
    const back = typeof req.body.back === 'string' && req.body.back.startsWith('/') && !req.body.back.startsWith('//') ? req.body.back : `/listings/${req.params.id}`;
    res.redirect(back);
  });

  r.post('/listings/:id/contact', requireUser, verifyCsrf, (req, res) => {
    const listing = activeListing(req.params.id);
    if (!listing) return res.status(404).render('error', { title: 'Unavailable', message: 'This listing is no longer accepting enquiries.' });
    if (listing.landlord_id === req.user.id) return res.redirect(`/listings/${listing.id}`);
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (body.length < 2) return res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent('Write a message first.')}#contact`);
    const convId = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO conversations (listing_id, tenant_id, landlord_id) VALUES (?, ?, ?)')
        .run(listing.id, req.user.id, listing.landlord_id);
      const conv = db.prepare('SELECT id FROM conversations WHERE listing_id = ? AND tenant_id = ?').get(listing.id, req.user.id);
      db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(conv.id, req.user.id, body);
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);
      return conv.id;
    })();
    notify.newMessage({
      conversationId: convId, recipientId: listing.landlord_id, senderName: req.user.name, listingTitle: listing.title, body,
    });
    res.redirect(`/messages/${convId}`);
  });

  r.post('/listings/:id/viewings', requireUser, verifyCsrf, (req, res) => {
    const listing = activeListing(req.params.id);
    if (!listing) return res.status(404).render('error', { title: 'Unavailable', message: 'This listing is no longer accepting viewings.' });
    if (listing.landlord_id === req.user.id) return res.redirect(`/listings/${listing.id}`);
    const date = String(req.body.date || '');
    const time = ['morning', 'afternoon', 'evening'].includes(req.body.time) ? req.body.time : null;
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !time) {
      return res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent('Pick a valid future date and time for the viewing.')}#viewing`);
    }
    const open = db.prepare(`SELECT 1 FROM viewings WHERE listing_id = ? AND tenant_id = ? AND status IN ('requested','confirmed')`)
      .get(listing.id, req.user.id);
    if (open) return res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent('You already have a viewing request for this property.')}`);
    db.prepare('INSERT INTO viewings (listing_id, tenant_id, preferred_date, preferred_time, note) VALUES (?, ?, ?, ?, ?)')
      .run(listing.id, req.user.id, date, time, String(req.body.note || '').trim().slice(0, 500) || null);
    notify.viewingRequested({ landlordId: listing.landlord_id, tenantName: req.user.name, listingTitle: listing.title, date, time });
    res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent('Viewing requested. The landlord will confirm on your dashboard.')}`);
  });

  r.post('/listings/:id/report', verifyCsrf, (req, res) => {
    const listing = getListing.get(req.params.id);
    if (!listing) return res.redirect('/listings');
    if (!REPORT_REASONS[req.body.reason]) return res.redirect(`/listings/${listing.id}#report`);
    db.prepare('INSERT INTO reports (listing_id, reporter_id, reason, details) VALUES (?, ?, ?, ?)')
      .run(listing.id, req.user ? req.user.id : null, req.body.reason, String(req.body.details || '').trim().slice(0, 1000) || null);
    res.redirect(`/listings/${listing.id}?ok=${encodeURIComponent('Thank you. Our team will review this listing.')}`);
  });

  return r;
};
