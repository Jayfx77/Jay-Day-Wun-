// Deletes the local database and uploaded files so you can start fresh.
// Usage: npm run reset            (then "npm run seed" for demo data)
require('../src/loadEnv');
const fs = require('fs');
const config = require('../src/config');

if (config.isProd) {
  console.error('Refusing to reset: NODE_ENV is "production". This command is only for your own laptop.');
  process.exit(1);
}
const db = config.dbFile;
for (const p of [db, `${db}-wal`, `${db}-shm`, config.uploadDir, config.privateDir]) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`Deleted ${p}`);
  }
}
console.log('Local data cleared. Run "npm run seed" for demo data, then "npm run dev".');
