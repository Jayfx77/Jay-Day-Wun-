// SMS delivery with pluggable Ghanaian providers. Every message is recorded in sms_log.
// Sending never blocks or breaks a web request: failures are logged and stored with status 'failed'.
const config = require('./config');

const providers = {
  async arkesel({ to, body }) {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': config.sms.arkeselApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: config.sms.senderId, message: body, recipients: [to] }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') throw new Error(`Arkesel ${res.status}: ${data.message || JSON.stringify(data)}`);
  },

  async hubtel({ to, body }) {
    const qs = new URLSearchParams({
      clientid: config.sms.hubtelClientId,
      clientsecret: config.sms.hubtelClientSecret,
      from: config.sms.senderId,
      to,
      content: body,
    });
    const res = await fetch(`https://smsc.hubtel.com/v1/messages/send?${qs}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Hubtel ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },

  // Development / testing: print instead of sending.
  async log({ to, body }) {
    if (process.env.NODE_ENV !== 'test') console.log(`[sms → +${to}] ${body}`);
  },
};

function createSms(db) {
  const provider = providers[config.sms.provider];
  if (!provider) throw new Error(`Unknown SMS_PROVIDER "${config.sms.provider}". Use arkesel, hubtel or log.`);
  if (config.isProd && config.sms.provider === 'log') {
    console.warn('SMS_PROVIDER is "log": texts (including password-reset codes) are printed, not sent.');
  }

  const insert = db.prepare(`INSERT INTO sms_log (user_id, phone, kind, ref, body, status) VALUES (?, ?, ?, ?, ?, 'queued')`);
  const finish = db.prepare('UPDATE sms_log SET status = ?, error = ? WHERE id = ?');
  const pending = new Set();

  // Returns a promise (useful in tests); callers in request handlers don't await it.
  function send({ userId = null, phone, kind, ref = null, body }) {
    if (!phone) return Promise.resolve();
    const text = body.length > 459 ? `${body.slice(0, 456)}...` : body; // max 3 SMS segments
    const id = insert.run(userId, phone, kind, ref == null ? null : String(ref), text).lastInsertRowid;
    const p = provider({ to: phone, body: text })
      .then(() => finish.run(config.sms.provider === 'log' ? 'logged' : 'sent', null, id))
      .catch((err) => {
        console.error(`SMS ${id} failed:`, err.message);
        finish.run('failed', String(err.message).slice(0, 500), id);
      })
      .finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }

  // Lets tests (and graceful shutdown) wait for in-flight texts.
  const flush = () => Promise.all([...pending]);

  return { send, flush, provider: config.sms.provider };
}

module.exports = { createSms };
