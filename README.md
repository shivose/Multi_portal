# Multi Login Portal

Multi-role web app (work reports, surveys, kitchen forms, dashboard, reminders, calendar, custom portals). The UI is static files under `public/`; **all shared data is stored in one file on the server** (`data/portal-state.json`) and synced from every browser or Android client.

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

## Android APK (Capacitor)

The `android/` project wraps the same web app. Generated APKs are **not** committed (see `android/.gitignore`).

### Option A — Load your deployed site in the WebView (simplest for sync)

1. Edit root `capacitor.config.json` and add a `server` block with your **HTTPS** URL (same origin as your API), for example:

   ```json
   {
     "appId": "com.multilogin.portal",
     "appName": "Multi Login Portal",
     "webDir": "public",
     "server": {
       "url": "https://your-app.example.com",
       "androidScheme": "https"
     }
   }
   ```

2. Sync and open Android Studio:

   ```bash
   npm run cap:sync
   npm run cap:open
   ```

3. In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The output path is shown in the **Build** tool window (often under `android/app/build/outputs/apk/`).

### Option B — Bundled web assets in the APK

1. Leave `server` **out** of `capacitor.config.json` (default in this repo).
2. Set `window.PORTAL_API_BASE` in `public/index.html` to the **full origin** of your API (e.g. `https://your-app.example.com`) so `GET`/`PUT /api/state` hit the right host (the bundled UI is not served from that origin).
3. Run `npm run cap:sync`, then build the APK in Android Studio as above.

**Requirements:** Android Studio, Android SDK, and JDK as required by current Capacitor/Android Gradle. Run `npm run cap:sync` after changing files in `public/` before each release build.

### Download a pre-built debug APK (GitHub)

If you do not have Android Studio locally, use the automated build:

1. Open the repository’s **Actions** tab on GitHub.
2. Select the **Build debug APK** workflow and open the latest successful run.
3. Under **Artifacts**, download **`multi-login-portal-debug-apk`** (ZIP contains `app-debug.apk`).
4. On your phone, allow install from unknown sources if prompted, then open the APK (e.g. from Files or the Downloads app).

**Note:** The default Capacitor config loads the bundled `public/` UI. Set `PORTAL_API_BASE` in `public/index.html` to your live server URL (see README above) and push, or add a `server.url` in `capacitor.config.json`, then wait for a new Actions build so the app can reach your backend.

## Deploy (e.g. Render)

- **Start command:** `npm start`  
- **Persistent disk:** mount a writable directory and set the app to store data there. This project writes to `data/portal-state.json` relative to the app root; ensure that `data/` is on persistent storage so reboots do not wipe submissions.

## Environment

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `JSON_BODY_LIMIT` | Max JSON body size for `PUT /api/state` (default `50mb`; photos are embedded as data URLs) |
