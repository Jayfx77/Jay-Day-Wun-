// SMS reminders for confirmed viewings, to both tenant and landlord:
//   - the evening before (from 6pm GMT), and
//   - on the day, 2 hours before the time window starts (not before 7am).
// Each reminder is sent at most once. Ghana is on GMT all year, so UTC times are local times.
const { TIME_WINDOWS } = require('../constants');

const EVENING_BEFORE_HOUR = 18;
const EARLIEST_DAY_OF_HOUR = 7;
const HOURS_BEFORE_WINDOW = 2;

const day = (d) => d.toISOString().slice(0, 10);
const at = (date, hour) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

function runViewingReminders(db, { notify }, now = new Date()) {
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 864e5));
  const stamp = now.toISOString();
  // Confirmed viewings today or tomorrow, on listings that are still live, between active users.
  const due = db.prepare(`SELECT v.* FROM viewings v JOIN listings l ON l.id = v.listing_id
    JOIN users t ON t.id = v.tenant_id JOIN users ll ON ll.id = l.landlord_id
    WHERE v.status = 'confirmed' AND v.preferred_date IN (?, ?) AND l.status = 'active'
      AND t.suspended = 0 AND ll.suspended = 0
      AND (v.reminded_day_before IS NULL OR v.reminded_day_of IS NULL)`).all(today, tomorrow);
  const mark = (col, id) => db.prepare(`UPDATE viewings SET ${col} = ? WHERE id = ?`).run(stamp, id);
  let sent = 0;

  for (const v of due) {
    const w = TIME_WINDOWS[v.preferred_time] || TIME_WINDOWS.morning;

    if (!v.reminded_day_before) {
      if (v.preferred_date === tomorrow && now >= at(today, EVENING_BEFORE_HOUR)) {
        mark('reminded_day_before', v.id);
        notify.viewingReminder({ viewingId: v.id, when: 'tomorrow' });
        sent++;
        continue; // the "today" reminder comes on the day
      }
      // Confirmed too late for an evening-before reminder: don't send it on the day as well.
      if (v.preferred_date === today) mark('reminded_day_before', v.id);
    }

    if (!v.reminded_day_of && v.preferred_date === today) {
      const sendFrom = new Date(Math.max(at(today, EARLIEST_DAY_OF_HOUR), at(today, w.start - HOURS_BEFORE_WINDOW)));
      if (now >= at(today, w.end)) {
        mark('reminded_day_of', v.id); // the window is over; a reminder now would be useless
      } else if (now >= sendFrom) {
        mark('reminded_day_of', v.id);
        notify.viewingReminder({ viewingId: v.id, when: 'today' });
        sent++;
      }
    }
  }
  return { checked: due.length, sent };
}

module.exports = { runViewingReminders };
