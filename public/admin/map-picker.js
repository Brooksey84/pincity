// "Add from map": tap a business on a Google map (or search for one) and add it to a city,
// the way you'd save a place to a list in Google Maps. Needs GOOGLE_MAPS_API_KEY with the
// Maps JavaScript API and Places API (New) enabled. Loaded after admin.js, whose helpers it uses.

let gmapsLoading;
function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  gmapsLoading ??= new Promise((resolve, reject) => {
    window.__pcAdminMapsReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__pcAdminMapsReady`;
    s.async = true;
    s.onerror = () => { gmapsLoading = undefined; reject(new Error("Couldn't load Google Maps. Check your internet connection and the Google key.")); };
    document.head.appendChild(s);
  });
  return gmapsLoading;
}

// Best guess at our category from Google's place types; the admin can change it.
function guessCategory(types = []) {
  const has = (...t) => t.some((x) => types.includes(x));
  const bySlug = (slug) => state.categories.find((c) => c.slug === slug);
  // Most specific first: a cafe is also a "restaurant" and a "food" place to Google.
  const rules = [
    [['bicycle_store'], 'bicycle-shops'],
    [['tobacco_shop'], 'tobacconists'],
    [['movie_theater'], 'cinemas'],
    [['performing_arts_theater'], 'theatres'],
    [['live_music_venue', 'concert_hall', 'amphitheatre'], 'music-venues'],
    [['wine_store'], 'wine-merchants'],
    [['liquor_store'], 'bottle-shops'],
    [['deli'], 'delicatessens'],
    [['bakery'], 'bakeries'],
    [['cafe', 'coffee_shop', 'tea_house'], 'cafes'],
    [['night_club'], 'nightlife'],
    [['pub'], 'pubs'],
    [['bar', 'wine_bar', 'cocktail_bar'], 'drink'],
    [['museum', 'art_gallery'], 'museums'],
    [['restaurant', 'meal_takeaway', 'food'], 'food'],
  ];
  for (const [t, slug] of rules) if (has(...t) && bySlug(slug)) return bySlug(slug);
  return null;
}

views.addmap = async (el, params) => {
  await refreshLookups();
  const config = await api('/config');
  if (!config.googleMapsApiKey) {
    el.innerHTML = `<h1>Add from map</h1><div class="card help">
      <p>This page shows a Google map where you can tap any business and add it to a city.</p>
      <p>It needs a Google Maps key. Add <code>GOOGLE_MAPS_API_KEY</code> in Netlify (Project configuration › Environment variables)
        with the <b>Maps JavaScript API</b> and <b>Places API (New)</b> turned on for it, then redeploy.</p></div>`;
    return;
  }
  if (!state.cities.length) {
    el.innerHTML = '<h1>Add from map</h1><p class="help">Add a city first under <a href="#cities">Cities</a>.</p>';
    return;
  }
  const city = cityById(params.get('city_id')) || state.cities[0];
  let cityPlaces = await api(`/admin/places?city_id=${city.id}`);

  el.innerHTML = `<div class="toolbar">
      <h1 style="margin:0">Add from map</h1>
      <select id="pk-city">${options(state.cities, city.id)}</select>
      <div class="picker-search" id="pk-search"></div>
    </div>
    <div class="picker">
      <div id="pk-map" class="gmap"></div>
      <div class="card panel" id="pk-panel"><h3>Tap a business</h3>
        <p class="help">Tap any restaurant, bar or shop on the map, or search above, to add it to ${esc(city.name)}.
          Coloured dots are places already in Pin City.</p></div>
    </div>`;
  $('#pk-city').onchange = (e) => (location.hash = `addmap?city_id=${e.target.value}`);

  try {
    await loadGoogleMaps(config.googleMapsApiKey);
  } catch (err) {
    $('#pk-panel').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const { Map } = await google.maps.importLibrary('maps');
  const { Place, PlaceAutocompleteElement } = await google.maps.importLibrary('places');
  const map = new Map($('#pk-map'), {
    center: { lat: city.lat, lng: city.lng }, zoom: Math.max(city.zoom, 14),
    clickableIcons: true, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
  });

  // Existing pins, so it's obvious what's already been added.
  const markers = new globalThis.Map();
  const addMarker = (p) => {
    const c = catById(p.category_id) || {};
    const m = new google.maps.Marker({
      map, position: { lat: p.lat, lng: p.lng }, title: p.name, zIndex: 10,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: c.color || '#e4572e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
    m.addListener('click', () => showExisting(p));
    markers.set(p.id, m);
  };
  cityPlaces.filter((p) => p.lat != null).forEach(addMarker);

  let selectedMarker = null;
  function showExisting(p) {
    const c = catById(p.category_id) || {};
    $('#pk-panel').innerHTML = `<h3>${esc(p.name)}</h3><div class="sub">${esc(p.address)}</div>
      <p>Already in Pin City under ${esc(c.icon)} ${esc(c.name)} <span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></p>
      <button id="pk-edit">Edit</button>`;
    $('#pk-edit').onclick = () => editPlace(p);
  }

  async function select(placeOrId) {
    $('#pk-panel').innerHTML = '<p class="help">Loading…</p>';
    try {
      const place = typeof placeOrId === 'string' ? new Place({ id: placeOrId }) : placeOrId;
      await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'location', 'websiteURI', 'googleMapsURI', 'types'] });
      const existing = cityPlaces.find((p) => p.google_place_id === place.id);
      map.panTo(place.location);
      if (selectedMarker) selectedMarker.setMap(null);
      selectedMarker = existing ? null : new google.maps.Marker({ map, position: place.location, zIndex: 20 });
      if (existing) return showExisting(existing);
      showForm(place);
    } catch (err) {
      $('#pk-panel').innerHTML = `<p class="error">Couldn't load that place: ${esc(err.message)}</p>`;
    }
  }

  function showForm(place) {
    const guess = guessCategory(place.types);
    $('#pk-panel').innerHTML = `<form id="pk-form">
      <h3>${esc(place.displayName)}</h3><div class="sub">${esc(place.formattedAddress)}</div>
      <label>Category <select name="category_id" required>${options(state.categories, guess?.id, { blank: 'Choose', label: (c) => `${c.icon} ${c.name}${c.active ? '' : ' (not live yet)'}` })}</select></label>
      <label>Team note (shown to users) <textarea name="team_note" placeholder="Why we love it, what to order…"></textarea></label>
      <label>Visited on <input type="date" name="visited_on"></label>
      <label class="check"><input type="checkbox" name="team_reviewed"> Reviewed in person by the Pin City team</label>
      <label class="check"><input type="checkbox" name="publish" checked> Publish now (otherwise saved as a draft)</label>
      <p class="error" id="pk-error"></p>
      <button class="primary">Add to ${esc(city.name)}</button>
    </form>`;
    $('#pk-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const saved = await api('/admin/places', {
          method: 'POST',
          body: {
            city_id: city.id, category_id: Number(f.category_id.value),
            name: place.displayName, address: place.formattedAddress || '',
            lat: place.location.lat(), lng: place.location.lng(),
            google_place_id: place.id, google_maps_url: place.googleMapsURI || '', website: place.websiteURI || '',
            team_note: f.team_note.value, visited_on: f.visited_on.value || null, team_reviewed: f.team_reviewed.checked,
            status: f.publish.checked ? 'published' : 'draft',
          },
        });
        cityPlaces = [...cityPlaces, saved];
        if (selectedMarker) { selectedMarker.setMap(null); selectedMarker = null; }
        addMarker(saved);
        showExisting(saved);
        toast(`${saved.name} added to ${city.name}`);
      } catch (err) { $('#pk-error').textContent = err.message; }
    };
  }

  // Tapping a business icon on the map gives us its place id.
  map.addListener('click', (e) => {
    if (!e.placeId) return;
    e.stop(); // don't open Google's own info bubble
    select(e.placeId);
  });

  // Search box, biased to the city.
  const search = new PlaceAutocompleteElement({ locationBias: { radius: 20000, center: { lat: city.lat, lng: city.lng } } });
  $('#pk-search').appendChild(search);
  search.addEventListener('gmp-select', (e) => e.placePrediction && select(e.placePrediction.toPlace()));
  search.addEventListener('gmp-placeselect', (e) => e.place && select(e.place)); // older event name
};
