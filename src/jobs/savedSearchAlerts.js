// Emails people about newly published listings that match their saved searches.
// Runs every few minutes from server.js. "instant" searches are emailed on the next run;
// "daily" searches get one digest a day, from 7am GMT.
const { listingCards } = require('../listingQueries');
const { describe, toQueryString } = require('../savedSearches');

const DAILY_HOUR_GMT = 7;
const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' '); // matches SQLite datetime('now')

function runSavedSearchAlerts(db, { notify, mailer }, now = new Date()) {
  const cards = listingCards(db);
  const nowSql = sqlTime(now);
  const dayAgo = sqlTime(new Date(now.getTime() - 20 * 3600e3));
  const searches = db.prepare(`SELECT s.*, u.email_alerts, u.suspended FROM saved_searches s JOIN users u ON u.id = s.user_id
    WHERE s.frequency != 'off'`).all();
  const hit = db.prepare('INSERT OR IGNORE INTO saved_search_hits (saved_search_id, listing_id) VALUES (?, ?)');
  const seen = db.prepare('SELECT 1 FROM saved_search_hits WHERE saved_search_id = ? AND listing_id = ?');
  const advance = db.prepare('UPDATE saved_searches SET checked_until = ? WHERE id = ?');
  let emailed = 0;

  for (const s of searches) {
    const canEmail = mailer.enabled && s.email_alerts && !s.suspended;
    if (s.frequency === 'daily' && canEmail) {
      const due = now.getUTCHours() >= DAILY_HOUR_GMT && (!s.last_sent_at || s.last_sent_at < dayAgo);
      if (!due) continue; // keep collecting until the digest is due
    }
    if (!canEmail) { advance.run(nowSql, s.id); continue; } // don't save up a backlog to send later

    const filters = JSON.parse(s.query);
    const found = cards.search({ ...filters, sort: 'newest', limit: 48 }, {
      publishedAfter: s.checked_until, publishedUntil: nowSql, excludeLandlord: s.user_id,
    });
    const fresh = found.rows.filter((l) => !seen.get(s.id, l.id));
    db.transaction(() => {
      fresh.forEach((l) => hit.run(s.id, l.id));
      advance.run(nowSql, s.id);
      if (fresh.length) db.prepare('UPDATE saved_searches SET last_sent_at = ? WHERE id = ?').run(nowSql, s.id);
    })();
    if (fresh.length) {
      const total = fresh.length + Math.max(0, found.total - found.rows.length);
      notify.savedSearchMatches({
        search: s, description: describe(filters), listings: fresh, total, searchPath: `/listings?${toQueryString(filters)}`,
      });
      emailed++;
    }
  }
  return { checked: searches.length, emailed };
}

module.exports = { runSavedSearchAlerts };
