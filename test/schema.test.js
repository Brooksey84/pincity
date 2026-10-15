const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MIGRATIONS } = require('../lib/schema');

test('lib/schema.js matches the Netlify migration files', () => {
  const dir = path.join(__dirname, '..', 'netlify', 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepStrictEqual(Object.keys(MIGRATIONS), files);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    // 0001 starts with a comment line that isn't copied.
    assert.strictEqual(MIGRATIONS[f], f === '0001_init.sql' ? sql.split('\n').slice(1).join('\n') : sql, f);
  }
});
