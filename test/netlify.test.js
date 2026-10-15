// The Express app behind the Netlify Function adapter, called with Web Requests the way Netlify does.
const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../lib/db');
const { ensureAdmin } = require('../lib/auth');
const { createApp } = require('../lib/app');
const { toWebHandler } = require('../lib/web-handler');

test('works as a Netlify Function', async (t) => {
  const db = await open();
  t.after(() => db.close());
  await ensureAdmin(db, 'admin@test', 'adminpass');
  const handle = toWebHandler(createApp(db, { secureCookies: true }));
  const call = (path, init) => handle(new Request(`https://pincity.netlify.app${path}`, init));

  const cats = await call('/api/categories');
  assert.strictEqual(cats.status, 200);
  assert.strictEqual((await cats.json()).length, 15);

  const login = await call('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test', password: 'adminpass' }),
  });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly.*Secure/);
  const stats = await call('/api/admin/stats', { headers: { cookie: cookie.split(';')[0] } });
  assert.strictEqual(stats.status, 200);
  assert.strictEqual((await stats.json()).cities, 0);

  const city = await call('/api/admin/cities', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie.split(';')[0] },
    body: JSON.stringify({ name: 'Lisbon', lat: 38.7, lng: -9.1, published: true }),
  });
  assert.strictEqual(city.status, 200);
  const kml = await call('/api/cities/lisbon/export.kml?categories=food');
  assert.match(kml.headers.get('content-type'), /kml/);
  assert.match(await kml.text(), /Pin City · Lisbon/);
});
