// Finds coordinates for imported places that arrived without them (Takeout list CSVs),
// using the Places API (New) Text Search. Needs GOOGLE_PLACES_API_KEY on the server.
// Without a key, callers leave those places as 'needs_location' for an admin to place.

async function findPlace({ name, address, cityName, google_place_id }, apiKey) {
  if (!apiKey) return null;
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,websiteUri,googleMapsUri',
  };
  const pick = (p) =>
    p && p.location
      ? {
          lat: p.location.latitude,
          lng: p.location.longitude,
          address: p.formattedAddress || '',
          website: p.websiteUri || '',
          google_place_id: p.id,
          google_maps_url: p.googleMapsUri || '',
        }
      : null;

  if (google_place_id) {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(google_place_id)}`, {
      headers: { ...headers, 'X-Goog-FieldMask': headers['X-Goog-FieldMask'] },
    });
    if (res.ok) return pick(await res.json());
  }
  const textQuery = [name, address, cityName].filter(Boolean).join(', ');
  if (!textQuery) return null;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers,
    body: JSON.stringify({ textQuery, pageSize: 1 }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return pick((data.places || [])[0]);
}

module.exports = { findPlace };
