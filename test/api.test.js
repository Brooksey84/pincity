const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { open } = require('../lib/db');
const { ensureAdmin } = require('../lib/auth');
const { createApp } = require('../lib/app');

// Small cookie-keeping client per user.
function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

test('admin builds a city, user subscribes and downloads pins', async (t) => {
  // Set TEST_DATABASE_URL to run against a real Postgres server instead of in-memory PGlite.
  const db = await open({ url: process.env.TEST_DATABASE_URL });
  await ensureAdmin(db, 'admin@test', 'adminpass');
  const server = createApp(db, {}).listen(0);
  t.after(() => { server.close(); return db.close(); });
  const base = `http://localhost:${server.address().port}`;
  const admin = client(base);
  const user = client(base);

  assert.strictEqual((await admin('GET', '/api/admin/cities')).status, 401);
  assert.strictEqual((await admin('POST', '/api/auth/login', { email: 'admin@test', password: 'adminpass' })).status, 200);

  const city = (await admin('POST', '/api/admin/cities', { name: 'London', country: 'UK', lat: 51.51, lng: -0.12 })).data;
  assert.strictEqual(city.slug, 'london');
  const cats = (await admin('GET', '/api/admin/categories')).data;
  const food = cats.find((c) => c.slug === 'food');
  const drink = cats.find((c) => c.slug === 'drink');
  assert.ok(food.active && drink.active);
  assert.strictEqual(cats.find((c) => c.slug === 'museums').active, false);

  // Import a Takeout CSV: 2 located, 1 needs a location (no Places key in tests).
  const text = fs.readFileSync(path.join(__dirname, '..', 'samples', 'takeout-list.csv'), 'utf8');
  const preview = (await admin('POST', '/api/admin/import/preview', { text, filename: 'list.csv' })).data;
  assert.strictEqual(preview.items.length, 3);
  const report = (await admin('POST', '/api/admin/import/commit', {
    city_id: city.id, category_id: food.id, items: preview.items, team_reviewed: true, publish: true,
  })).data;
  assert.deepStrictEqual([report.added, report.needs_location, report.duplicates], [3, 1, 0]);

  // Re-importing is deduplicated.
  const again = (await admin('POST', '/api/admin/import/commit', { city_id: city.id, category_id: food.id, items: preview.items })).data;
  assert.strictEqual(again.duplicates, 3);

  // Fix the unlocated one by pasting coordinates; it moves to draft, then publish it.
  const needs = (await admin('GET', `/api/admin/places?status=needs_location`)).data;
  assert.strictEqual(needs.length, 1);
  assert.strictEqual((await admin('PATCH', `/api/admin/places/${needs[0].id}`, { status: 'published' })).status, 400);
  const fixed = (await admin('PATCH', `/api/admin/places/${needs[0].id}`, { location_input: '51.5112, -0.1360' })).data;
  assert.strictEqual(fixed.status, 'draft');
  await admin('POST', '/api/admin/places/bulk', { ids: [fixed.id], status: 'published' });

  // A bar added by hand.
  const bar = (await admin('POST', '/api/admin/places', {
    city_id: city.id, category_id: drink.id, name: 'Bar Test', location_input: 'https://www.google.com/maps/place/Bar/@51.52,-0.11,17z', status: 'published', team_note: 'Great',
  })).data;
  assert.strictEqual(bar.lat, 51.52);

  // Hidden city is invisible to the public.
  assert.strictEqual((await user('GET', '/api/cities')).data.length, 0);
  await admin('PATCH', `/api/admin/cities/${city.id}`, { published: true });
  const cities = (await user('GET', '/api/cities')).data;
  assert.deepStrictEqual(cities[0].counts, { food: 3, drink: 1 });

  // User signs up, subscribes to drinks only, downloads.
  assert.strictEqual((await user('PUT', '/api/me/subscriptions/london', { categories: ['drink'] })).status, 401);
  assert.strictEqual((await user('POST', '/api/auth/signup', { email: 'u@test.com', password: 'short' })).status, 400);
  assert.strictEqual((await user('POST', '/api/auth/signup', { email: 'U@Test.com', password: 'longenough' })).status, 200);
  assert.strictEqual((await user('POST', '/api/auth/signup', { email: 'u@test.com', password: 'longenough' })).status, 400, 'emails are case-insensitive');
  assert.strictEqual((await client(base)('POST', '/api/auth/login', { email: 'u@TEST.com', password: 'longenough' })).status, 200);
  assert.strictEqual((await user('GET', '/api/admin/stats')).status, 403);
  await user('PUT', '/api/me/subscriptions/london', { categories: ['drink'] });
  let dl = (await user('GET', '/api/me/download')).data;
  assert.strictEqual(dl.cities[0].pins.length, 1);
  assert.strictEqual(dl.cities[0].pins[0].name, 'Bar Test');

  await user('PUT', '/api/me/subscriptions/london', { categories: ['drink', 'food', 'museums'] });
  dl = (await user('GET', '/api/me/download')).data;
  assert.strictEqual(dl.cities[0].pins.length, 4, 'inactive categories are ignored');
  assert.deepStrictEqual(dl.cities[0].categories.sort(), ['drink', 'food']);
  assert.ok(dl.cities[0].pins.find((p) => p.name === 'Padella').team_reviewed);

  // KML export for Google My Maps.
  const kml = await user('GET', '/api/cities/london/export.kml?categories=food');
  assert.match(kml.headers.get('content-type'), /kml/);
  assert.strictEqual((kml.data.match(/<Placemark>/g) || []).length, 3);
  assert.match(kml.data, /<coordinates>-0\.090704,51\.505405,0<\/coordinates>/);

  // Unsubscribe.
  await user('PUT', '/api/me/subscriptions/london', { categories: [] });
  assert.strictEqual((await user('GET', '/api/me/download')).data.cities.length, 0);
});
