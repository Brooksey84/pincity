// Adds a demo city (London) with a handful of sample places so the app has something to show.
// The notes are placeholders, and nothing is marked team-reviewed: replace them with your own.
// Uses DATABASE_URL / NETLIFY_DATABASE_URL if set, otherwise the local data/pglite database.
const path = require('node:path');
const { open, databaseUrl } = require('../lib/db');
const { loadEnvFile } = require('../server');

const PLACES = [
  ['food', 'Dishoom Covent Garden', "12 Upper St Martin's Ln, London WC2H 9FB", 51.5124, -0.1268],
  ['food', 'Padella', '6 Southwark St, London SE1 1TQ', 51.5054, -0.0907],
  ['food', 'Kiln', '58 Brewer St, London W1F 9TL', 51.5112, -0.1360],
  ['drink', 'The Connaught Bar', 'Carlos Pl, London W1K 2AL', 51.5101, -0.1497],
  ['drink', 'Bar Termini', '7 Old Compton St, London W1D 5JE', 51.5132, -0.1300],
  ['drink', "Satan's Whiskers", '343 Cambridge Heath Rd, London E2 9RA', 51.5293, -0.0565],
];

(async () => {
  loadEnvFile(path.join(__dirname, '..', '.env'));
  const db = await open({ url: databaseUrl(), dir: path.resolve(__dirname, '..', process.env.PGLITE_DIR || 'data/pglite') });
  await db.query(`INSERT INTO cities (slug, name, country, lat, lng, zoom, description, published)
    VALUES ('london', 'London', 'United Kingdom', 51.5115, -0.1160, 13, 'Demo city', true) ON CONFLICT (slug) DO NOTHING`);
  const [city] = await db.query("SELECT id FROM cities WHERE slug = 'london'");
  let added = 0;
  for (const [cat, name, address, lat, lng] of PLACES) {
    const rows = await db.query(
      `INSERT INTO places (city_id, category_id, name, address, lat, lng, team_note, status, source)
       SELECT $1, (SELECT id FROM categories WHERE slug = $2), $3, $4, $5, $6, 'Sample note: replace with your team review.', 'published', 'demo'
       WHERE NOT EXISTS (SELECT 1 FROM places WHERE city_id = $1 AND name = $3) RETURNING id`,
      [city.id, cat, name, address, lat, lng]
    );
    added += rows.length;
  }
  console.log(`Demo city London ready (${added} places added).`);
  await db.close();
})();
