// One small map interface with two backends: Google Maps (when the server has a browser key)
// and Leaflet + OpenStreetMap (no key needed, and it keeps working for development).
//   const m = await PinMap.create(el, { lat, lng, zoom, googleKey });
//   m.setPins(pins, categoriesById, onClick); m.showMe(lat, lng); m.focus(lat, lng, zoom);

(function () {
  function loadGoogle(key) {
    if (window.google && window.google.maps) return Promise.resolve();
    return new Promise((resolve, reject) => {
      window.__pcGoogleReady = resolve;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__pcGoogleReady&loading=async`;
      s.async = true;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function googleMap(el, { lat, lng, zoom }) {
    const g = window.google.maps;
    const map = new g.Map(el, {
      center: { lat, lng }, zoom, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy',
    });
    let markers = [];
    let me = null;
    return {
      setPins(pins, cats, onClick) {
        markers.forEach((m) => m.setMap(null));
        markers = pins.map((p) => {
          const c = cats[p.category_id] || {};
          const m = new g.Marker({
            map, position: { lat: p.lat, lng: p.lng }, title: p.name,
            icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: c.color || '#e4572e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          });
          m.addListener('click', () => onClick(p));
          return m;
        });
      },
      showMe(lat, lng) {
        if (me) me.setMap(null);
        me = new g.Marker({ map, position: { lat, lng }, zIndex: 999,
          icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: '#2b7cff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } });
      },
      focus(lat, lng, z) { map.panTo({ lat, lng }); if (z) map.setZoom(z); },
      fit(points) {
        if (!points.length) return;
        const b = new g.LatLngBounds();
        points.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
        map.fitBounds(b, 60);
      },
      destroy() { el.innerHTML = ''; },
    };
  }

  function leafletMap(el, { lat, lng, zoom }) {
    const map = L.map(el, { zoomControl: false }).setView([lat, lng], zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    let me = null;
    return {
      setPins(pins, cats, onClick) {
        layer.clearLayers();
        for (const p of pins) {
          const c = cats[p.category_id] || {};
          const icon = L.divIcon({
            className: '', iconSize: [30, 30], iconAnchor: [15, 30],
            html: `<div class="pc-pin" style="background:${c.color || '#e4572e'}"><span>${c.icon || ''}</span></div>`,
          });
          L.marker([p.lat, p.lng], { icon, title: p.name }).on('click', () => onClick(p)).addTo(layer);
        }
      },
      showMe(lat, lng) {
        if (me) me.remove();
        me = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }), zIndexOffset: 1000 }).addTo(map);
      },
      focus(lat, lng, z) { map.setView([lat, lng], z || map.getZoom()); },
      fit(points) { if (points.length) map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 }); },
      destroy() { map.remove(); },
    };
  }

  window.PinMap = {
    async create(el, opts) {
      if (opts.googleKey && navigator.onLine) {
        try { await loadGoogle(opts.googleKey); return googleMap(el, opts); } catch { /* fall back to OSM */ }
      }
      return leafletMap(el, opts);
    },
  };
})();
