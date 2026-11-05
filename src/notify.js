// User-facing SMS alerts. Each function looks up what it needs, respects the user's
// sms_alerts preference, and fires off the text without blocking the request.
const config = require('./config');

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function createNotifier(db, sms) {
  const site = config.siteName;
  const url = (p) => `${config.baseUrl}${p}`;
  const getUser = db.prepare('SELECT id, name, phone, sms_alerts, suspended FROM users WHERE id = ?');
  const recentlyTexted = db.prepare(`SELECT 1 FROM sms_log WHERE user_id = ? AND kind = ? AND ref = ?
    AND status != 'failed' AND created_at > datetime('now', ?)`);

  function alert(userId, kind, ref, body) {
    const u = getUser.get(userId);
    if (!u || !u.sms_alerts || u.suspended) return;
    sms.send({ userId: u.id, phone: u.phone, kind, ref, body });
  }

  return {
    newMessage({ conversationId, recipientId, senderName, listingTitle, body }) {
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
