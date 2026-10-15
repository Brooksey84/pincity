const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseImport, parseGoogleMapsUrl } = require('../lib/importers');

const sample = (f) => fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8');

test('Google Maps URLs: pin coordinates win over the viewport centre', () => {
  const u = parseGoogleMapsUrl('https://www.google.com/maps/place/Padella/@51.6,-0.2,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.505405!4d-0.090704');
  assert.deepStrictEqual([u.lat, u.lng, u.name], [51.505405, -0.090704, 'Padella']);
});

test('Google Maps URLs: feature id becomes a stable cid link', () => {
  const u = parseGoogleMapsUrl('https://www.google.com/maps/place/Kiln/data=!4m2!3m1!1s0x487604d3a0b0b0b1:0x2c6a4b1f0e5d7a91');
  assert.strictEqual(u.cid, BigInt('0x2c6a4b1f0e5d7a91').toString());
  assert.strictEqual(u.lat, null);
});

test('Takeout list CSV', () => {
  const { format, items } = parseImport(sample('takeout-list.csv'), 'Want to go.csv');
  assert.strictEqual(format, 'csv');
  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[0].name, 'Padella');
  assert.strictEqual(items[0].note, 'Go before 12 to skip the queue');
  assert.strictEqual(items[0].lat, 51.505405);
  assert.strictEqual(items[1].lat, null, 'Takeout rows without coordinates stay unlocated');
  assert.match(items[1].google_maps_url, /^https:\/\/maps\.google\.com\/\?cid=\d+$/);
  assert.strictEqual(items[1].note, 'Counter seats, get the clay pot glass noodles');
  assert.deepStrictEqual([items[2].lat, items[2].lng], [51.5132, -0.13]);
});

test('My Maps KML', () => {
  const { format, items } = parseImport(sample('my-maps-export.kml'), 'x.kml');
  assert.strictEqual(format, 'kml');
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual([items[0].name, items[0].lat, items[0].lng, items[0].note], ['The Connaught Bar', 51.5101, -0.1497, 'Martini trolley.']);
  assert.strictEqual(items[1].name, "Satan's Whiskers");
  assert.strictEqual(items[1].lat, 51.5293);
});

test('Takeout Saved Places GeoJSON, treating [0,0] as missing', () => {
  const { format, items } = parseImport(sample('saved-places.json'), 'Saved Places.json');
  assert.strictEqual(format, 'geojson');
  assert.strictEqual(items[0].name, 'Dishoom Covent Garden');
  assert.deepStrictEqual([items[0].lat, items[0].lng], [51.5124, -0.1268]);
  assert.strictEqual(items[0].google_maps_url, 'https://maps.google.com/?cid=1234567890');
  assert.strictEqual(items[1].lat, null);
});

test('Pasted links', () => {
  const { format, items } = parseImport('https://www.google.com/maps/place/Foo+Bar/@1.5,2.5,15z\nnot a link\n', '');
  assert.strictEqual(format, 'urls');
  assert.deepStrictEqual([items.length, items[0].name, items[0].lat], [1, 'Foo Bar', 1.5]);
});
