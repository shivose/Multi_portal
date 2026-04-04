# Multi Login Portal

Multi-role web app (work reports, surveys, dashboard, custom portals). The UI is static files under `public/`; **all shared data is stored in one file on the server** (`data/portal-state.json`) and synced from every browser (including installed PWAs).

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) (or the port shown in the terminal).

## Progressive Web App (PWA)

The site is installable as a PWA:

- **`public/manifest.webmanifest`** — name, theme, icons, `standalone` display.
- **`public/sw.js`** — service worker that precaches the app shell (`index.html`, `styles.css`, `app.js`, manifest, icons). **`/api/*` is never cached** so data sync always hits the network when online.
- **Offline:** you can open the last cached shell without a network; Chart.js loads from CDN and needs connectivity. **`PORTAL_API_BASE`** must point at your API if the HTML is not served from the same origin.

**Install on a phone**

1. Deploy (or use local network access) with **HTTPS** in production; for local testing, Chrome desktop can still register the service worker on `http://localhost`.
2. Open the site in **Chrome** (Android) or **Safari** (iOS 16.4+ supports Web Push install flow for PWAs in many regions) / **Chrome** on iOS has limited install support.
3. Use the browser menu: **Install app** / **Add to Home screen**.

After UI updates, bump the `CACHE` constant in `sw.js` so clients fetch fresh shell files.

## Centralized data

- **API**
  - `GET /api/state` — returns `{ revision, state, updatedAt }`. The `state` object is the same JSON shape the app previously kept only in `localStorage`.
  - `PUT /api/state` — body `{ "revision": <number>, "state": { ... } }`. Uses optimistic locking: if `revision` does not match the server, the server responds `409` and the app reloads to avoid overwriting newer data.
- **On disk** (authoritative copy): `data/portal-state.json` (created automatically). Back up this file to back up the whole system (credentials, submissions, assignments, etc.).

Clients still mirror the latest state to `localStorage` for offline resilience and faster load; the server copy is what keeps phones, tablets, and desktops in sync.

### Security note

`PUT /api/state` is **not** authenticated in this repo. Run the app **behind HTTPS**, restrict who can reach your host (VPN, firewall, or a reverse proxy with auth), and treat deployment secrets seriously. For a public internet host, add your own auth layer in front of the API if needed.

## How an administrator accesses the data

1. **In the application (recommended)**  
   - Sign in with an account that has the **Administration** portal (default: username `admin`, password `admin123` until you change it under **Admin → User logins** or in a seeded `portal-state.json`).  
   - From the role picker, open **Administration** to manage logins, custom portals, and settings.  
   - For **reports and analytics**, use a **Dashboard** or **Supervisor** login (defaults documented on the login screen). The dashboard reads the same centralized `state` as everyone else.

2. **On the server**  
   - Inspect or back up `data/portal-state.json` on the machine where `node server.js` runs (Render disk, VPS, etc.).  
   - This file is JSON; you can pretty-print it with any editor or `jq`. It contains live credentials and personal data — handle it like a database dump.

3. **HTTP API (operators / automation)**  
   - `GET /api/state` returns the full document (same caution as the file). Use only on trusted networks or with extra protection.

## Deploy (e.g. Render)

- **Start command:** `npm start`  
- **Persistent disk:** mount a writable directory and set the app to store data there. This project writes to `data/portal-state.json` relative to the app root; ensure that `data/` is on persistent storage so reboots do not wipe submissions.

## Environment

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `JSON_BODY_LIMIT` | Max JSON body size for `PUT /api/state` (default `50mb`; photos are embedded as data URLs) |
