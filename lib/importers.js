// Parsers for the ways a curated Google Maps list can leave Google:
//  - Google Takeout "Saved" list CSV (one CSV per list: Title, Note, URL, Tags, Comment)
//  - Google Takeout "Saved Places.json" (starred places, GeoJSON)
//  - KML/KMZ-extracted KML from Google My Maps ("Export to KML")
//  - A plain paste of Google Maps links, one per line
// Every parser returns the same shape:
//   { name, address, lat, lng, note, google_maps_url, google_place_id }
// lat/lng are null when the source carries no coordinates (Takeout list CSVs don't);
// those rows are geocoded or flagged for an admin to place.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const validCoord = (lat, lng) =>
  lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

// Pull whatever a Google Maps URL tells us: coordinates, place id, a stable cid link, a name.
function parseGoogleMapsUrl(url) {
  const out = { lat: null, lng: null, google_place_id: null, cid: null, name: null };
  if (!url) return out;
  let m;
  // !3d/!4d is the place's own pin; @lat,lng is only the viewport centre, so it comes second.
  if ((m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/))) {
    out.lat = num(m[1]); out.lng = num(m[2]);
  } else if ((m = url.match(/[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i))) {
    out.lat = num(m[1]); out.lng = num(m[2]);
  } else if ((m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/))) {
    out.lat = num(m[1]); out.lng = num(m[2]);
  }
  if (!validCoord(out.lat, out.lng)) { out.lat = null; out.lng = null; }

  if ((m = url.match(/[?&](?:query_place_id|place_id)=([A-Za-z0-9_-]+)/))) out.google_place_id = m[1];
  else if ((m = url.match(/!1s(ChIJ[A-Za-z0-9_-]+)/))) out.google_place_id = m[1];

  // Feature ids look like 0x<hex>:0x<hex>; the second half is the place's CID.
  if ((m = url.match(/0x[0-9a-f]+:0x([0-9a-f]+)/i))) {
    try { out.cid = BigInt('0x' + m[1]).toString(); } catch { /* ignore */ }
  } else if ((m = url.match(/[?&]cid=(\d+)/))) out.cid = m[1];

  if ((m = url.match(/\/maps\/place\/([^/@?]+)/))) {
    try { out.name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch { out.name = m[1]; }
  }
  return out;
}

function fromUrl(url, extra = {}) {
  const info = parseGoogleMapsUrl(url);
  return {
    name: (extra.name || info.name || '').trim(),
    address: (extra.address || '').trim(),
    lat: extra.lat ?? info.lat,
    lng: extra.lng ?? info.lng,
    note: (extra.note || '').trim(),
    google_maps_url: info.cid ? `https://maps.google.com/?cid=${info.cid}` : (url || '').trim(),
    google_place_id: info.google_place_id,
  };
}

function parseTakeoutCsv(text) {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.map((c) => c.trim().toLowerCase()).includes('url'));
  if (headerIdx === -1) throw new Error('CSV has no URL column. Expected a Google Takeout saved-list CSV.');
  const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (r, name) => {
    const i = header.indexOf(name);
    return i === -1 ? '' : (r[i] || '').trim();
  };
  const items = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const url = col(r, 'url');
    const title = col(r, 'title');
    if (!url && !title) continue;
    const note = [col(r, 'note'), col(r, 'comment')].filter(Boolean).join('\n');
    const lat = num(col(r, 'latitude') || col(r, 'lat'));
    const lng = num(col(r, 'longitude') || col(r, 'lng'));
    items.push(fromUrl(url, {
      name: title,
      note,
      address: col(r, 'address'),
      ...(validCoord(lat, lng) ? { lat, lng } : {}),
    }));
  }
  return items;
}

function parseGeoJson(text) {
  const data = JSON.parse(text);
  const features = data.type === 'FeatureCollection' ? data.features : Array.isArray(data) ? data : [data];
  return features.map((f) => {
    const p = f.properties || {};
    const loc = p.location || p.Location || {};
    const [lng, lat] = (f.geometry && f.geometry.coordinates) || [null, null];
    const name = loc.name || loc['Business Name'] || p.Title || p.name || '';
    const url = p.google_maps_url || p['Google Maps URL'] || '';
    return fromUrl(url, {
      name,
      address: loc.address || loc.Address || '',
      note: p.Comment || p.comment || '',
      ...(validCoord(num(lat), num(lng)) ? { lat: num(lat), lng: num(lng) } : {}),
    });
  });
}

const xmlText = (s) =>
  (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();

function parseKml(text) {
  const items = [];
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? xmlText(m[1]) : '';
  };
  for (const [, block] of text.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
    const point = block.match(/<Point[^>]*>[\s\S]*?<coordinates>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
    const lng = point ? num(point[1]) : null;
    const lat = point ? num(point[2]) : null;
    const description = tag(block, 'description');
    const urlInDesc = (description.match(/https?:\/\/[^\s"<]*(?:google\.[^/\s]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s"<]*/i) || [])[0];
    items.push(fromUrl(urlInDesc || '', {
      name: tag(block, 'name'),
      address: tag(block, 'address'),
      note: urlInDesc ? description.replace(urlInDesc, '').trim() : description,
      ...(validCoord(lat, lng) ? { lat, lng } : {}),
    }));
  }
  return items;
}

function parseUrlList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//.test(l))
    .map((url) => fromUrl(url));
}

function detectFormat(text, filename = '') {
  const f = filename.toLowerCase();
  const t = text.trimStart();
  if (f.endsWith('.kml') || t.startsWith('<?xml') || t.startsWith('<kml')) return 'kml';
  if (f.endsWith('.json') || f.endsWith('.geojson') || t.startsWith('{') || t.startsWith('[')) return 'geojson';
  if (f.endsWith('.csv') || /(^|\n)\s*"?title"?\s*,/i.test(t)) return 'csv';
  return 'urls';
}

function parseImport(text, filename) {
  const format = detectFormat(text, filename);
  const parser = { kml: parseKml, geojson: parseGeoJson, csv: parseTakeoutCsv, urls: parseUrlList }[format];
  const items = parser(text).filter((i) => i.name || i.google_maps_url);
  return { format, items };
}

module.exports = { parseImport, parseCsv, parseGoogleMapsUrl, parseTakeoutCsv, parseGeoJson, parseKml, parseUrlList, detectFormat };
