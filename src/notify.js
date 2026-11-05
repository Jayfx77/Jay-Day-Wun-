// User-facing alerts (SMS, plus email for new messages). Each function respects the user's
// alert preferences and sends without blocking the request.
const crypto = require('crypto');
const config = require('./config');
const {
  newMessageEmail, viewingRequestedEmail, viewingStatusEmail, listingDecisionEmail, listingsPublishedEmail,
} = require('./emails');

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function createNotifier(db, sms, mailer = { enabled: false }) {
  const site = config.siteName;
  const url = (p) => `${config.baseUrl}${p}`;
  const getUser = db.prepare('SELECT id, name, email, phone, sms_alerts, email_alerts, unsubscribe_token, suspended FROM users WHERE id = ?');
  const recentlyEmailed = db.prepare(`SELECT 1 FROM email_log WHERE user_id = ? AND kind = ? AND ref = ?
    AND status != 'failed' AND created_at > datetime('now', ?)`);

  function unsubscribeUrl(u) {
    let token = u.unsubscribe_token;
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      db.prepare('UPDATE users SET unsubscribe_token = ? WHERE id = ?').run(token, u.id);
    }
    return url(`/unsubscribe?token=${token}`);
  }

  // Sends an alert email if email is configured and the user hasn't opted out.
  function email(userId, kind, ref, build) {
    if (!mailer.enabled) return;
    const u = getUser.get(userId);
    if (!u || !u.email_alerts || u.suspended) return;
    const unsub = unsubscribeUrl(u);
    const msg = build(u, unsub);
    mailer.send({
      ...msg, to: u.email, userId: u.id, kind, ref,
      // RFC 8058 one-click unsubscribe (Gmail/Yahoo show an "Unsubscribe" button).
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  }

  const getViewing = db.prepare(`SELECT v.*, l.title listing_title, l.address, l.neighbourhood, l.gps_address, l.landlord_id,
      t.name tenant_name, t.phone tenant_phone, ll.name landlord_name, ll.phone landlord_phone
    FROM viewings v JOIN listings l ON l.id = v.listing_id JOIN users t ON t.id = v.tenant_id JOIN users ll ON ll.id = l.landlord_id
    WHERE v.id = ?`);
  const uidHost = new URL(config.baseUrl).hostname;
  const getListingRow = db.prepare('SELECT id, title, neighbourhood, rent_ghs, advance_months FROM listings WHERE id = ?');

  function emailNewMessage({ conversationId, recipientId, senderName, listingTitle, body }) {
    // One email per conversation per cooldown window; the email links to the full chat.
    if (recentlyEmailed.get(recipientId, 'message', String(conversationId), `-${config.emailMessageCooldownMinutes} minutes`)) return;
    email(recipientId, 'message', conversationId, (u, unsub) => newMessageEmail({
      recipientName: u.name.split(' ')[0], senderName, listingTitle, body,
      conversationUrl: url(`/messages/${conversationId}`), unsubscribeUrl: unsub,
    }));
  }
  const recentlyTexted = db.prepare(`SELECT 1 FROM sms_log WHERE user_id = ? AND kind = ? AND ref = ?
    AND status != 'failed' AND created_at > datetime('now', ?)`);

  function alert(userId, kind, ref, body) {
    const u = getUser.get(userId);
    if (!u || !u.sms_alerts || u.suspended) return;
    sms.send({ userId: u.id, phone: u.phone, kind, ref, body });
  }

  return {
    newMessage({ conversationId, recipientId, senderName, listingTitle, body }) {
      emailNewMessage({ conversationId, recipientId, senderName, listingTitle, body });
      // One text per conversation per cooldown window, so a busy chat doesn't flood the phone.
      const window = `-${config.sms.messageCooldownMinutes} minutes`;
      if (recentlyTexted.get(recipientId, 'message', String(conversationId), window)) return;
      alert(recipientId, 'message', conversationId,
        `${site}: New message from ${shorten(senderName, 30)} about "${shorten(listingTitle, 40)}": "${shorten(body, 80)}" Reply: ${url(`/messages/${conversationId}`)}`);
    },

    viewingRequested({ viewingId }) {
      const v = getViewing.get(viewingId);
      if (!v) return;
      alert(v.landlord_id, 'viewing', v.id,
        `${site}: ${shorten(v.tenant_name, 30)} wants to view "${shorten(v.listing_title, 40)}" on ${v.preferred_date} (${v.preferred_time}). Confirm or decline: ${url('/dashboard')}`);
      email(v.landlord_id, 'viewing', v.id, (u, unsub) => viewingRequestedEmail({
        v, recipientName: u.name.split(' ')[0], dashboardUrl: url('/dashboard'), unsubscribeUrl: unsub,
      }));
    },

    // byUserId changed the viewing to `status`; tell the other party.
    viewingStatus({ viewingId, status, byUserId }) {
      const v = getViewing.get(viewingId);
      if (!v) return;
      const byLandlord = byUserId === v.landlord_id;
      const toUserId = byLandlord ? v.tenant_id : v.landlord_id;
      const byName = byLandlord ? v.landlord_name : v.tenant_name;
      const verb = { confirmed: 'CONFIRMED', declined: 'declined', cancelled: 'cancelled' }[status];
      if (!verb) return;
      alert(toUserId, 'viewing', v.id,
        `${site}: ${shorten(byName, 30)} ${verb} the viewing of "${shorten(v.listing_title, 40)}" on ${v.preferred_date} (${v.preferred_time}). Details: ${url('/dashboard')}`);
      email(toUserId, 'viewing', v.id, (u, unsub) => viewingStatusEmail({
        v, status, toTenant: byLandlord, byName, recipientName: u.name.split(' ')[0], unsubscribeUrl: unsub, uidHost,
        urls: { dashboard: url('/dashboard'), similar: url(`/listings?area=${encodeURIComponent(v.neighbourhood)}`) },
      }));
    },

    listingModerated({ landlordId, listingId, listingTitle, action, note }) {
      const text = {
        approve: `Your listing "${shorten(listingTitle, 50)}" is now LIVE: ${url(`/listings/${listingId}`)}`,
        reject: `Your listing "${shorten(listingTitle, 50)}" was not approved${note ? `: ${shorten(note, 120)}` : '.'} Edit and resubmit: ${url(`/listings/${listingId}/edit`)}`,
        takedown: `Your listing "${shorten(listingTitle, 50)}" was removed${note ? `: ${shorten(note, 120)}` : '.'} Contact ${config.supportEmail} with questions.`,
      }[action];
      if (!text) return;
      alert(landlordId, 'listing', listingId, `${site}: ${text}`);
      const listing = getListingRow.get(listingId);
      if (listing) {
        email(landlordId, 'listing', listingId, (u, unsub) => listingDecisionEmail({
          listing, action, note, recipientName: u.name.split(' ')[0], unsubscribeUrl: unsub,
          urls: { listing: url(`/listings/${listingId}`), edit: url(`/listings/${listingId}/edit`) },
        }));
      }
    },

    // Pending listings published because the landlord was just verified (email only: the
    // verification SMS already tells them their listings are live).
    listingsPublished({ landlordId, listingIds }) {
      const listings = listingIds.map((id) => getListingRow.get(id)).filter(Boolean);
      if (!listings.length) return;
      email(landlordId, 'listing', listings.map((l) => l.id).join(','), (u, unsub) => listingsPublishedEmail({
        listings, recipientName: u.name.split(' ')[0], unsubscribeUrl: unsub,
        urls: { listing: (id) => url(`/listings/${id}`), dashboard: url('/dashboard') },
      }));
    },

    verificationResult({ userId, status, note }) {
      alert(userId, 'verification', null, status === 'verified'
        ? `${site}: Your Ghana Card is verified. Your listings now show the verified badge and publish instantly.`
        : `${site}: We couldn't verify your Ghana Card${note ? `: ${shorten(note, 120)}` : '.'} Please resubmit: ${url('/account')}`);
    },
  };
}

module.exports = { createNotifier };
