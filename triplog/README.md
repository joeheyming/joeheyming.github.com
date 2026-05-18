# triplog

Record real-world GPS trips in the browser. Live map (Leaflet + OpenStreetMap), distance, time, and speed update as you walk/run/drive; tap **Stop** and the trip is saved.

Vanilla ES modules, no build step, no sign-in. Trips and every GPS sample are stored locally in **IndexedDB** so the app is fully offline-capable and survives reloads.

## Storage layout

One IndexedDB database, `triplog`, with two object stores:

### `trips` — one record per recorded trip (key: `id`)

| field | notes |
| --- | --- |
| `id` | UUID (key path) |
| `name` | display name (e.g. "Trip Mar 14 18:50") |
| `startedAt` | ISO 8601 (also indexed for newest-first listing) |
| `endedAt` | ISO 8601, blank while recording |
| `durationSec` | rounded seconds |
| `distanceMeters` | rounded meters |
| `pointCount` | number of GPS samples |
| `status` | `recording` or `complete` |

### `points` — one record per GPS sample (auto-incrementing key)

| field | notes |
| --- | --- |
| `tripId` | matches `trips.id` (indexed for cursor reads) |
| `t` | epoch ms |
| `lat` | degrees |
| `lon` | degrees |
| `accuracy` | meters (radius reported by the device) |
| `altitude` | meters or `null` |
| `speed` | m/s or `null` |
| `heading` | degrees or `null` |

The points store grows linearly with the number of fixes across all trips. The `by_trip` index on `tripId` keeps "load one trip's path" a bounded cursor scan.

## How recording works

1. **Open** the page — IndexedDB opens (creating stores on first run); the trip list and a Leaflet map render immediately.
2. **Start** — appends a new `recording` record to `trips`, then begins `navigator.geolocation.watchPosition({ enableHighAccuracy: true })`. The Wake Lock API keeps the screen on while you record.
3. **Live** — every accepted GPS fix:
   - extends the live polyline on the map,
   - updates distance / time / speed / accuracy stats,
   - lands in an in-memory point buffer.
4. **Buffered flush** — the buffer drains into the `points` store every 2 seconds (one transaction per flush). The trip record's stats (distance, duration, point count) are refreshed every 5 seconds while recording so reloading mid-trip preserves a near-current snapshot.
5. **Stop** — last flush, then the trip record is updated with `endedAt`, final stats, and `status = complete`.

### Filtering & smoothing

The tracker drops samples that almost certainly aren't useful:

- accuracy worse than **50 m** (typically Wi-Fi/IP fallback, not real GPS),
- jumps that imply > **100 m/s** (≈ 360 km/h) of motion vs. the previous fix.

Sub-meter wiggle is ignored when accumulating distance to avoid GPS noise inflating the total.

## Limitations

- Storage is per-browser-profile, per-origin. Trips don't sync across devices and aren't backed up. Clearing browser site data wipes them.
- Browser GPS quality varies. iPhone Safari with the screen on is excellent (≈ 5–10 m); a desktop with no GPS chip will use Wi-Fi triangulation and may be useless outside cities.
- iOS Safari only fires the geolocation prompt from a user gesture — that's why the **Start** button asks for it explicitly rather than the page asking on load.
- HTTPS or `localhost` is required for both Geolocation and Wake Lock APIs. Plain `http://192.168.x.x` LAN URLs will not get GPS — use `localhost`, deploy to GitHub Pages, or run an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:8000`).
- Private/Incognito windows usually disable IndexedDB; the app shows a friendly error instead of pretending to record.

## Run locally

From the **repository root**:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/triplog/` on a phone (or use Chrome DevTools → Sensors → location override on a laptop to fake a path).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tailwind CDN, Leaflet CDN, app entry |
| `app.js` | Wire-up: DB init, start/stop, live stats, trip list, replay dialog |
| `triplog-tracker.js` | Geolocation wrapper, Haversine distance, wake lock |
| `triplog-map.js` | Leaflet helpers (live map + replay map) |
| `triplog-db.js` | IndexedDB client (trips + points stores) |
| `triplog-constants.js` | `TRIP_STATUS`, `defaultTripName` |
