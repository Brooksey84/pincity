// The Pin City API as an Express app. server.js runs it locally; netlify/functions/api.js runs it on Netlify.
const path = require('node:path');
const express = require('express');
const auth = require('./auth');
const { parseImport, parseGoogleMapsUrl } = require('./importers');
const { fetchGoogleList } = require('./google-list');
const { findPlace } = require('./geocode');
const { toKml } = require('./kml');

const slugify = (s) =>
  String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

// Accepts "lat, lng" or any Google Maps link that carries coordinates.
function parseLocationInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  const info = parseGoogleMapsUrl(s);
  return info.lat !== null ? { lat: info.lat, lng: info.lng } : null;
}

// Builds "SET a = $2, b = $3" (or column/value lists) from an object, numbering after `offset`.
const setClause = (obj, offset = 0) => Object.keys(obj).map((k, i) => `${k} = $${i + 1 + offset}`).join(', ');

const PLACE_FIELDS = ['name', 'address', 'lat', 'lng', 'google_place_id', 'google_maps_url', 'website', 'team_note',
  'team_reviewed', 'visited_on', 'price_level', 'status', 'category_id', 'city_id'];
const STATUSES = ['published', 'draft', 'needs_location'];
const CITY_PUBLIC = 'id, slug, name, country, lat, lng, zoom, description';

// Run fn over items with at most `limit` running at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function createApp(db, config = {}) {
  const app = express();
  app.disable('x-powered-by');
  // On Netlify the function can be reached under its own path; normalise back to /api/...
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api');
    next();
  });
  // serverless-http hands Express the body as a Buffer already, so parse that ourselves.
  app.use((req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8');
      try { req.body = /json/.test(req.headers['content-type'] || '') && text ? JSON.parse(text) : {}; } catch { return next(new HttpError(400, 'Invalid JSON.')); }
    }
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(auth.loadUser(db));

  const categoriesAll = () => db.query('SELECT * FROM categories ORDER BY sort_order, id');
  const categoriesActive = async () => (await categoriesAll()).filter((c) => c.active);
  const cityBySlug = async (slug, publishedOnly = true) =>
    (await db.query(`SELECT * FROM cities WHERE slug = $1${publishedOnly ? ' AND published' : ''}`, [slug]))[0];
  // No filter given means every live category; an empty list means none.
  const catIdsFromSlugs = async (slugs) => {
    const active = await categoriesActive();
    if (slugs === undefined || slugs === null) return active.map((c) => c.id);
    const wanted = (Array.isArray(slugs) ? slugs : String(slugs).split(',')).map((s) => String(s).trim()).filter(Boolean);
    return active.filter((c) => wanted.includes(c.slug)).map((c) => c.id);
  };
  const publicPin = (p) => ({
    id: p.id, city_id: p.city_id, category_id: p.category_id, name: p.name, address: p.address, lat: p.lat, lng: p.lng,
    google_place_id: p.google_place_id, google_maps_url: p.google_maps_url, website: p.website, team_note: p.team_note,
    team_reviewed: p.team_reviewed, visited_on: p.visited_on, price_level: p.price_level, updated_at: p.updated_at,
  });
  const pinsFor = async (cityId, catIds) => {
    if (!catIds.length) return [];
    const rows = await db.query(
      `SELECT * FROM places WHERE city_id = $1 AND status = 'published' AND lat IS NOT NULL
       AND category_id = ANY($2::int[]) ORDER BY name`,
      [cityId, catIds]
    );
    return rows.map(publicPin);
  };

  // ---------- public ----------
  app.get('/api/config', (_req, res) => res.json({ googleMapsApiKey: config.googleMapsApiKey || '' }));

  app.post('/api/auth/signup', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Enter a valid email address.');
    if (!password || password.length < 8) bad('Password must be at least 8 characters.');
    if ((await db.query('SELECT 1 FROM users WHERE email = $1', [email])).length) bad('An account with that email already exists.');
    const [user] = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, is_admin',
      [email, auth.hashPassword(password)]
    );
    await auth.createSession(db, res, user.id, config.secureCookies);
    res.json(user);
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const [user] = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !auth.verifyPassword(req.body?.password || '', user.password_hash)) throw new HttpError(401, 'Wrong email or password.');
    await auth.createSession(db, res, user.id, config.secureCookies);
    res.json({ id: user.id, email: user.email, is_admin: user.is_admin });
  });

  app.post('/api/auth/logout', async (req, res) => { await auth.destroySession(db, req, res); res.json({ ok: true }); });
  app.get('/api/auth/me', (req, res) => res.json(req.user || null));

  app.get('/api/categories', async (_req, res) => res.json(await categoriesActive()));

  app.get('/api/cities', async (_req, res) => {
    const cities = await db.query(`SELECT ${CITY_PUBLIC} FROM cities WHERE published ORDER BY name`);
    const counts = await db.query(
      `SELECT p.city_id, c.slug, COUNT(*)::int AS n FROM places p JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'published' AND p.lat IS NOT NULL AND c.active GROUP BY p.city_id, c.slug`
    );
    for (const city of cities) {
      city.counts = Object.fromEntries(counts.filter((r) => r.city_id === city.id).map((r) => [r.slug, r.n]));
    }
    res.json(cities);
  });

  app.get('/api/cities/:slug/pins', async (req, res) => {
    const city = await cityBySlug(req.params.slug);
    if (!city) throw new HttpError(404, 'City not found.');
    res.json({ city, pins: await pinsFor(city.id, await catIdsFromSlugs(req.query.categories)) });
  });

  app.get('/api/cities/:slug/export.kml', async (req, res) => {
    const city = await cityBySlug(req.params.slug);
    if (!city) throw new HttpError(404, 'City not found.');
    const catIds = await catIdsFromSlugs(req.query.categories);
    const categories = (await categoriesActive()).filter((c) => catIds.includes(c.id));
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pin-city-${city.slug}.kml"`);
    res.send(toKml({ city, categories, places: await pinsFor(city.id, catIds) }));
  });

  // ---------- signed-in user ----------
  const subscriptionsOf = async (userId) => {
    const rows = await db.query(
      `SELECT ci.id AS city_id, ci.slug AS city_slug, c.slug AS cat_slug FROM subscriptions s
       JOIN cities ci ON ci.id = s.city_id JOIN categories c ON c.id = s.category_id
       WHERE s.user_id = $1 AND ci.published AND c.active ORDER BY ci.name, c.sort_order`,
      [userId]
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.city_slug)) map.set(r.city_slug, { city_id: r.city_id, city_slug: r.city_slug, categories: [] });
      map.get(r.city_slug).categories.push(r.cat_slug);
    }
    return [...map.values()];
  };

  app.get('/api/me/subscriptions', auth.requireUser, async (req, res) => res.json(await subscriptionsOf(req.user.id)));

  // Replace the category set for one city; an empty list unsubscribes.
  app.put('/api/me/subscriptions/:slug', auth.requireUser, async (req, res) => {
    const city = await cityBySlug(req.params.slug);
    if (!city) throw new HttpError(404, 'City not found.');
    const slugs = Array.isArray(req.body?.categories) ? req.body.categories : bad('categories must be a list.');
    const catIds = await catIdsFromSlugs(slugs);
    await db.tx(async (q) => {
      await q('DELETE FROM subscriptions WHERE user_id = $1 AND city_id = $2', [req.user.id, city.id]);
      for (const id of catIds) {
        await q('INSERT INTO subscriptions (user_id, city_id, category_id) VALUES ($1, $2, $3)', [req.user.id, city.id, id]);
      }
    });
    res.json(await subscriptionsOf(req.user.id));
  });

  // The offline bundle: every pin the user is subscribed to, which the app stores on the device.
  app.get('/api/me/download', auth.requireUser, async (req, res) => {
    const subs = await subscriptionsOf(req.user.id);
    const cities = [];
    for (const s of subs) {
      const [city] = await db.query(`SELECT ${CITY_PUBLIC} FROM cities WHERE id = $1`, [s.city_id]);
      cities.push({ ...city, categories: s.categories, pins: await pinsFor(s.city_id, await catIdsFromSlugs(s.categories)) });
    }
    res.json({ downloaded_at: new Date().toISOString(), categories: await categoriesActive(), cities });
  });

  // ---------- admin ----------
  const admin = express.Router();
  admin.use(auth.requireAdmin);

  admin.get('/stats', async (_req, res) => {
    const [s] = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM cities) AS cities,
      (SELECT COUNT(*)::int FROM places WHERE status = 'published') AS published_places,
      (SELECT COUNT(*)::int FROM places WHERE status = 'draft') AS draft_places,
      (SELECT COUNT(*)::int FROM places WHERE status = 'needs_location') AS needs_location,
      (SELECT COUNT(*)::int FROM users WHERE NOT is_admin) AS users,
      (SELECT COUNT(DISTINCT user_id)::int FROM subscriptions) AS subscribers`);
    res.json(s);
  });

  admin.get('/categories', async (_req, res) => res.json(await categoriesAll()));
  admin.post('/categories', async (req, res) => {
    const { name, icon = '📍', color = '#e4572e', active = false } = req.body || {};
    if (!name) bad('Name is required.');
    const slug = slugify(req.body.slug || name);
    if ((await db.query('SELECT 1 FROM categories WHERE slug = $1', [slug])).length) bad('That category already exists.');
    await db.query(
      `INSERT INTO categories (slug, name, icon, color, sort_order, active)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), $5)`,
      [slug, name, icon, color, !!active]
    );
    res.json(await categoriesAll());
  });
  admin.patch('/categories/:id', async (req, res) => {
    const set = {};
    for (const f of ['name', 'icon', 'color', 'sort_order', 'active']) if (f in (req.body || {})) set[f] = f === 'active' ? !!req.body[f] : req.body[f];
    if (Object.keys(set).length) {
      await db.query(`UPDATE categories SET ${setClause(set, 1)} WHERE id = $1`, [req.params.id, ...Object.values(set)]);
    }
    res.json(await categoriesAll());
  });

  admin.get('/cities', async (_req, res) => {
    res.json(await db.query(`SELECT ci.*,
        (SELECT COUNT(*)::int FROM places p WHERE p.city_id = ci.id AND p.status = 'published') AS published_places,
        (SELECT COUNT(*)::int FROM places p WHERE p.city_id = ci.id) AS total_places,
        (SELECT COUNT(DISTINCT user_id)::int FROM subscriptions s WHERE s.city_id = ci.id) AS subscribers
      FROM cities ci ORDER BY ci.name`));
  });
  admin.post('/cities', async (req, res) => {
    const { name, country = '', lat, lng, zoom = 13, description = '', published = false } = req.body || {};
    if (!name) bad('Name is required.');
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) bad('Map centre (lat, lng) is required.');
    const slug = slugify(req.body.slug || name);
    if ((await db.query('SELECT 1 FROM cities WHERE slug = $1', [slug])).length) bad('A city with that name already exists.');
    const [city] = await db.query(
      `INSERT INTO cities (slug, name, country, lat, lng, zoom, description, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [slug, name, country, Number(lat), Number(lng), Number(zoom), description, !!published]
    );
    res.json(city);
  });
  admin.patch('/cities/:id', async (req, res) => {
    const set = {};
    for (const f of ['name', 'country', 'lat', 'lng', 'zoom', 'description', 'published']) if (f in (req.body || {})) set[f] = f === 'published' ? !!req.body[f] : req.body[f];
    if (Object.keys(set).length) {
      await db.query(`UPDATE cities SET ${setClause(set, 1)}, updated_at = now() WHERE id = $1`, [req.params.id, ...Object.values(set)]);
    }
    res.json((await db.query('SELECT * FROM cities WHERE id = $1', [req.params.id]))[0]);
  });
  admin.delete('/cities/:id', async (req, res) => {
    await db.query('DELETE FROM cities WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  admin.get('/places', async (req, res) => {
    const where = [];
    const args = [];
    for (const f of ['city_id', 'category_id', 'status']) {
      if (req.query[f]) { args.push(req.query[f]); where.push(`p.${f} = $${args.length}`); }
    }
    if (req.query.q) { args.push(`%${req.query.q}%`); where.push(`(p.name ILIKE $${args.length} OR p.address ILIKE $${args.length})`); }
    res.json(await db.query(`SELECT p.* FROM places p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE p.status WHEN 'needs_location' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, p.name`, args));
  });

  function normalisePlace(body, existing = {}) {
    const p = {};
    for (const f of PLACE_FIELDS) if (f in body) p[f] = body[f] === '' && ['lat', 'lng', 'price_level', 'visited_on'].includes(f) ? null : body[f];
    if ('location_input' in body && String(body.location_input).trim()) {
      const loc = parseLocationInput(body.location_input);
      if (!loc) bad('Could not read a location. Paste "lat, lng" or a Google Maps link that includes coordinates.');
      Object.assign(p, loc);
      const info = parseGoogleMapsUrl(body.location_input);
      if (info.google_place_id && !existing.google_place_id) p.google_place_id = info.google_place_id;
    }
    if ('team_reviewed' in p) p.team_reviewed = !!p.team_reviewed;
    if ('status' in p && !STATUSES.includes(p.status)) bad('Unknown status.');
    const merged = { ...existing, ...p };
    if (!merged.name) bad('Name is required.');
    if (merged.status === 'published' && (merged.lat == null || merged.lng == null)) bad('Add a location before publishing.');
    // A place that just got coordinates is no longer waiting on a location.
    if (merged.status === 'needs_location' && merged.lat != null && !('status' in body)) p.status = 'draft';
    return p;
  }

  admin.post('/places', async (req, res) => {
    const body = req.body || {};
    if (!body.city_id || !body.category_id) bad('City and category are required.');
    const p = normalisePlace(body, { status: 'draft' });
    if (!('status' in p)) p.status = p.lat != null ? 'draft' : 'needs_location';
    if (p.google_place_id) {
      const [dupe] = await db.query('SELECT id, name FROM places WHERE city_id = $1 AND google_place_id = $2', [p.city_id, p.google_place_id]);
      if (dupe) throw new HttpError(409, `${dupe.name} is already in this city.`);
    }
    const keys = Object.keys(p);
    const [place] = await db.query(
      `INSERT INTO places (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      keys.map((k) => p[k] ?? null)
    );
    res.json(place);
  });
  admin.patch('/places/:id', async (req, res) => {
    const [existing] = await db.query('SELECT * FROM places WHERE id = $1', [req.params.id]);
    if (!existing) throw new HttpError(404, 'Place not found.');
    const p = normalisePlace(req.body || {}, existing);
    if (Object.keys(p).length) {
      await db.query(`UPDATE places SET ${setClause(p, 1)}, updated_at = now() WHERE id = $1`,
        [req.params.id, ...Object.values(p).map((v) => v ?? null)]);
    }
    res.json((await db.query('SELECT * FROM places WHERE id = $1', [req.params.id]))[0]);
  });
  admin.post('/places/bulk', async (req, res) => {
    const { ids = [], status, category_id, team_reviewed } = req.body || {};
    if (!ids.length) bad('Select some places first.');
    const set = {};
    if (status) { if (!STATUSES.includes(status)) bad('Unknown status.'); set.status = status; }
    if (category_id) set.category_id = category_id;
    if (team_reviewed !== undefined) set.team_reviewed = !!team_reviewed;
    if (!Object.keys(set).length) return res.json({ updated: 0, skipped: 0 });
    // Places without coordinates can't be published, so they're left alone.
    const rows = await db.query(
      `UPDATE places SET ${setClause(set, 1)}, updated_at = now()
       WHERE id = ANY($1::int[]) ${status === 'published' ? 'AND lat IS NOT NULL' : ''} RETURNING id`,
      [ids, ...Object.values(set)]
    );
    res.json({ updated: rows.length, skipped: ids.length - rows.length });
  });
  admin.delete('/places/:id', async (req, res) => {
    await db.query('DELETE FROM places WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // Step 1 of an import: parse the file and show the admin what was found.
  admin.post('/import/preview', (req, res) => {
    const { text, filename = '' } = req.body || {};
    if (!text) bad('Choose a file or paste some links first.');
    let parsed;
    try { parsed = parseImport(text, filename); } catch (e) { bad(`Could not read that file: ${e.message}`); }
    res.json({ ...parsed, geocoding_available: !!config.placesApiKey });
  });

  // Alternative step 1: read a shared Google Maps list straight from its link.
  admin.post('/import/google-list', async (req, res) => {
    const { url } = req.body || {};
    if (!url) bad('Paste the link to a shared Google Maps list.');
    let list;
    try { list = await (config.fetchGoogleList || fetchGoogleList)(url); } catch (e) { bad(e.message); }
    res.json({ format: 'google-list', title: list.title, items: list.items, geocoding_available: !!config.placesApiKey });
  });

  // Step 2: save the reviewed rows into a city + category, finding coordinates where needed.
  // The admin page sends big lists in batches so each request stays well inside serverless time limits.
  admin.post('/import/commit', async (req, res) => {
    const { city_id, category_id, items = [], team_reviewed = false, publish = false } = req.body || {};
    const [city] = await db.query('SELECT * FROM cities WHERE id = $1', [city_id]);
    if (!city) bad('Pick a city.');
    if (!(await db.query('SELECT 1 FROM categories WHERE id = $1', [category_id])).length) bad('Pick a category.');
    if (!items.length) bad('Nothing to import.');
    if (items.length > 100) bad('Send at most 100 places at a time.');

    const report = { added: 0, duplicates: 0, located: 0, needs_location: 0, geocode_errors: [] };
    const prepared = await mapLimit(items, 5, async (raw) => {
      const item = { ...raw };
      if ((item.lat == null || item.lng == null) && config.placesApiKey) {
        try {
          const found = await findPlace({ ...item, cityName: `${city.name} ${city.country}`.trim() }, config.placesApiKey);
          if (found) {
            Object.assign(item, {
              lat: found.lat, lng: found.lng,
              address: item.address || found.address,
              website: found.website,
              google_place_id: item.google_place_id || found.google_place_id,
              google_maps_url: item.google_maps_url || found.google_maps_url,
            });
            report.located++;
          }
        } catch (e) {
          if (report.geocode_errors.length < 5) report.geocode_errors.push(`${item.name}: ${e.message}`);
        }
      }
      return item;
    });

    await db.tx(async (q) => {
      for (const i of prepared) {
        if (!i.name) continue;
        const dupe = await q(
          `SELECT 1 FROM places WHERE city_id = $1 AND ((google_place_id IS NOT NULL AND google_place_id = $2)
           OR (google_maps_url <> '' AND google_maps_url = $3) OR lower(name) = lower($4)) LIMIT 1`,
          [city.id, i.google_place_id ?? null, i.google_maps_url || '', i.name]
        );
        if (dupe.length) { report.duplicates++; continue; }
        const hasLoc = i.lat != null && i.lng != null;
        if (!hasLoc) report.needs_location++;
        await q(
          `INSERT INTO places (city_id, category_id, name, address, lat, lng, google_place_id, google_maps_url, website,
           team_note, team_reviewed, status, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'import')`,
          [city.id, category_id, i.name, i.address || '', hasLoc ? i.lat : null, hasLoc ? i.lng : null, i.google_place_id ?? null,
            i.google_maps_url || '', i.website || '', i.note || '', !!team_reviewed, hasLoc ? (publish ? 'published' : 'draft') : 'needs_location']
        );
        report.added++;
      }
    });
    res.json(report);
  });

  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- pages (local only; on Netlify the CDN serves public/) ----------
  if (config.serveStatic) {
    app.use('/vendor/leaflet', express.static(path.join(path.dirname(require.resolve('leaflet/package.json')), 'dist')));
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
  });
  return app;
}

module.exports = { createApp, slugify, parseLocationInput };
