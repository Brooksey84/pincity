// Pin City user app: subscribe to cities, pick categories, see curated pins near you,
// and hand off to Google Maps for directions or as a saved My Maps layer.
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUNDLE_KEY = 'pincity.bundle.v1';

const state = {
  config: {}, me: null, categories: [], cities: [], subs: [], bundle: null,
  here: null, map: null, city: null, pins: [], activeCats: new Set(),
};

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}

const store = {
  get() { try { return JSON.parse(localStorage.getItem(BUNDLE_KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(BUNDLE_KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  clear() { try { localStorage.removeItem(BUNDLE_KEY); } catch { /* ignore */ } },
};

function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1)} km`);

// Links that open the exact business in the Google Maps app (or website on desktop).
function googleLinks(p) {
  const view = p.google_place_id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${p.google_place_id}`
    : p.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || ''}`.trim() || `${p.lat},${p.lng}`)}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` +
    (p.google_place_id ? `&destination_place_id=${p.google_place_id}` : '');
  return { view, dir };
}

const catMap = () => Object.fromEntries(state.categories.map((c) => [c.id, c]));
const subFor = (slug) => state.subs.find((s) => s.city_slug === slug);

// ---------- data ----------
async function syncDownload() {
  if (!state.me) return;
  const bundle = await api('/me/download');
  state.bundle = bundle;
  store.set(bundle);
  return bundle;
}

async function load() {
  state.bundle = store.get();
  try {
    [state.config, state.me, state.categories, state.cities] = await Promise.all([
      api('/config'), api('/auth/me'), api('/categories'), api('/cities'),
    ]);
    if (state.me) {
      state.subs = await api('/me/subscriptions');
      await syncDownload();
    }
    $('#offline-note').classList.add('hidden');
  } catch {
    // Offline: run from what was downloaded last time.
    const b = state.bundle;
    if (b) {
      state.categories = b.categories;
      state.cities = b.cities;
      state.subs = b.cities.map((c) => ({ city_id: c.id, city_slug: c.slug, categories: c.categories }));
      state.me = state.me || { offline: true };
    }
    $('#offline-note').classList.remove('hidden');
  }
  $('#account').textContent = state.me && !state.me.offline ? 'Account' : state.me ? '' : 'Sign in';
}

// ---------- home ----------
function cityMeta(city, sub) {
  const counts = city.counts || Object.fromEntries((city.categories || []).map((s) => [s, city.pins?.filter((p) => catMap()[p.category_id]?.slug === s).length]));
  return state.categories
    .filter((c) => (sub ? sub.categories.includes(c.slug) : counts[c.slug]))
    .map((c) => `${c.icon} ${counts[c.slug] ?? 0} ${c.name.toLowerCase()}`)
    .join(' · ');
}

function renderHome() {
  const mine = state.cities.filter((c) => subFor(c.slug));
  const others = state.cities.filter((c) => !subFor(c.slug));
  $('#my-cities-title').classList.toggle('hidden', !mine.length);
  $('#my-cities').innerHTML = mine.map((c) => `
    <div class="city-card">
      <div class="info"><b>${esc(c.name)}</b><div class="meta">${esc(cityMeta(c, subFor(c.slug)))}</div></div>
      <div class="actions"><button data-cats="${c.slug}">Edit</button><button class="primary" data-open="${c.slug}">Map</button></div>
    </div>`).join('');
  $('#all-cities').innerHTML = others.map((c) => `
    <div class="city-card">
      <div class="info"><b>${esc(c.name)}</b>${c.country ? `<span class="meta"> · ${esc(c.country)}</span>` : ''}
        <div class="meta">${esc(cityMeta(c)) || 'Pins coming soon'}</div></div>
      <div class="actions"><button data-open="${c.slug}">Look</button><button class="primary" data-cats="${c.slug}">Subscribe</button></div>
    </div>`).join('') || `<p class="note">${mine.length ? "You've subscribed to every city we have so far." : 'No cities yet. Check back soon.'}</p>`;
}

$('#home').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.open) location.hash = `#/city/${t.dataset.open}`;
  if (t.dataset.cats) chooseCategories(t.dataset.cats);
});

// ---------- dialogs ----------
function openDialog(html) {
  $('#dialog-body').innerHTML = html;
  const d = $('#dialog');
  if (!d.open) d.showModal();
  return d;
}
const closeDialog = () => $('#dialog').close();

function authDialog(mode = 'login') {
  return new Promise((resolve) => {
    const signup = mode === 'signup';
    openDialog(`<h3>${signup ? 'Create your account' : 'Sign in'}</h3>
      <form id="auth-form">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        <p class="error" id="auth-error"></p>
        <div class="row"><button type="button" id="auth-cancel">Cancel</button><button class="primary">${signup ? 'Create account' : 'Sign in'}</button></div>
      </form>
      <p class="switch">${signup ? 'Already have an account?' : 'New to Pin City?'} <a href="#" id="auth-switch">${signup ? 'Sign in' : 'Create an account'}</a></p>`);
    $('#auth-cancel').onclick = () => { closeDialog(); resolve(false); };
    $('#auth-switch').onclick = (e) => { e.preventDefault(); authDialog(signup ? 'login' : 'signup').then(resolve); };
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        state.me = await api(`/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
        state.subs = await api('/me/subscriptions');
        await syncDownload();
        $('#account').textContent = 'Account';
        closeDialog();
        resolve(true);
      } catch (err) { $('#auth-error').textContent = err.message; }
    };
  });
}

async function chooseCategories(slug) {
  if (!state.me || state.me.offline) {
    if (!(await authDialog('signup'))) return;
  }
  const city = state.cities.find((c) => c.slug === slug);
  const sub = subFor(slug);
  // Only offer categories that have pins in this city (plus any already chosen).
  const offered = state.categories.filter((c) => city.counts?.[c.slug] || sub?.categories.includes(c.slug));
  const picked = new Set(sub ? sub.categories : offered.map((c) => c.slug));
  openDialog(`<h3>${esc(city.name)}: what do you want pinned?</h3>
    <form id="cat-form">
      ${offered.length ? '' : '<p class="note">No pins here yet. Check back soon.</p>'}
      ${offered.map((c) => `<label class="cat-opt"><input type="checkbox" name="cat" value="${c.slug}" ${picked.has(c.slug) ? 'checked' : ''}>
        <span>${c.icon} ${esc(c.name)}</span><span class="note" style="margin-left:auto">${city.counts?.[c.slug] ?? 0}</span></label>`).join('')}
      <p class="error" id="cat-error"></p>
      <div class="row">
        ${sub ? '<button type="button" id="unsub">Unsubscribe</button>' : ''}
        <button type="button" id="cat-cancel">Cancel</button><button class="primary">${sub ? 'Save' : 'Subscribe & download'}</button>
      </div>
    </form>`);
  $('#cat-cancel').onclick = closeDialog;
  const save = async (cats) => {
    state.subs = await api(`/me/subscriptions/${slug}`, { method: 'PUT', body: { categories: cats } });
    const bundle = await syncDownload();
    closeDialog();
    const saved = bundle.cities.find((c) => c.slug === slug);
    toast(saved ? `${saved.pins.length} pins saved to this device for ${city.name}` : `Unsubscribed from ${city.name}`);
    route();
  };
  if (sub) $('#unsub').onclick = () => save([]).catch((e) => toast(e.message));
  $('#cat-form').onsubmit = async (e) => {
    e.preventDefault();
    const cats = new FormData(e.target).getAll('cat');
    if (!cats.length) return ($('#cat-error').textContent = 'Pick at least one, or unsubscribe.');
    try { await save(cats); } catch (err) { $('#cat-error').textContent = err.message; }
  };
}

function googleMapsDialog() {
  const city = state.city;
  const cats = [...state.activeCats].map((id) => catMap()[id].slug).join(',');
  const url = `/api/cities/${city.slug}/export.kml?categories=${cats}`;
  openDialog(`<h3>Put these pins in Google Maps</h3>
    <p class="note">Google doesn't let other apps draw on its map, but it does let you import a map layer once and keep it.
      It then appears in the Google Maps app under <b>You › Maps</b>.</p>
    <ol>
      <li><a href="${url}" download>Download the ${esc(city.name)} pins</a> (a .kml file).</li>
      <li>Open <a href="https://www.google.com/maps/d/" target="_blank" rel="noopener">Google My Maps</a> and choose <b>Create a new map</b>.</li>
      <li>Click <b>Import</b> and pick the file you downloaded.</li>
      <li>Open Google Maps on your phone, tap <b>You</b>, then <b>Maps</b>, and pick the map.</li>
    </ol>
    <p class="note">Pins here in Pin City stay up to date automatically. A My Maps copy is a snapshot, so re-import it when we add places.</p>
    <div class="row"><button class="primary" id="gm-close">Done</button></div>`);
  $('#gm-close').onclick = closeDialog;
}

$('#account').onclick = async () => {
  if (!state.me) { if (await authDialog('login')) route(); return; }
  if (state.me.offline) return;
  openDialog(`<h3>Your account</h3><p>${esc(state.me.email)}</p>
    <p class="note">Your subscribed cities are saved on this device, so the map works without signal.</p>
    <div class="row"><button id="logout">Sign out</button><button class="primary" id="acc-close">Close</button></div>`);
  $('#acc-close').onclick = closeDialog;
  $('#logout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' });
    Object.assign(state, { me: null, subs: [], bundle: null });
    store.clear();
    $('#account').textContent = 'Sign in';
    closeDialog();
    location.hash = '#/';
    route();
  };
};

// ---------- city map ----------
async function openCity(slug) {
  const sub = subFor(slug);
  let city, pins;
  const saved = state.bundle?.cities.find((c) => c.slug === slug);
  if (sub && saved) {
    city = saved;
    pins = saved.pins;
  } else {
    const data = await api(`/cities/${slug}/pins`);
    city = data.city;
    pins = data.pins;
  }
  state.city = city;
  state.pins = pins;
  const offered = state.categories.filter((c) => (sub ? sub.categories.includes(c.slug) : pins.some((p) => p.category_id === c.id)));
  state.activeCats = new Set(offered.map((c) => c.id));
  $('#title').textContent = city.name;

  if (state.map) state.map.destroy();
  state.map = await PinMap.create($('#map'), { lat: city.lat, lng: city.lng, zoom: city.zoom, googleKey: state.config.googleMapsApiKey });

  $('#chips').innerHTML = offered.map((c) => `<button class="chip on" style="--chip:${c.color}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('');
  $('#chips').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    const id = Number(b.dataset.cat);
    state.activeCats.has(id) ? state.activeCats.delete(id) : state.activeCats.add(id);
    b.classList.toggle('on');
    drawPins();
  };
  drawPins(true);
  if (state.here && distanceKm(state.here, city) < 50) state.map.showMe(state.here.lat, state.here.lng);
}

const visiblePins = () => state.pins.filter((p) => state.activeCats.has(p.category_id));

function drawPins(fit = false) {
  const pins = visiblePins();
  state.map.setPins(pins, catMap(), showPin);
  if (fit && pins.length) state.map.fit(pins);
  renderList();
}

function renderList() {
  const cats = catMap();
  const sub = subFor(state.city.slug);
  let pins = visiblePins();
  const near = state.here && distanceKm(state.here, state.city) < 50;
  pins = pins.map((p) => ({ ...p, km: near ? distanceKm(state.here, p) : null }))
    .sort((a, b) => (near ? a.km - b.km : a.name.localeCompare(b.name)));
  $('#sheet').classList.remove('tall');
  $('#sheet-body').innerHTML = `
    <div class="sheet-head"><h3>${near ? 'Closest to you' : `${pins.length} places`}</h3>
      ${sub ? '<button id="to-gmaps">Add to Google Maps</button>' : `<button class="primary" id="sub-here">Subscribe</button>`}</div>
    ${pins.map((p) => `<div class="pin-row" data-id="${p.id}">
      <div class="dot" style="background:${cats[p.category_id]?.color}">${cats[p.category_id]?.icon || ''}</div>
      <div class="info"><div class="name">${esc(p.name)}</div>
        <div class="sub">${p.team_reviewed ? '<span class="badge">Team visited</span> ' : ''}${esc((p.team_note || p.address || '').slice(0, 90))}</div></div>
      ${p.km != null ? `<div class="dist">${fmtDist(p.km)}</div>` : ''}</div>`).join('') || '<p class="note">No pins for these categories yet.</p>'}`;
  $('#sheet-body').onclick = (e) => {
    const row = e.target.closest('.pin-row');
    if (row) showPin(state.pins.find((p) => p.id === Number(row.dataset.id)));
  };
  if (sub) $('#to-gmaps').onclick = googleMapsDialog;
  else $('#sub-here').onclick = () => chooseCategories(state.city.slug);
}

function showPin(p) {
  const c = catMap()[p.category_id] || {};
  const links = googleLinks(p);
  const km = state.here ? distanceKm(state.here, p) : null;
  state.map.focus(p.lat, p.lng);
  $('#sheet').classList.add('tall');
  $('#sheet-body').innerHTML = `<div class="detail">
    <button class="ghost" id="back-list" style="padding-left:0">← All places</button>
    <div class="note">${c.icon} ${esc(c.name)}${km != null && km < 50 ? ` · ${fmtDist(km)} away` : ''}</div>
    <h3>${esc(p.name)}</h3>
    ${p.team_reviewed ? `<span class="badge">✓ Visited by the Pin City team${p.visited_on ? `, ${new Date(p.visited_on).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}</span>` : '<span class="badge">Pin City pick</span>'}
    ${p.team_note ? `<p class="quote">${esc(p.team_note).replace(/\n/g, '<br>')}</p>` : ''}
    ${p.address ? `<p class="note">${esc(p.address)}</p>` : ''}
    <div class="row">
      <a class="link-btn primary" href="${esc(links.dir)}" target="_blank" rel="noopener">Directions</a>
      <a class="link-btn" href="${esc(links.view)}" target="_blank" rel="noopener">Open in Google Maps</a>
      ${p.website ? `<a class="link-btn" href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>` : ''}
    </div></div>`;
  $('#back-list').onclick = renderList;
}

$('.grab').onclick = () => $('#sheet').classList.toggle('tall');

$('#locate').onclick = () => {
  if (!navigator.geolocation) return toast("This device can't share its location.");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (distanceKm(state.here, state.city) > 50) {
        toast(`You're not in ${state.city.name} right now, so we'll sort by name.`);
      } else {
        state.map.showMe(state.here.lat, state.here.lng);
        state.map.focus(state.here.lat, state.here.lng, 15);
      }
      renderList();
    },
    () => toast("Couldn't get your location. Check location permission for this site."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

// ---------- routing ----------
async function route() {
  const m = location.hash.match(/^#\/city\/([\w-]+)/);
  $('#home').classList.toggle('hidden', !!m);
  $('#city').classList.toggle('hidden', !m);
  $('#back').classList.toggle('hidden', !m);
  if (m) {
    try { await openCity(m[1]); } catch (e) { toast(e.message); location.hash = '#/'; }
  } else {
    $('#title').textContent = '📍 Pin City';
    renderHome();
  }
}
$('#back').onclick = () => (location.hash = '#/');
window.addEventListener('hashchange', route);

(async () => {
  await load();
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
