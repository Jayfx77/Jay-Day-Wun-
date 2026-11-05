const path = require('path');
const express = require('express');
const config = require('../config');
const { verifyCsrf, requireRole } = require('../auth');
const { listingCards } = require('../listingQueries');

module.exports = (db, { notify }) => {
  const r = express.Router();
  const cards = listingCards(db);
  r.use(requireRole('admin'));

  const done = (res, msg) => res.redirect(`/admin?ok=${encodeURIComponent(msg)}`);

  r.get('/', (req, res) => {
    const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'tenant') tenants,
      (SELECT COUNT(*) FROM users WHERE role = 'landlord') landlords,
      (SELECT COUNT(*) FROM listings WHERE status = 'active') active,
      (SELECT COUNT(*) FROM listings WHERE status = 'rented') rented,
      (SELECT COUNT(*) FROM conversations) conversations,
      (SELECT COUNT(*) FROM viewings) viewings`).get();
    const pendingListings = cards.pending();
    const pendingVerifications = db.prepare(`SELECT id, name, email, phone, ghana_card_number, created_at
      FROM users WHERE verification_status = 'pending' ORDER BY id`).all();
    const reports = db.prepare(`SELECT r.*, l.title listing_title, l.status listing_status, u.name reporter_name
      FROM reports r JOIN listings l ON l.id = r.listing_id LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'open' ORDER BY r.id`).all();
    const q = String(req.query.q || '').trim();
    const users = db.prepare(`SELECT id, name, email, phone, role, verification_status, suspended, created_at,
        (SELECT COUNT(*) FROM listings l WHERE l.landlord_id = users.id) listings
      FROM users WHERE (@q = '' OR name LIKE @like OR email LIKE @like OR phone LIKE @like)
      ORDER BY id DESC LIMIT 50`).all({ q, like: `%${q}%` });
    const smsStats = db.prepare(`SELECT
      SUM(status IN ('sent','logged')) delivered, SUM(status = 'failed') failed, SUM(status = 'queued') queued
      FROM sms_log WHERE created_at > datetime('now', '-1 day')`).get();
    const smsFailures = db.prepare(`SELECT s.created_at, s.phone, s.kind, s.error, u.name FROM sms_log s
      LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'failed' ORDER BY s.id DESC LIMIT 10`).all();
    res.render('admin', { title: 'Admin', stats, smsStats, smsFailures, pendingListings, pendingVerifications, reports, users, q });
  });

  r.post('/listings/:id/moderate', verifyCsrf, (req, res) => {
    const action = req.body.action;
    const note = String(req.body.note || '').trim().slice(0, 500) || null;
    const map = { approve: 'active', reject: 'rejected', takedown: 'archived' };
    if (!map[action]) return done(res, 'Unknown action.');
    const listing = db.prepare('SELECT id, title, landlord_id, status FROM listings WHERE id = ?').get(req.params.id);
    if (!listing) return done(res, 'Listing not found.');
    db.prepare("UPDATE listings SET status = ?, moderation_note = ?, updated_at = datetime('now') WHERE id = ?")
      .run(map[action], note, listing.id);
    if (listing.status !== map[action]) {
      notify.listingModerated({ landlordId: listing.landlord_id, listingId: listing.id, listingTitle: listing.title, action, note });
    }
    done(res, `Listing #${req.params.id} ${map[action]}.`);
  });

  r.post('/users/:id/verification', verifyCsrf, (req, res) => {
    const action = req.body.action;
    if (!['verify', 'reject'].includes(action)) return done(res, 'Unknown action.');
    const status = action === 'verify' ? 'verified' : 'rejected';
    const note = String(req.body.note || '').trim().slice(0, 500) || null;
    db.transaction(() => {
      db.prepare('UPDATE users SET verification_status = ?, verification_note = ? WHERE id = ?')
        .run(status, note, req.params.id);
      // Verified landlords' pending listings go live immediately.
      if (status === 'verified') {
        db.prepare("UPDATE listings SET status = 'active', updated_at = datetime('now') WHERE landlord_id = ? AND status = 'pending'")
          .run(req.params.id);
      }
    })();
    notify.verificationResult({ userId: Number(req.params.id), status, note });
    done(res, `User #${req.params.id} ${status}.`);
  });

  r.post('/users/:id/suspend', verifyCsrf, (req, res) => {
    if (String(req.user.id) === req.params.id) return done(res, 'You cannot suspend yourself.');
    const suspend = req.body.action === 'suspend' ? 1 : 0;
    db.prepare("UPDATE users SET suspended = ? WHERE id = ? AND role != 'admin'").run(suspend, req.params.id);
    if (suspend) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
    done(res, `User #${req.params.id} ${suspend ? 'suspended' : 'reinstated'}.`);
  });

  r.post('/reports/:id/resolve', verifyCsrf, (req, res) => {
    db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(req.params.id);
    done(res, `Report #${req.params.id} resolved.`);
  });

  // Ghana Card uploads are never public; only admins can view them through this route.
  r.get('/users/:id/ghana-card', (req, res) => {
    const u = db.prepare('SELECT ghana_card_file FROM users WHERE id = ?').get(req.params.id);
    if (!u || !u.ghana_card_file || !/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(u.ghana_card_file)) {
      return res.status(404).send('No document');
    }
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(path.join(config.privateDir, u.ghana_card_file));
  });

  return r;
};
