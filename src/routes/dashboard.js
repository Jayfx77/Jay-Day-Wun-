const express = require('express');
const { verifyCsrf, requireUser, hashPassword, verifyPassword } = require('../auth');
const { normalisePhone, validGhanaCard } = require('../helpers');
const uploads = require('../uploads');
const { listingCards } = require('../listingQueries');

module.exports = (db, { notify, phone: phoneCheck }) => {
  const r = express.Router();
  const cards = listingCards(db);

  r.get('/dashboard', requireUser, (req, res) => {
    const u = req.user;
    if (u.role === 'admin' && !req.query.me) return res.redirect('/admin');
    const data = { title: 'Dashboard' };
    if (u.role === 'landlord' || u.role === 'admin') {
      data.myListings = cards.byLandlord(u.id);
      data.incomingViewings = db.prepare(`SELECT v.*, l.title listing_title, t.name tenant_name, t.phone tenant_phone
        FROM viewings v JOIN listings l ON l.id = v.listing_id JOIN users t ON t.id = v.tenant_id
        WHERE l.landlord_id = ? AND v.status IN ('requested','confirmed') ORDER BY v.preferred_date`).all(u.id);
      data.enquiries = db.prepare(`SELECT COUNT(*) n FROM conversations WHERE landlord_id = ?`).get(u.id).n;
    }
    data.saved = cards.favorites(u.id);
    data.myViewings = db.prepare(`SELECT v.*, l.title listing_title, l.neighbourhood, l.address, l.gps_address,
      ll.name landlord_name, ll.phone landlord_phone
      FROM viewings v JOIN listings l ON l.id = v.listing_id JOIN users ll ON ll.id = l.landlord_id
      WHERE v.tenant_id = ? ORDER BY v.id DESC LIMIT 20`).all(u.id);
    res.render('dashboard', data);
  });

  // Landlord confirms/declines; tenant cancels.
  r.post('/viewings/:id/status', requireUser, verifyCsrf, (req, res) => {
    const v = db.prepare(`SELECT v.*, l.landlord_id, l.title listing_title FROM viewings v JOIN listings l ON l.id = v.listing_id WHERE v.id = ?`).get(req.params.id);
    const to = req.body.status;
    const isLandlord = v && v.landlord_id === req.user.id;
    const isTenant = v && v.tenant_id === req.user.id;
    const ok = v && ((isLandlord && ['confirmed', 'declined'].includes(to) && v.status === 'requested')
      || (isLandlord && to === 'cancelled' && v.status === 'confirmed')
      || (isTenant && to === 'cancelled' && ['requested', 'confirmed'].includes(v.status)));
    if (ok) {
      db.prepare('UPDATE viewings SET status = ? WHERE id = ?').run(to, v.id);
      notify.viewingStatus({
        toUserId: isLandlord ? v.tenant_id : v.landlord_id, status: to, listingTitle: v.listing_title,
        date: v.preferred_date, time: v.preferred_time, byName: req.user.name,
      });
    }
    res.redirect(`/dashboard?ok=${encodeURIComponent(ok ? 'Viewing updated.' : 'That change is not allowed.')}`);
  });

  r.get('/account', requireUser, (req, res) => {
    res.render('account', { title: 'My account', errors: [], welcome: req.query.welcome === '1' });
  });

  r.post('/account', requireUser, verifyCsrf, (req, res) => {
    const errors = [];
    const name = String(req.body.name || '').trim().slice(0, 80);
    const phone = normalisePhone(req.body.phone);
    if (name.length < 2) errors.push('Enter your full name.');
    if (!phone) errors.push('Enter a valid Ghanaian mobile number.');
    const newPw = String(req.body.new_password || '');
    if (newPw) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(req.body.current_password || ''), row.password_hash)) errors.push('Current password is wrong.');
      if (newPw.length < 8) errors.push('New password must be at least 8 characters.');
    }
    if (errors.length) return res.status(400).render('account', { title: 'My account', errors, welcome: false });
    const phoneChanged = phone !== req.user.phone && req.user.role !== 'admin';
    db.prepare(`UPDATE users SET name = ?, phone = ?, whatsapp = ?, sms_alerts = ?,
      phone_verified = CASE WHEN ? THEN 0 ELSE phone_verified END WHERE id = ?`)
      .run(name, phone, req.body.whatsapp === '1' ? 1 : 0, req.body.sms_alerts === '1' ? 1 : 0, phoneChanged ? 1 : 0, req.user.id);
    if (newPw) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPw), req.user.id);
      // Sign out other devices.
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND csrf != ?").run(req.user.id, req.csrfToken);
    }
    if (phoneChanged) {
      phoneCheck.sendCode({ ...req.user, phone });
      return res.redirect('/verify-phone?next=/account');
    }
    res.redirect(`/account?ok=${encodeURIComponent('Account updated.')}`);
  });

  // Landlord identity verification with Ghana Card (NIA). Stored privately, reviewed by admins.
  r.post('/account/verification', requireUser, uploads.parse('ghana_card', 1), verifyCsrf, (req, res) => {
    const u = req.user;
    const errors = [];
    if (u.role !== 'landlord') errors.push('Only landlord accounts need verification.');
    if (['pending', 'verified'].includes(u.verification_status)) errors.push('Your verification is already submitted.');
    const card = String(req.body.ghana_card_number || '').trim().toUpperCase();
    if (!validGhanaCard(card)) errors.push('Ghana Card number should look like GHA-123456789-0.');
    if (req.uploadError) errors.push(req.uploadError);
    const file = req.files && req.files[0];
    if (!file) errors.push('Upload a clear photo or PDF of the front of your Ghana Card.');
    let saved = null;
    if (!errors.length) {
      saved = uploads.savePrivateDoc(file);
      if (!saved) errors.push('The Ghana Card file must be a JPG, PNG, WebP or PDF.');
    }
    if (errors.length) return res.status(400).render('account', { title: 'My account', errors, welcome: false });
    db.prepare(`UPDATE users SET ghana_card_number = ?, ghana_card_file = ?, verification_status = 'pending',
      verification_note = NULL WHERE id = ?`).run(card, saved, u.id);
    res.redirect(`/account?ok=${encodeURIComponent('Verification submitted. We usually review within 1 working day.')}`);
  });

  return r;
};
