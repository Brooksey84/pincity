// The list response format is Google's own and undocumented; this fixture mirrors its shape.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractListId, resolveListId, parseListResponse, fetchGoogleList } = require('../lib/google-list');

const sample = fs.readFileSync(path.join(__dirname, '..', 'samples', 'google-list-response.txt'), 'utf8');

test('list ids from full Google Maps list URLs', () => {
  assert.strictEqual(extractListId('https://www.google.com/maps/@51.5,-0.1,13z/data=!3m1!4b1!4m3!11m2!2sAbCdEfGhIjKlMnOp_qr!3e3?entry=tts'), 'AbCdEfGhIjKlMnOp_qr');
  assert.strictEqual(extractListId('https://www.google.com/maps/placelists/list/AbCdEfGhIjKlMnOp'), 'AbCdEfGhIjKlMnOp');
  assert.strictEqual(extractListId('https://www.google.com/maps/place/Padella/@51.5,-0.09,17z'), null);
});

test('short share links are followed to the list', async () => {
  const fake = async (url) => ({
    ok: true,
    headers: new Headers(url.includes('goo.gl') ? { location: 'https://www.google.com/maps/@51.5,-0.1,13z/data=!4m3!11m2!2sLIST1234567890!3e3' } : {}),
    text: async () => '',
  });
  assert.strictEqual(await resolveListId('https://maps.app.goo.gl/xyz', fake), 'LIST1234567890');
  await assert.rejects(resolveListId('not a link', fake), /full link/);
});

test('parses places, coordinates and notes from a list response', () => {
  const { title, items } = parseListResponse(sample);
  assert.strictEqual(title, 'London favourites');
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items[0], {
    name: 'Padella', address: '6 Southwark St, London SE1 1TQ', lat: 51.505405, lng: -0.090704, note: 'Get the pici',
    google_maps_url: `https://maps.google.com/?cid=${BigInt('0x2c6a4b1f0e5d7a91')}`, google_place_id: null,
  });
  assert.strictEqual(items[1].name, 'Kiln');
});

test('fetchGoogleList end to end with a fake Google', async () => {
  const fake = async (url) => {
    if (url.includes('goo.gl')) return { ok: true, headers: new Headers({ location: 'https://www.google.com/maps/placelists/list/LIST1234567890' }) };
    assert.match(url, /getlist.*!1sLIST1234567890!/);
    return { ok: true, headers: new Headers(), text: async () => sample };
  };
  const list = await fetchGoogleList('https://maps.app.goo.gl/xyz', fake);
  assert.strictEqual(list.items.length, 2);
  const broken = async (url) => (url.includes('goo.gl')
    ? { ok: true, headers: new Headers({ location: 'https://www.google.com/maps/placelists/list/LIST1234567890' }) }
    : { ok: true, headers: new Headers(), text: async () => '<html>consent</html>' });
  await assert.rejects(fetchGoogleList('https://maps.app.goo.gl/xyz', broken), /Takeout/);
});
