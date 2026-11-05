const config = require('./src/config');
const db = require('./src/db').open();
const { createApp } = require('./src/app');
const { ensureAdminFromEnv } = require('./scripts/create-admin');

ensureAdminFromEnv(db);

// Clear expired sessions hourly.
const cleanup = () => db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
cleanup();
setInterval(cleanup, 3600e3).unref();

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.log(`${config.siteName} running on ${config.baseUrl} (${config.env})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
