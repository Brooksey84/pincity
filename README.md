# Pin City

Curated, team-reviewed places to eat and drink, pinned on a map for each city.

- **User app** at `/`: browse cities, subscribe, choose categories, see pins near you, get directions in Google Maps. Installable on a phone home screen and works offline for subscribed cities.
- **Admin dashboard** at `/admin`: manage cities, places, categories and team notes, and import your existing Google Maps lists.

## Put it online (Netlify)

The repo is set up for Netlify: the pages are served from `public/`, the API runs as a Netlify Function, and the data lives in Netlify Database (Postgres), which Netlify creates and sets up on the first deploy.

1. In Netlify: **Add new project › Import an existing project › GitHub**, and pick this repo. The build settings come from `netlify.toml`, so leave them as they are.
2. Before deploying, go to **Project configuration › Environment variables** and add:
   - `ADMIN_EMAIL`: the email you'll sign in to the admin with
   - `ADMIN_PASSWORD`: a strong password (you can change it later by changing this and redeploying)
   - Optional: `GOOGLE_MAPS_API_KEY` and `GOOGLE_PLACES_API_KEY` (see below)
3. Deploy. Netlify creates the database and applies `netlify/database/migrations/` as part of the deploy. If it doesn't, go to **Data & Storage › Database**, choose **Create a database manually**, then redeploy.
4. Open your site's address for the app, and add `/admin` for the dashboard.

## Run it on a computer (for development)

Needs Node 20 or newer. No database to install: locally it uses PGlite, a real Postgres that runs inside Node and stores data in `data/pglite`.

```bash
npm install
cp .env.example .env      # then set ADMIN_EMAIL / ADMIN_PASSWORD
npm run seed:demo         # optional: a London demo city with 6 sample places
npm start                 # http://localhost:3000 and http://localhost:3000/admin
npm test
```

Set `DATABASE_URL` to use any other Postgres instead (also works on Netlify, overriding Netlify Database).

The admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` is created (or promoted to admin) whenever the server starts.

### Google keys (optional, recommended)

| Variable | What it does | Without it |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Browser key for the Maps JavaScript API. The user app draws Google's map. | The app uses OpenStreetMap tiles. Everything else works the same. |
| `GOOGLE_PLACES_API_KEY` | Server key for the Places API (New). Imports look up coordinates, address and website for list items that arrive without them. | Those items are saved as **Needs location** and an admin pastes coordinates or a Google Maps link. |

Restrict the browser key to your domain in Google Cloud Console.

## How pins reach Google Maps

Google doesn't let other apps draw pins inside the Google Maps app, so Pin City does it in two ways:

1. **Pin City's own map** (the main experience). It shows the curated pins on a Google map (or OpenStreetMap), sorted by distance from you, and every pin has **Directions** and **Open in Google Maps** buttons that open the Google Maps app on that exact place.
2. **Add to Google Maps.** For subscribed cities, users can download a `.kml` file of their pins and import it once into [Google My Maps](https://www.google.com/maps/d/). That map then appears in the Google Maps app under *You › Maps*. It's a snapshot, so it doesn't update when the team adds places.

If you later want pins that update live inside a native app, the same API can feed a React Native / Expo app using the Google Maps SDK.

## Importing your Google Maps lists

Admin › Import list. Pick the city and category, upload a file, preview it, untick anything you don't want, and import. Places already in that city (same Google link, place id or name) are skipped, so re-importing an updated list is safe.

| Source | How to get it | Coordinates? |
|---|---|---|
| A shared list link (quickest) | Google Maps › open the list › **Share** › copy link, then paste it and press *Fetch list* | Yes. Uses Google's unofficial list endpoint, so it may stop working without notice; Takeout is the fallback |
| Saved lists ("Want to go", "Favourites", your own lists) | [Google Takeout](https://takeout.google.com) › select only **Saved** › one `.csv` per list | No. Looked up with the Places API, or flagged *Needs location* |
| Starred places | Takeout › **Maps (your places)** › `Saved Places.json` | Yes |
| Google My Maps | Map menu › *Export to KML/KMZ* › tick "Export to a .KML file" | Yes |
| Individual places | Paste Google Maps links, one per line | Only if the link contains them |


Import notes from the list (the Note/Comment columns) become the place's team note. You can also tick **Mark all as reviewed by the Pin City team** and **Publish straight away**.

## Data model

- **cities**: name, country, map centre and zoom, live/hidden
- **categories**: Restaurants and Bars are live; Museums, Nightclubs and Kid-friendly are set up and can be switched on in the admin
- **places**: city, category, location, Google link/place id, team note, *team reviewed* flag, visit date, status (`published`, `draft`, `needs_location`)
- **users / sessions**: email + password (scrypt), 30-day sessions
- **subscriptions**: user × city × category

Only `published` places in live cities and live categories reach users.

## API

Public: `GET /api/cities`, `GET /api/categories`, `GET /api/cities/:slug/pins?categories=food,drink`, `GET /api/cities/:slug/export.kml?categories=...`
Auth: `POST /api/auth/signup|login|logout`, `GET /api/auth/me`
User: `GET /api/me/subscriptions`, `PUT /api/me/subscriptions/:slug {categories: [...]}` (empty list unsubscribes), `GET /api/me/download` (everything the user is subscribed to, for offline use)
Admin (`/api/admin/...`): `stats`, `cities`, `categories`, `places` (+ `places/bulk`), `import/preview`, `import/commit`

## Layout

```
lib/app.js           Express app and all API routes
server.js            Runs it locally (API + pages)
netlify/functions/   Runs it on Netlify
netlify/database/    Schema migration Netlify applies on deploy (copy of lib/schema.js)
lib/db.js            Postgres connection (Netlify Database, DATABASE_URL, or local PGlite)
lib/schema.js        Tables and default categories
lib/importers.js     Takeout CSV / GeoJSON / KML / link parsers
lib/geocode.js       Places API lookups for imports
lib/kml.js           KML export for Google My Maps
lib/auth.js          Accounts and sessions
public/              User app (PWA)
public/admin/        Admin dashboard
scripts/             Build step and demo data
samples/             Example import files
test/                node:test suites
```

## Other hosts

Anything that runs Node with a Postgres database works (Render, Railway, Fly.io, a VPS): set `DATABASE_URL`, run `npm run build && npm start`, set `NODE_ENV=production` so session cookies are marked `Secure`, and serve it over HTTPS (needed for "near me" location on phones).
