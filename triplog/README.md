# triplog

Record real-world GPS trips in the browser and save them to your own Google Sheet. Live map (Leaflet + OpenStreetMap), distance, time, and speed update as you walk/run/drive; tap **Stop** and the trip is final, with every point still in the spreadsheet you can graph or export.

Vanilla ES modules. Reuses the shared Google helpers in [`../google-db/`](../google-db/) (GIS + Sheets API), so this app shares the **same** workbook the [todo app](../todo/) uses — Trip Log just adds two new tabs to it.

## Spreadsheet layout

Two tabs in the site workbook (created automatically on first run):

### `triplog-trips` — one row per recorded trip

| col | header | notes |
| --- | --- | --- |
| A | `id` | UUID |
| B | `name` | display name (e.g. "Trip Mar 14 18:50") |
| C | `startedAt` | ISO 8601 |
| D | `endedAt` | ISO 8601, blank while recording |
| E | `durationSec` | rounded seconds |
| F | `distanceMeters` | rounded meters |
| G | `pointCount` | number of GPS samples |
| H | `status` | `recording` or `complete` |

### `triplog-points` — one row per GPS sample, partitioned by `tripId`

| col | header | notes |
| --- | --- | --- |
| A | `tripId` | matches `triplog-trips.id` |
| B | `t` | ISO 8601 timestamp |
| C | `lat` | degrees |
| D | `lon` | degrees |
| E | `accuracy` | meters (radius reported by the device) |
| F | `altitude` | meters (blank when not provided) |
| G | `speed` | m/s (blank when not provided) |
| H | `heading` | degrees (blank when not provided) |

The points table grows linearly, so trips with many fixes will share rows. Filter on `tripId` (or use a pivot in Google Sheets) to chart a single trip.

## How recording works

1. **Sign in with Google** — uses the shared client id from [`../google-db/site-config.js`](../google-db/site-config.js) and the OAuth scope `drive.file`. The app opens (or creates) the same site workbook other apps on this origin use.
2. **Start** — appends a new row to `triplog-trips` with `status = recording`, then begins `navigator.geolocation.watchPosition({ enableHighAccuracy: true })`. The Wake Lock API keeps the screen on while you record.
3. **Live** — every accepted GPS fix:
   - extends the live polyline on the map,
   - updates distance / time / speed / accuracy stats,
   - lands in an in-memory point buffer.
4. **Buffered flush** — points are appended to `triplog-points` in batches every 5 seconds (single API call per flush). The trip-row stats (distance, duration, point count) are refreshed every 30 seconds while recording so the spreadsheet view stays useful even mid-trip.
5. **Stop** — last flush, then the trip row is updated with `endedAt`, final stats, and `status = complete`.

### Filtering & smoothing

The tracker drops samples that almost certainly aren't useful:

- accuracy worse than **50 m** (typically Wi-Fi/IP fallback, not real GPS),
- jumps that imply > **100 m/s** (≈ 360 km/h) of motion vs. the previous fix.

It also ignores sub-meter wiggle when accumulating distance to avoid GPS noise inflating the total.

## Limitations

- A spreadsheet isn't a real time-series database; very long trips will mean many rows in `triplog-points`. Sheets API quotas (~60 writes/min/user) are well clear of the batched flush rate.
- Browser GPS quality varies. iPhone Safari with the screen on is excellent (≈ 5–10 m); a desktop with no GPS chip will use Wi-Fi triangulation and may be useless outside cities.
- iOS Safari only fires the geolocation prompt from a user gesture — that's why the **Start** button asks for it explicitly rather than the page asking on load.
- HTTPS or `localhost` is required for the Geolocation API and the Wake Lock API. GitHub Pages is HTTPS, so deployed it just works.

## Run locally

From the **repository root**:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/triplog/` on a phone (or use Chrome devtools → Sensors → location override on a laptop to fake a path).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tailwind CDN, Leaflet CDN, GIS, app entry |
| `app.js` | Wire-up: auth, start/stop, live stats, trip list, replay dialog |
| `triplog-tracker.js` | Geolocation wrapper, Haversine distance, wake lock |
| `triplog-map.js` | Leaflet helpers (live map + replay map) |
| `triplog-sheets.js` | Trip + point row clients over `SiteDatabase` |
| `triplog-constants.js` | Table titles, column layouts, default trip name |
| (shared) [`../google-db/`](../google-db/) | OAuth + Sheets helpers (also used by todo) |
