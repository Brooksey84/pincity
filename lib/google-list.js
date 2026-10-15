// Reads a shared Google Maps list ("Share list" link, e.g. https://maps.app.goo.gl/abc123).
//
// Google has no official API for lists. This uses the same unofficial endpoint the Google Maps
// website calls to show a shared list, so it can stop working whenever Google changes it.
// When it fails, the admin page points people to the Google Takeout import, which is supported.
// The parser below is deliberately forgiving about the response layout for the same reason.

// Network failures come back as a bare "fetch failed"; say something useful instead.
async function get(fetchImpl, url, opts) {
  try { return await fetchImpl(url, opts); } catch {
    throw new Error("Couldn't reach Google Maps just now. Try again in a minute, or use the Google Takeout option instead.");
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function extractListId(url) {
  const s = decodeURIComponent(String(url || ''));
  const m =
    s.match(/\/placelists\/list\/([A-Za-z0-9_-]{10,})/) ||
    s.match(/!11m\d+!2s([A-Za-z0-9_-]{10,})/) ||
    s.match(/!2s([A-Za-z0-9_-]{10,})!3e3/);
  return m ? m[1] : null;
}

// Short share links (maps.app.goo.gl, goo.gl/maps) redirect to the full list URL.
async function resolveListId(url, fetchImpl = fetch) {
  let current = String(url || '').trim();
  if (!/^https?:\/\//i.test(current)) throw new Error('Paste the full link, starting with https://');
  for (let hop = 0; hop < 6; hop++) {
    const id = extractListId(current);
    if (id) return id;
    const res = await get(fetchImpl, current, { redirect: 'manual', headers: { 'User-Agent': UA } });
    const next = res.headers.get('location');
    if (!next) {
      // Some links land on an HTML page that carries the list URL inside it.
      const html = res.ok ? await res.text() : '';
      const inPage = extractListId(html);
      if (inPage) return inPage;
      break;
    }
    current = new URL(next, current).toString();
  }
  throw new Error("That doesn't look like a Google Maps list link. In Google Maps, open the list, tap Share, and copy the link.");
}

const isCoordPair = (a) =>
  Array.isArray(a) && a.length >= 4 && a[0] == null && a[1] == null &&
  typeof a[2] === 'number' && typeof a[3] === 'number' && Math.abs(a[2]) <= 90 && Math.abs(a[3]) <= 180 && !(a[2] === 0 && a[3] === 0);

// Depth-first search for the first value matching test.
function find(node, test, depth = 0) {
  if (depth > 8 || node == null) return undefined;
  if (test(node)) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, test, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

// One list entry: [?, [.., .., .., .., address, [null, null, lat, lng], [featureIdHi, featureIdLo] ..], name, note, ...]
function parseEntry(entry) {
  if (!Array.isArray(entry)) return null;
  const info = Array.isArray(entry[1]) ? entry[1] : [];
  const coords = isCoordPair(info[5]) ? info[5] : find(entry, isCoordPair);
  const name = typeof entry[2] === 'string' ? entry[2] : '';
  if (!name) return null;
  const address = typeof info[4] === 'string' ? info[4] : typeof info[2] === 'string' ? info[2] : '';
  const note = typeof entry[3] === 'string' ? entry[3] : '';
  const fidLo = Array.isArray(info[6]) && typeof info[6][1] === 'string' ? info[6][1] : null;
  let cid = null;
  try { if (fidLo && /^0x[0-9a-f]+$/i.test(fidLo)) cid = BigInt(fidLo).toString(); } catch { /* ignore */ }
  return {
    name: name.trim(),
    address: address.trim(),
    lat: coords ? coords[2] : null,
    lng: coords ? coords[3] : null,
    note: note.trim(),
    google_maps_url: cid ? `https://maps.google.com/?cid=${cid}` : '',
    google_place_id: null,
  };
}

function parseListResponse(text) {
  const json = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ''));
  const root = Array.isArray(json[0]) ? json[0] : json;
  const title = typeof root[4] === 'string' ? root[4] : '';
  // Entries normally sit at root[8]; otherwise take the first array whose items look like places.
  let entries = Array.isArray(root[8]) ? root[8] : null;
  if (!entries || !entries.some((e) => parseEntry(e))) {
    entries = find(root, (x) => Array.isArray(x) && x.length > 0 && x.every(Array.isArray) && x.filter((e) => parseEntry(e)).length >= Math.ceil(x.length / 2)) || [];
  }
  return { title, items: entries.map(parseEntry).filter(Boolean) };
}

async function fetchGoogleList(url, fetchImpl = fetch) {
  const id = await resolveListId(url, fetchImpl);
  const api = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=gb&pb=${encodeURIComponent(`!1m4!1s${id}!2e1!3m1!1e1!2e2!3e2!4i500!16b1`).replace(/%21/g, '!')}`;
  const res = await get(fetchImpl, api, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Google returned ${res.status}. Make sure the list is shared (Share › link sharing on).`);
  let parsed;
  try { parsed = parseListResponse(await res.text()); } catch {
    throw new Error("Google's reply wasn't in the expected format, so the list couldn't be read. Use the Google Takeout option instead.");
  }
  if (!parsed.items.length) throw new Error('No places found. Check the list is shared, or use the Google Takeout option instead.');
  return parsed;
}

module.exports = { extractListId, resolveListId, parseListResponse, fetchGoogleList };
