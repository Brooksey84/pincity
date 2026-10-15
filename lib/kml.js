// KML export of a city's pins. Google My Maps imports this file as a map layer,
// and My Maps maps show up in the Google Maps app under Saved > Maps.
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toKml({ city, categories, places }) {
  const styles = categories
    .map((c) => {
      // KML colours are aabbggrr
      const hex = c.color.replace('#', '');
      const kmlColor = `ff${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
      return `  <Style id="cat-${esc(c.slug)}"><IconStyle><color>${kmlColor}</color><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`;
    })
    .join('\n');
  const folders = categories
    .map((c) => {
      const pins = places
        .filter((p) => p.category_id === c.id)
        .map((p) => {
          const desc = [
            p.team_reviewed ? '✓ Reviewed by the Pin City team' : '',
            p.team_note,
            p.address,
            p.website,
            p.google_maps_url,
          ].filter(Boolean).join('\n');
          return `    <Placemark>
      <name>${esc(p.name)}</name>
      <description>${esc(desc)}</description>
      <styleUrl>#cat-${esc(c.slug)}</styleUrl>
      <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
    </Placemark>`;
        })
        .join('\n');
      return `  <Folder>\n    <name>${esc(c.icon + ' ' + c.name)}</name>\n${pins}\n  </Folder>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(`Pin City · ${city.name}`)}</name>
  <description>${esc('Curated by the Pin City team')}</description>
${styles}
${folders}
</Document>
</kml>
`;
}

module.exports = { toKml };
