// Loads settings from a .env file in the project folder, if there is one.
// Settings already set in the environment (e.g. on Render) take priority over the file.
// Only server.js and the scripts call this; tests never read your .env.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
