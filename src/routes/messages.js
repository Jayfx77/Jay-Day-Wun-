const express = require('express');
const { verifyCsrf, requireUser } = require('../auth');
const { requirePhoneVerified } = require('../phoneVerification');

module.exports = (db, { notify }) => {
  const r = express.Router();

  r.get('/messages', requireUser, (req, res) => {
    const conversations = db.prepare(`
      SELECT c.*, l.title listing_title, l.status listing_status,
        CASE WHEN c.tenant_id = @id THEN ll.name ELSE t.name END other_name,
        (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) last_body,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read_at IS NULL AND m.sender_id != @id) unread
      FROM conversations c
      JOIN listings l ON l.id = c.listing_id
      JOIN users t ON t.id = c.tenant_id
      JOIN users ll ON ll.id = c.landlord_id
      WHERE c.tenant_id = @id OR c.landlord_id = @id
      ORDER BY c.updated_at DESC`).all({ id: req.user.id });
    res.render('inbox', { title: 'Messages', conversations });
  });

  function load(req, res) {
    const c = db.prepare(`SELECT c.*, l.title listing_title, l.status listing_status, l.rent_ghs, l.neighbourhood,
        t.name tenant_name, t.phone tenant_phone, t.whatsapp tenant_whatsapp,
        ll.name landlord_name, ll.phone landlord_phone, ll.whatsapp landlord_whatsapp, ll.verification_status landlord_verification
      FROM conversations c JOIN listings l ON l.id = c.listing_id
      JOIN users t ON t.id = c.tenant_id JOIN users ll ON ll.id = c.landlord_id WHERE c.id = ?`).get(req.params.id);
    const allowed = c && (c.tenant_id === req.user.id || c.landlord_id === req.user.id || req.user.role === 'admin');
    if (!allowed) {
      res.status(404).render('error', { title: 'Conversation not found', message: 'This conversation does not exist.' });
      return null;
    }
    return c;
  }

  r.get('/messages/:id', requireUser, (req, res) => {
    const c = load(req, res);
    if (!c) return;
    db.prepare(`UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`)
      .run(c.id, req.user.id);
    const messages = db.prepare(`SELECT m.*, u.name sender_name FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? ORDER BY m.id`).all(c.id);
    const iAmTenant = c.tenant_id === req.user.id;
    res.render('conversation', {
      title: `Chat · ${c.listing_title}`, c, messages,
      other: iAmTenant
        ? { name: c.landlord_name, phone: c.landlord_phone, whatsapp: c.landlord_whatsapp, verified: c.landlord_verification === 'verified', role: 'Landlord' }
        : { name: c.tenant_name, phone: c.tenant_phone, whatsapp: c.tenant_whatsapp, role: 'Tenant' },
    });
  });

  r.post('/messages/:id', requireUser, requirePhoneVerified, verifyCsrf, (req, res) => {
    const c = load(req, res);
    if (!c) return;
    if (c.tenant_id !== req.user.id && c.landlord_id !== req.user.id) return res.redirect(`/messages/${c.id}`);
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (body) {
      db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(c.id, req.user.id, body);
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(c.id);
      notify.newMessage({
        conversationId: c.id,
        recipientId: req.user.id === c.tenant_id ? c.landlord_id : c.tenant_id,
        senderName: req.user.name,
        listingTitle: c.listing_title,
        body,
      });
    }
    res.redirect(`/messages/${c.id}#latest`);
  });

  return r;
};
