const config = require('./src/config');
const db = require('./src/db').open();
const { createApp } = require('./src/app');
const { ensureAdminFromEnv } = require('./scripts/create-admin');
const { runSavedSearchAlerts } = require('./src/jobs/savedSearchAlerts');

ensureAdminFromEnv(db);

// Clear expired sessions hourly.
const cleanup = () => db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
cleanup();
setInterval(cleanup, 3600e3).unref();

const app = createApp(db);

// Email saved-search matches every 10 minutes (daily digests go out from 7am GMT).
const alerts = () => {
  try {
    const r = runSavedSearchAlerts(db, app.locals.ctx);
    if (r.emailed || r.texted) console.log(`Saved-search alerts: ${r.emailed} emailed, ${r.texted} texted (${r.checked} searches)`);
  } catch (err) { console.error('Saved-search alerts failed:', err); }
};
setTimeout(alerts, 60e3).unref();
setInterval(alerts, 10 * 60e3).unref();
const server = app.listen(config.port, () => {
  console.log(`${config.siteName} running on ${config.baseUrl} (${config.env})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
