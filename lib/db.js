// Postgres storage. In production this is Netlify Database, reached through @netlify/database
// (see netlify/functions/api.js); DATABASE_URL points at any other Postgres. Locally and in tests,
// with no URL set, it uses PGlite: real Postgres running in-process, saved to a folder (or kept
// in memory), so nothing needs installing.
//
// Every connection exposes the same two calls:
//   await db.query(sql, params)  -> rows
//   await db.tx(async (q) => { await q(sql, params) ... })  -> runs in one transaction

const SCHEMA = require('./schema');

// Wraps any pg-compatible pool: pg.Pool, or the pool @netlify/database hands us in production.
function postgres(pool) {
  return {
    async query(sql, params = []) { return (await pool.query(sql, params)).rows; },
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async (sql, params = []) => (await client.query(sql, params)).rows);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function pglite(dir) {
  // Dev dependency, loaded only when there's no database URL. The name is in a variable so
  // Netlify's bundler doesn't pack it into the production function.
  const pkg = '@electric-sql/pglite';
  const { PGlite } = require(pkg);
  const db = dir ? new PGlite(dir) : new PGlite();
  return {
    async query(sql, params = []) { return (await db.query(sql, params)).rows; },
    async exec(sql) { await db.exec(sql); },
    async tx(fn) { return db.transaction((t) => fn(async (sql, params = []) => (await t.query(sql, params)).rows)); },
    close: () => db.close(),
  };
}

// open({ pool }) for an existing pool, open({ url }) for a Postgres URL,
// open({ dir }) for a local PGlite folder, open() for in-memory.
async function open({ pool, url, dir } = {}) {
  if (!pool && url) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, max: 3 });
  }
  const db = pool ? postgres(pool) : pglite(dir);
  await db.exec(SCHEMA);
  return db;
}

const databaseUrl = () => process.env.DATABASE_URL || '';

module.exports = { open, databaseUrl };
