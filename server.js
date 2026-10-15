// Runs Pin City locally: the API plus the app (/) and admin (/admin) pages.
// With no DATABASE_URL it keeps data in a local Postgres folder (data/pglite) via PGlite.
const path = require('node:path');
const fs = require('node:fs');
const { open, databaseUrl } = require('./lib/db');
const { ensureAdmin } = require('./lib/auth');
const { createApp } = require('./lib/app');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnvFile(path.join(__dirname, '.env'));
  const db = await open({ url: databaseUrl(), dir: path.resolve(__dirname, process.env.PGLITE_DIR || 'data/pglite') });
  await ensureAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const app = createApp(db, {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    placesApiKey: process.env.GOOGLE_PLACES_API_KEY,
    secureCookies: process.env.NODE_ENV === 'production',
    serveStatic: true,
  });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Pin City running: app http://localhost:${port}  admin http://localhost:${port}/admin`));
}

if (require.main === module) main();

module.exports = { loadEnvFile };
