// Pin City admin dashboard: plain JS, no build step.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { published: 'Published', draft: 'Draft', needs_location: 'Needs location' };

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error(data.error || 'Please sign in.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// Opens a form dialog; resolves with the form's values, or null on cancel.
function formDialog(title, fieldsHtml, submitLabel = 'Save') {
  const dialog = $('#dialog');
  const form = $('#dialog-form');
  form.innerHTML = `<h2>${esc(title)}</h2>${fieldsHtml}<p class="error" id="dialog-error"></p>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">${esc(submitLabel)}</button></div>`;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = () => {
      if (dialog.returnValue !== 'ok') return resolve(null);
      const values = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      resolve(values);
    };
  });
}

const state = { categories: [], cities: [] };
const catById = (id) => state.categories.find((c) => c.id === Number(id));
const cityById = (id) => state.cities.find((c) => c.id === Number(id));

async function refreshLookups() {
  [state.categories, state.cities] = await Promise.all([api('/admin/categories'), api('/admin/cities')]);
}

function options(list, selected, { blank, label = (x) => x.name } = {}) {
  return (blank ? `<option value="">${esc(blank)}</option>` : '') +
    list.map((x) => `<option value="${x.id}" ${String(x.id) === String(selected) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
}

// ---------- views ----------
const views = {
  async dashboard(el) {
    const s = await api('/admin/stats');
    el.innerHTML = `<h1>Dashboard</h1>
      <div class="stats">
        ${[['cities', 'Cities'], ['published_places', 'Published pins'], ['draft_places', 'Drafts'],
           ['needs_location', 'Need a location'], ['users', 'Users'], ['subscribers', 'Subscribers']]
          .map(([k, l]) => `<div class="card stat"><b>${s[k]}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="card help">
        <h3>Getting started</h3>
        <ol>
          <li>Add a city under <a href="#cities">Cities</a>.</li>
          <li><a href="#import">Import</a> one of your Google Maps lists into it, or add places by hand under <a href="#places">Places</a>.</li>
          <li>Check the pins, add your team notes, and publish them.</li>
          <li>Publish the city so users can subscribe to it.</li>
        </ol>
        ${s.needs_location ? `<p><b>${s.needs_location}</b> imported place(s) still need a location. <a href="#places?status=needs_location">Fix them</a>.</p>` : ''}
      </div>`;
  },

  async cities(el) {
    await refreshLookups();
    el.innerHTML = `<div class="toolbar"><h1 class="grow">Cities</h1><button class="primary" id="add-city">Add city</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>City</th><th>Pins</th><th>Subscribers</th><th>Status</th><th></th></tr></thead>
        <tbody>${state.cities.map((c) => `<tr>
          <td><b>${esc(c.name)}</b><div class="sub">${esc(c.country)} · /${esc(c.slug)}</div></td>
          <td>${c.published_places} published<div class="sub">${c.total_places} total</div></td>
          <td>${c.subscribers}</td>
          <td><span class="pill ${c.published ? 'published' : 'draft'}">${c.published ? 'Live' : 'Hidden'}</span></td>
          <td style="white-space:nowrap">
            <a href="#places?city_id=${c.id}">Places</a> ·
            <button class="link" data-edit="${c.id}">Edit</button> ·
            <button class="link" data-toggle="${c.id}">${c.published ? 'Hide' : 'Go live'}</button> ·
            <button class="link danger" data-delete="${c.id}">Delete</button>
          </td></tr>`).join('') || '<tr><td colspan="5" class="help">No cities yet.</td></tr>'}
        </tbody></table></div>`;
    $('#add-city').onclick = () => editCity();
    el.onclick = async (e) => {
      const t = e.target;
      try {
        if (t.dataset.edit) await editCity(cityById(t.dataset.edit));
        if (t.dataset.toggle) {
          const c = cityById(t.dataset.toggle);
          await api(`/admin/cities/${c.id}`, { method: 'PATCH', body: { published: !c.published } });
          toast(c.published ? `${c.name} hidden from users` : `${c.name} is live`);
          route();
        }
        if (t.dataset.delete) {
          const c = cityById(t.dataset.delete);
          if (!confirm(`Delete ${c.name} and all ${c.total_places} of its places? This cannot be undone.`)) return;
          await api(`/admin/cities/${c.id}`, { method: 'DELETE' });
          toast(`${c.name} deleted`);
          route();
        }
      } catch (err) { toast(err.message); }
    };
  },

  async places(el, params) {
    await refreshLookups();
    const f = { city_id: params.get('city_id') || '', category_id: params.get('category_id') || '', status: params.get('status') || '', q: params.get('q') || '' };
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const places = await api(`/admin/places?${qs}`);
    el.innerHTML = `<div class="toolbar"><h1 class="grow">Places</h1><button class="primary" id="add-place">Add place</button></div>
      <div class="toolbar">
        <select id="f-city">${options(state.cities, f.city_id, { blank: 'All cities' })}</select>
        <select id="f-cat">${options(state.categories, f.category_id, { blank: 'All categories', label: (c) => `${c.icon} ${c.name}` })}</select>
        <select id="f-status"><option value="">Any status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input id="f-q" placeholder="Search name or address" value="${esc(f.q)}" class="grow">
      </div>
      <div id="map" class="map"></div>
      <div class="toolbar">
        <span class="help grow">${places.length} place(s). Tick some to change them together.</span>
        <button data-bulk="published">Publish</button><button data-bulk="draft">Move to draft</button>
        <button data-bulk="reviewed">Mark team-reviewed</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th><input type="checkbox" id="all" style="width:auto"></th><th>Place</th><th>Category</th><th>City</th><th>Status</th><th></th></tr></thead>
        <tbody>${places.map((p) => {
          const c = catById(p.category_id) || {};
          return `<tr>
            <td><input type="checkbox" class="sel" value="${p.id}" style="width:auto"></td>
            <td><b>${esc(p.name)}</b> ${p.team_reviewed ? '<span class="pill reviewed">Team reviewed</span>' : ''}
              <div class="sub">${esc(p.address)}</div>${p.team_note ? `<div class="sub">“${esc(p.team_note.slice(0, 120))}”</div>` : ''}</td>
            <td>${esc(c.icon)} ${esc(c.name)}</td>
            <td>${esc(cityById(p.city_id)?.name)}</td>
            <td><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></td>
            <td style="white-space:nowrap"><button class="link" data-edit="${p.id}">Edit</button> ·
              <button class="link danger" data-delete="${p.id}">Delete</button></td></tr>`;
        }).join('') || '<tr><td colspan="6" class="help">No places match.</td></tr>'}</tbody></table></div>`;

    const go = () => {
      const next = new URLSearchParams(Object.entries({ city_id: $('#f-city').value, category_id: $('#f-cat').value, status: $('#f-status').value, q: $('#f-q').value }).filter(([, v]) => v));
      location.hash = `places?${next}`;
    };
    for (const id of ['#f-city', '#f-cat', '#f-status']) $(id).onchange = go;
    $('#f-q').onkeydown = (e) => e.key === 'Enter' && go();
    $('#add-place').onclick = () => editPlace({ city_id: f.city_id, category_id: f.category_id });
    $('#all').onchange = (e) => el.querySelectorAll('.sel').forEach((cb) => (cb.checked = e.target.checked));

    drawMap($('#map'), places, cityById(f.city_id));

    el.onclick = async (e) => {
      const t = e.target;
      try {
        if (t.dataset.edit) await editPlace(places.find((p) => p.id === Number(t.dataset.edit)));
        if (t.dataset.delete) {
          const p = places.find((x) => x.id === Number(t.dataset.delete));
          if (!confirm(`Delete ${p.name}?`)) return;
          await api(`/admin/places/${p.id}`, { method: 'DELETE' });
          toast(`${p.name} deleted`);
          route();
        }
        if (t.dataset.bulk) {
          const ids = [...el.querySelectorAll('.sel:checked')].map((cb) => Number(cb.value));
          const body = t.dataset.bulk === 'reviewed' ? { ids, team_reviewed: true } : { ids, status: t.dataset.bulk };
          const r = await api('/admin/places/bulk', { method: 'POST', body });
          toast(`${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no location yet)` : ''}`);
          route();
        }
      } catch (err) { toast(err.message); }
    };
  },

  async import(el) {
    await refreshLookups();
    el.innerHTML = `<h1>Import a Google Maps list</h1>
      <div class="steps">
        <div class="card help">
          <h3>Getting a list out of Google Maps</h3>
          <p><b>Quickest: a list link.</b> In Google Maps, open the list, tap <b>Share</b> (turn on link sharing if asked) and copy the link.
            Paste it below and press <i>Fetch list</i>. Google doesn't officially support this, so if it stops working, use Takeout below.</p>
          <p><b>Saved lists</b> (your "Want to go", "Favourites" or any list you've made): go to
            <a href="https://takeout.google.com" target="_blank" rel="noopener">Google Takeout</a>, choose only <b>Saved</b>, export,
            and upload the list's <code>.csv</code> file here. Takeout lists don't include coordinates, so each place is looked up
            with the Places API when a key is set on the server; anything it can't find is marked <i>Needs location</i> for you to fix.</p>
          <p><b>Starred places</b>: in the same Takeout export, under <i>Maps (your places)</i>, upload <code>Saved Places.json</code>.</p>
          <p><b>Google My Maps</b>: open the map, ⋮ menu, <i>Export to KML/KMZ</i>, tick "Export to a .KML file", and upload it.</p>
          <p><b>Links</b>: paste Google Maps place links, one per line.</p>
        </div>
        <div class="card">
          <div class="grid2">
            <label>Add to city <select id="i-city">${options(state.cities, '', { blank: 'Choose a city' })}</select></label>
            <label>Category <select id="i-cat">${options(state.categories, '', { blank: 'Choose a category', label: (c) => `${c.icon} ${c.name}${c.active ? '' : ' (not live yet)'}` })}</select></label>
          </div>
          <label>Link to a shared Google Maps list <input id="i-list" placeholder="https://maps.app.goo.gl/…"></label>
          <button class="primary" id="i-fetch">Fetch list</button>
          <p class="help">Or upload an export instead:</p>
          <label>File (.csv, .json or .kml) <input type="file" id="i-file" accept=".csv,.json,.geojson,.kml,.txt"></label>
          <label>…or paste links / file contents <textarea id="i-text" placeholder="https://maps.app.goo.gl/… or https://www.google.com/maps/place/…"></textarea></label>
          <button class="primary" id="i-preview">Preview</button>
        </div>
        <div id="i-result"></div>
      </div>`;
    if (!state.cities.length) $('#i-result').innerHTML = '<p class="help">Add a city first under <a href="#cities">Cities</a>.</p>';

    let preview = null;
    $('#i-fetch').onclick = async () => {
      const btn = $('#i-fetch');
      btn.disabled = true;
      btn.textContent = 'Fetching…';
      try {
        preview = await api('/admin/import/google-list', { method: 'POST', body: { url: $('#i-list').value } });
        renderPreview();
      } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.textContent = 'Fetch list'; }
    };
    $('#i-preview').onclick = async () => {
      try {
        const file = $('#i-file').files[0];
        const text = file ? await file.text() : $('#i-text').value;
        preview = await api('/admin/import/preview', { method: 'POST', body: { text, filename: file?.name || '' } });
        renderPreview();
      } catch (err) { toast(err.message); }
    };

    function renderPreview() {
      const located = preview.items.filter((i) => i.lat != null).length;
      const missing = preview.items.length - located;
      $('#i-result').innerHTML = `<div class="card">
        <h3>Found ${preview.items.length} place(s)${preview.title ? ` in “${esc(preview.title)}”` : ''} <span class="pill">${preview.format === 'google-list' ? 'GOOGLE LIST' : preview.format.toUpperCase()}</span></h3>
        <p class="help">${located} have coordinates.
          ${missing ? (preview.geocoding_available
            ? `${missing} will be looked up with the Places API when you import.`
            : `${missing} have no coordinates and no Places API key is set, so they'll be saved as <i>Needs location</i>.`) : ''}
          Untick anything you don't want.</p>
        <div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="p-all" checked style="width:auto"></th><th>Name</th><th>Note</th><th>Location</th></tr></thead>
          <tbody>${preview.items.map((i, n) => `<tr>
            <td><input type="checkbox" class="p-sel" data-n="${n}" checked style="width:auto"></td>
            <td><b>${esc(i.name || '(no name)')}</b><div class="sub">${esc(i.address)}</div></td>
            <td class="sub">${esc(i.note)}</td>
            <td class="sub">${i.lat != null ? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}` : '<span class="pill needs_location">missing</span>'}</td></tr>`).join('')}</tbody></table></div>
        <p></p>
        <label class="check"><input type="checkbox" id="p-reviewed"> Mark all as reviewed by the Pin City team</label>
        <label class="check"><input type="checkbox" id="p-publish"> Publish straight away (otherwise they go in as drafts)</label>
        <button class="primary" id="p-commit">Import selected</button>
      </div>`;
      $('#p-all').onchange = (e) => document.querySelectorAll('.p-sel').forEach((cb) => (cb.checked = e.target.checked));
      $('#p-commit').onclick = commit;
    }

    async function commit() {
      const city_id = $('#i-city').value;
      const category_id = $('#i-cat').value;
      if (!city_id || !category_id) return toast('Choose a city and a category first.');
      const items = [...document.querySelectorAll('.p-sel:checked')].map((cb) => preview.items[cb.dataset.n]);
      $('#p-commit').disabled = true;
      $('#p-commit').textContent = 'Importing…';
      try {
        // Send in batches so each request stays short (looking places up with Google takes a moment each).
        const r = { added: 0, duplicates: 0, located: 0, needs_location: 0, geocode_errors: [] };
        for (let i = 0; i < items.length; i += 25) {
          $('#p-commit').textContent = `Importing ${Math.min(i + 25, items.length)} of ${items.length}…`;
          const part = await api('/admin/import/commit', {
            method: 'POST',
            body: { city_id: Number(city_id), category_id: Number(category_id), items: items.slice(i, i + 25), team_reviewed: $('#p-reviewed').checked, publish: $('#p-publish').checked },
          });
          for (const k of ['added', 'duplicates', 'located', 'needs_location']) r[k] += part[k];
          r.geocode_errors.push(...part.geocode_errors);
        }
        $('#i-result').innerHTML = `<div class="card"><h3>Import finished</h3><ul class="help">
          <li>${r.added} added${r.located ? ` (${r.located} located with the Places API)` : ''}</li>
          <li>${r.duplicates} skipped as already in this city</li>
          ${r.needs_location ? `<li>${r.needs_location} need a location: <a href="#places?city_id=${city_id}&status=needs_location">fix them</a></li>` : ''}
          ${r.geocode_errors.map((e) => `<li class="error">${esc(e)}</li>`).join('')}
        </ul><a href="#places?city_id=${city_id}&category_id=${category_id}">Review the imported places</a></div>`;
      } catch (err) {
        toast(err.message);
        $('#p-commit').disabled = false;
        $('#p-commit').textContent = 'Import selected';
      }
    }
  },

  async categories(el) {
    await refreshLookups();
    el.innerHTML = `<div class="toolbar"><h1 class="grow">Categories</h1><button class="primary" id="add-cat">Add category</button></div>
      <p class="help">Only live categories are offered to users. Museums, nightclubs and kid-friendly are set up and ready to switch on.</p>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>Colour</th><th>Status</th><th></th></tr></thead>
      <tbody>${state.categories.map((c) => `<tr>
        <td>${esc(c.icon)} <b>${esc(c.name)}</b><div class="sub">${esc(c.slug)}</div></td>
        <td><span class="pill" style="background:${esc(c.color)};color:#fff">${esc(c.color)}</span></td>
        <td><span class="pill ${c.active ? 'published' : 'draft'}">${c.active ? 'Live' : 'Off'}</span></td>
        <td style="white-space:nowrap"><button class="link" data-edit="${c.id}">Edit</button> ·
          <button class="link" data-toggle="${c.id}">${c.active ? 'Switch off' : 'Switch on'}</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#add-cat').onclick = () => editCategory();
    el.onclick = async (e) => {
      const t = e.target;
      try {
        if (t.dataset.edit) await editCategory(catById(t.dataset.edit));
        if (t.dataset.toggle) {
          const c = catById(t.dataset.toggle);
          await api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } });
          route();
        }
      } catch (err) { toast(err.message); }
    };
  },
};

// ---------- editors ----------
async function editCity(city) {
  const v = await formDialog(city ? `Edit ${city.name}` : 'Add a city', `
    <div class="grid2">
      <label>Name <input name="name" required value="${esc(city?.name)}"></label>
      <label>Country <input name="country" value="${esc(city?.country)}"></label>
    </div>
    <label>Map centre: "lat, lng" or a Google Maps link <input name="centre" ${city ? '' : 'required'} placeholder="51.5074, -0.1278" value="${city ? `${city.lat}, ${city.lng}` : ''}"></label>
    <label>Starting zoom (10 = whole city, 15 = neighbourhood) <input name="zoom" type="number" min="3" max="19" value="${city?.zoom ?? 13}"></label>
    <label>Short description <textarea name="description">${esc(city?.description)}</textarea></label>
    <label class="check"><input type="checkbox" name="published" ${city?.published ? 'checked' : ''}> Live (users can subscribe)</label>`);
  if (!v) return;
  const centre = parseCentre(v.centre);
  if (!centre) return toast('Could not read the map centre. Use "lat, lng" or a Google Maps link.');
  const body = { name: v.name, country: v.country, zoom: Number(v.zoom), description: v.description, published: v.published, ...centre };
  try {
    await api(city ? `/admin/cities/${city.id}` : '/admin/cities', { method: city ? 'PATCH' : 'POST', body });
    toast('City saved');
    route();
  } catch (err) { toast(err.message); }
}

function parseCentre(s) {
  s = String(s || '').trim();
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/) || s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

async function editPlace(place = {}) {
  const isNew = !place.id;
  const v = await formDialog(isNew ? 'Add a place' : `Edit ${place.name}`, `
    <label>Name <input name="name" required value="${esc(place.name)}"></label>
    <div class="grid2">
      <label>City <select name="city_id" required>${options(state.cities, place.city_id, { blank: 'Choose' })}</select></label>
      <label>Category <select name="category_id" required>${options(state.categories, place.category_id, { blank: 'Choose', label: (c) => `${c.icon} ${c.name}` })}</select></label>
    </div>
    <label>Location: "lat, lng" or a Google Maps link with coordinates
      <input name="location_input" placeholder="${place.lat != null ? `${place.lat}, ${place.lng}` : 'Right-click the spot in Google Maps and copy the coordinates'}"></label>
    <label>Address <input name="address" value="${esc(place.address)}"></label>
    <div class="grid2">
      <label>Google Maps link <input name="google_maps_url" value="${esc(place.google_maps_url)}"></label>
      <label>Website <input name="website" value="${esc(place.website)}"></label>
    </div>
    <label>Team note (shown to users) <textarea name="team_note" placeholder="Why we love it, what to order…">${esc(place.team_note)}</textarea></label>
    <div class="grid2">
      <label>Visited on <input type="date" name="visited_on" value="${esc(place.visited_on)}"></label>
      <label>Status <select name="status">${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${(place.status || 'draft') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="team_reviewed" ${place.team_reviewed ? 'checked' : ''}> Reviewed in person by the Pin City team</label>`);
  if (!v) return;
  const body = { ...v, city_id: Number(v.city_id), category_id: Number(v.category_id), visited_on: v.visited_on || null };
  // If someone just added coordinates to a place waiting on them, let the server move it to draft.
  if (v.status === 'needs_location' && v.location_input) delete body.status;
  try {
    await api(isNew ? '/admin/places' : `/admin/places/${place.id}`, { method: isNew ? 'POST' : 'PATCH', body });
    toast('Place saved');
    route();
  } catch (err) { toast(err.message); }
}

async function editCategory(cat) {
  const v = await formDialog(cat ? `Edit ${cat.name}` : 'Add a category', `
    <label>Name <input name="name" required value="${esc(cat?.name)}"></label>
    <div class="grid2">
      <label>Icon (an emoji) <input name="icon" value="${esc(cat?.icon ?? '📍')}"></label>
      <label>Pin colour <input name="color" type="color" value="${esc(cat?.color ?? '#e4572e')}"></label>
    </div>`);
  if (!v) return;
  try {
    await api(cat ? `/admin/categories/${cat.id}` : '/admin/categories', { method: cat ? 'PATCH' : 'POST', body: v });
    toast('Category saved');
    route();
  } catch (err) { toast(err.message); }
}

// ---------- map ----------
let map;
function drawMap(el, places, city) {
  if (map) map.remove();
  map = L.map(el);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  const located = places.filter((p) => p.lat != null);
  for (const p of located) {
    const c = catById(p.category_id) || {};
    L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 2, fillColor: c.color, fillOpacity: p.status === 'published' ? 1 : 0.45 })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(c.icon)} ${esc(c.name)} · ${STATUS_LABEL[p.status]}`)
      .addTo(map);
  }
  if (located.length) map.fitBounds(located.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 15 });
  else if (city) map.setView([city.lat, city.lng], city.zoom);
  else map.setView([51.5074, -0.1278], 3);
}

// ---------- shell ----------
async function route() {
  const [name, query] = (location.hash.slice(1) || 'dashboard').split('?');
  const view = views[name] || views.dashboard;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${name}`));
  const el = $('#view');
  el.onclick = null;
  try { await view(el, new URLSearchParams(query || '')); } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

function showLogin() {
  $('#shell').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

async function start() {
  const me = await fetch('/api/auth/me').then((r) => r.json());
  if (!me || !me.is_admin) return showLogin();
  $('#who').textContent = me.email;
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  route();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const me = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
    if (!me.is_admin) { await api('/auth/logout', { method: 'POST' }); throw new Error('That account is not an admin.'); }
    $('#login-error').textContent = '';
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
};
$('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); showLogin(); };
window.addEventListener('hashchange', route);
start();
