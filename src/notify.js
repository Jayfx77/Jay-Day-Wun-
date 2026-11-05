// User-facing alerts (SMS, plus email for new messages). Each function respects the user's
// alert preferences and sends without blocking the request.
const crypto = require('crypto');
const config = require('./config');
const { describeDevice, accraTime, cedis, shortViewingTime, prettyPhone } = require('./helpers');
const {
  savedSearchEmail, passwordChangedEmail, newMessageEmail, viewingRequestedEmail, viewingStatusEmail, listingDecisionEmail, verificationEmail,
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
  // security: true sends regardless of the user's email setting, without unsubscribe headers.
  function email(userId, kind, ref, build, { security = false } = {}) {
    if (!mailer.enabled) return;
    const u = getUser.get(userId);
    if (!u || (!security && (!u.email_alerts || u.suspended))) return;
    if (security) {
      mailer.send({ ...build(u, null), to: u.email, userId: u.id, kind, ref });
      return;
    }
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
    // New listings matching a saved search. Respects the user's email setting.
    // channels: { email, sms } decided by the alert job.
    savedSearchMatches({ search, description, listings, total, searchPath, channels = { email: true, sms: false } }) {
      if (channels.sms) {
        const u = getUser.get(search.user_id);
        const first = listings[0];
        const what = `${first.bedrooms ? `${first.bedrooms}-bed` : 'Single room'} in ${first.neighbourhood}`;
        const body = total === 1
          ? `${site}: New home for your search "${shorten(description, 45)}": ${cedis(first.rent_ghs)}/mo, ${what}. ${url(`/listings/${first.id}`)}`
          : `${site}: ${total} new homes for your search "${shorten(description, 45)}", from ${cedis(Math.min(...listings.map((l) => l.rent_ghs)))}/mo. See them: ${url(searchPath)}`;
        sms.send({ userId: u.id, phone: u.phone, kind: 'saved_search', ref: search.id, body: `${body} Manage alerts: ${url('/dashboard')}` });
      }
      if (!channels.email) return;
      email(search.user_id, 'saved_search', search.id, (u, unsub) => savedSearchEmail({
        recipientName: u.name.split(' ')[0], description, listings, total, unsubscribeUrl: unsub,
        urls: {
          search: url(searchPath), stop: url(`/saved-searches/stop?token=${search.token}`),
          listing: (id) => url(`/listings/${id}`), photo: (f) => url(`/uploads/${f}`),
        },
      }));
    },

    // Security notice by SMS and email, sent even if the user turned alerts off.
    // method: 'reset_code' | 'reset_link' | 'account'.
    passwordChanged({ userId, method, userAgent, ip }) {
      const u = getUser.get(userId);
      if (!u) return;
      sms.send({
        userId: u.id, phone: u.phone, kind: 'security',
        body: `${site}: Your password was just changed. If this wasn't you, reset it now at ${url('/forgot')} and contact ${config.supportEmail}.`,
      });
      email(u.id, 'security', 'password', (user) => passwordChangedEmail({
        recipientName: user.name.split(' ')[0], method, when: accraTime(), device: describeDevice(userAgent), ip,
        urls: { forgot: url('/forgot') },
      }), { security: true });
    },

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

    // SMS reminder for a confirmed viewing to the tenant and landlord. when: 'tomorrow' | 'today'.
    viewingReminder({ viewingId, when }) {
      const v = getViewing.get(viewingId);
      if (!v) return;
      const at = `${when} (${shortViewingTime(v.preferred_date, v.preferred_time)})`;
      const place = [v.address, v.neighbourhood].filter(Boolean).join(', ') + (v.gps_address ? ` (${v.gps_address})` : '');
      const title = shorten(v.listing_title, 35);
      alert(v.tenant_id, 'viewing_reminder', v.id,
        `${site} reminder: viewing ${at} at "${title}", ${shorten(place, 70)}. Landlord: ${shorten(v.landlord_name, 25)} ${prettyPhone(v.landlord_phone)}.`
        + (when === 'today' ? ' Call ahead to agree the exact time. Never pay before viewing.' : '')
        + ` Can't make it? Cancel: ${url('/dashboard')}`);
      alert(v.landlord_id, 'viewing_reminder', v.id,
        `${site} reminder: ${shorten(v.tenant_name, 25)} (${prettyPhone(v.tenant_phone)}) is viewing "${title}" ${at}. Need to cancel? ${url('/dashboard')}`);
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

    // publishedIds: pending listings that went live because of this verification.
    verificationResult({ userId, status, note, publishedIds = [] }) {
      alert(userId, 'verification', null, status === 'verified'
        ? `${site}: Your Ghana Card is verified. Your listings now show the verified badge and publish instantly.`
        : `${site}: We couldn't verify your Ghana Card${note ? `: ${shorten(note, 120)}` : '.'} Please resubmit: ${url('/account')}`);
      const published = publishedIds.map((id) => getListingRow.get(id)).filter(Boolean);
      email(userId, 'verification', status, (u, unsub) => verificationEmail({
        status, note, published, recipientName: u.name.split(' ')[0], unsubscribeUrl: unsub,
        urls: {
          account: url('/account'), dashboard: url('/dashboard'), newListing: url('/listings/new'),
          listing: (id) => url(`/listings/${id}`),
        },
      }));
    },
  };
}

module.exports = { createNotifier };
