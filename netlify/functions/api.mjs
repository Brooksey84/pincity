// Netlify Function serving every /api/* request.
// The database is Netlify Database: Netlify creates it, applies netlify/database/migrations on
// deploy, and gives this function its connection automatically. DATABASE_URL overrides it.
import { createRequire } from 'node:module';
import { getDatabase } from '@netlify/database';

const require = createRequire(import.meta.url);
const { open, databaseUrl } = require('../../lib/db');
const { ensureAdmin } = require('../../lib/auth');
const { createApp } = require('../../lib/app');
const { toWebHandler } = require('../../lib/web-handler');

// Set up once per warm function instance, not on every request.
let ready;
function init() {
  ready ??= (async () => {
    const url = databaseUrl();
    const db = await open(url ? { url } : { pool: getDatabase().pool });
    await ensureAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    return toWebHandler(createApp(db, {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      placesApiKey: process.env.GOOGLE_PLACES_API_KEY,
      secureCookies: true,
    }));
  })().catch((e) => { ready = undefined; throw e; });
  return ready;
}

export default async (request) => {
  try {
    const handle = await init();
    return await handle(request);
  } catch (e) {
    console.error(e);
    return Response.json({ error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/*' };
