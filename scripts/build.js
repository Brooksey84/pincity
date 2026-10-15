// Netlify build step: copy Leaflet (the map library) into public/vendor so it's served from our own domain.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(path.dirname(require.resolve('leaflet/package.json')), 'dist');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'leaflet');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Copied Leaflet to public/vendor/leaflet');
