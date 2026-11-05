// User-facing alerts (SMS, plus email for new messages). Each function respects the user's
// alert preferences and sends without blocking the request.
const crypto = require('crypto');
const config = require('./config');
const { newMessageEmail } = require('./emails');

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

  function emailNewMessage({ conversationId, recipientId, senderName, listingTitle, body }) {
    if (!mailer.enabled) return;
    const u = getUser.get(recipientId);
    if (!u || !u.email_alerts || u.suspended) return;
    // One email per conversation per cooldown window; the email links to the full chat.
    if (recentlyEmailed.get(u.id, 'message', String(conversationId), `-${config.emailMessageCooldownMinutes} minutes`)) return;
    const unsub = unsubscribeUrl(u);
    const email = newMessageEmail({
      recipientName: u.name.split(' ')[0], senderName, listingTitle, body,
      conversationUrl: url(`/messages/${conversationId}`), unsubscribeUrl: unsub,
    });
    mailer.send({
      ...email, to: u.email, userId: u.id, kind: 'message', ref: conversationId,
      // RFC 8058 one-click unsubscribe (Gmail/Yahoo show an "Unsubscribe" button).
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
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

    viewingRequested({ landlordId, tenantName, listingTitle, date, time }) {
      alert(landlordId, 'viewing', null,
        `${site}: ${shorten(tenantName, 30)} wants to view "${shorten(listingTitle, 40)}" on ${date} (${time}). Confirm or decline: ${url('/dashboard')}`);
    },

    viewingStatus({ toUserId, status, listingTitle, date, time, byName }) {
      const verb = { confirmed: 'CONFIRMED', declined: 'declined', cancelled: 'cancelled' }[status];
      alert(toUserId, 'viewing', null,
        `${site}: ${shorten(byName, 30)} ${verb} the viewing of "${shorten(listingTitle, 40)}" on ${date} (${time}). Details: ${url('/dashboard')}`);
    },

    listingModerated({ landlordId, listingId, listingTitle, action, note }) {
      const text = {
        approve: `Your listing "${shorten(listingTitle, 50)}" is now LIVE: ${url(`/listings/${listingId}`)}`,
        reject: `Your listing "${shorten(listingTitle, 50)}" was not approved${note ? `: ${shorten(note, 120)}` : '.'} Edit and resubmit: ${url(`/listings/${listingId}/edit`)}`,
        takedown: `Your listing "${shorten(listingTitle, 50)}" was removed${note ? `: ${shorten(note, 120)}` : '.'} Contact ${config.supportEmail} with questions.`,
      }[action];
      if (text) alert(landlordId, 'listing', listingId, `${site}: ${text}`);
    },

    verificationResult({ userId, status, note }) {
      alert(userId, 'verification', null, status === 'verified'
        ? `${site}: Your Ghana Card is verified. Your listings now show the verified badge and publish instantly.`
        : `${site}: We couldn't verify your Ghana Card${note ? `: ${shorten(note, 120)}` : '.'} Please resubmit: ${url('/account')}`);
    },
  };
}

module.exports = { createNotifier };
