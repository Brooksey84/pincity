const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the Netlify migration matches lib/schema.js', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'database', 'migrations', '0001_init.sql'), 'utf8');
  assert.strictEqual(migration.split('\n').slice(1).join('\n'), require('../lib/schema'));
});
