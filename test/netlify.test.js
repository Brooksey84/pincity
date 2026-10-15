// The Express app behind serverless-http, called the way Netlify calls the function.
const test = require('node:test');
const assert = require('node:assert');
const serverless = require('serverless-http');
const { open } = require('../lib/db');
const { ensureAdmin } = require('../lib/auth');
const { createApp } = require('../lib/app');

test('works as a Netlify function, under either path', async (t) => {
  const db = await open();
  t.after(() => db.close());
  await ensureAdmin(db, 'admin@test', 'adminpass');
  const handler = serverless(createApp(db, { secureCookies: true }));
  const call = (path, extra = {}) => handler({ path, httpMethod: 'GET', headers: {}, queryStringParameters: null, body: null, isBase64Encoded: false, ...extra }, {});

  const cats = await call('/api/categories');
  assert.strictEqual(cats.statusCode, 200);
  assert.strictEqual(JSON.parse(cats.body).length, 2);
  assert.strictEqual((await call('/.netlify/functions/api/categories')).statusCode, 200);

  const login = await call('/api/auth/login', {
    httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test', password: 'adminpass' }),
  });
  assert.strictEqual(login.statusCode, 200);
  const cookie = (login.multiValueHeaders?.['set-cookie'] || [login.headers['set-cookie']])[0];
  assert.match(cookie, /HttpOnly.*Secure/);
  const stats = await call('/api/admin/stats', { headers: { cookie: cookie.split(';')[0] } });
  assert.strictEqual(stats.statusCode, 200);
  assert.strictEqual(JSON.parse(stats.body).cities, 0);
});
