// Netlify Function serving every /api/* request (see the redirect in netlify.toml).
// The database is Netlify Database, which Netlify creates and migrates on deploy
// (schema in netlify/database/migrations). DATABASE_URL overrides it with any other Postgres.
const serverless = require('serverless-http');
const { getDatabase } = require('@netlify/database');
const { open, databaseUrl } = require('../../lib/db');
const { ensureAdmin } = require('../../lib/auth');
const { createApp } = require('../../lib/app');

// Set up once per warm function instance, not on every request.
let ready;
function init() {
  ready ??= (async () => {
    const url = databaseUrl();
    const db = await open(url ? { url } : { pool: getDatabase().pool });
    await ensureAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    return serverless(createApp(db, {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      placesApiKey: process.env.GOOGLE_PLACES_API_KEY,
      secureCookies: true,
    }));
  })().catch((e) => { ready = undefined; throw e; });
  return ready;
}

exports.handler = async (event, context) => {
  try {
    const handle = await init();
    return await handle(event, context);
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
