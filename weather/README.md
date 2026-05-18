# weather

Browser weather dashboard. Add cities or US ZIP codes, see current conditions, hourly forecast for the next 24 hours, and a 7-day outlook.

Vanilla ES modules, no build step. Locations are saved in `localStorage` so the app rehydrates the same set on reload.

## Data sources

All requests are funneled through `/proxy.js` (`window.proxyService.fetchJson`) — same CORS-bypass chain the stock app uses.

| Service | Used for | URL |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Current + hourly + 7-day daily forecast | `https://api.open-meteo.com/v1/forecast` |
| [Open-Meteo geocoder](https://open-meteo.com/en/docs/geocoding-api) | City / locality name search | `https://geocoding-api.open-meteo.com/v1/search` |
| [Zippopotam](https://www.zippopotam.us/) | US (and other) postal-code lookup → lat/lon | `https://api.zippopotam.us/{cc}/{zip}` |
| [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) | Precipitation radar tiles (past 2h + ~30-minute nowcast) | `https://api.rainviewer.com/public/weather-maps.json` |

None of these require an API key. The JSON index endpoints are routed through `/proxy.js`; tile PNGs are loaded directly by Leaflet (image requests don't need the CORS proxy).

## Search behaviour

`searchAny(q)` in `api.js` decides between the two paths:

- Strings matching `^[A-Z0-9 -]{3,11}$` **and** containing at least one digit are treated as postal codes — Zippopotam is queried first (US by default; pass `country` to switch).
- Everything else, plus failed postal lookups, falls back to Open-Meteo's name search.

## View modes

Toggle in the toolbar:

- **Cards** — the default. Tiles for each saved location plus a detail panel (current conditions, 24-hour hourly strip, 7-day forecast) for the active one.
- **Radar** — Leaflet map (OSM base) with a precipitation-radar overlay from RainViewer, markers for each saved location, and a play/scrub time slider covering the last ~2 hours plus a ~30-minute nowcast.

Radar mode is mounted lazily the first time you toggle to it (Leaflet is loaded eagerly so the global `L` is available without async juggling). To keep playback jitter-free, every frame is added as its own tile layer at opacity 0 up front; advancing the slider just bumps the active layer's opacity so the browser never has to re-fetch tiles mid-loop.

## Storage

One `localStorage` key, `heyming.weather.v1`:

```ts
{
  locations: {
    id: string;             // "geo:lat,lon" or "zip:cc:code:lat,lon"
    name: string;
    admin1?: string;        // state / province
    country?: string;
    countryCode?: string;
    latitude: number;
    longitude: number;
    zip?: string;
  }[];
  activeLocationId: string; // tile that's expanded in the detail view
  units: 'c' | 'f';
  autoRefresh: boolean;     // 5-minute interval refresh
  mode: 'cards' | 'radar';  // current view mode
}
```

State validation lives in `state.js` (the standard `createPrefs` lifecycle from `/play/shared/prefs.js`).

## Share URLs

`?lat=..&lon=..&name=..&units=f&mode=radar` adds a one-off "shared location" to the user's list (or activates the existing matching tile), remembers the chosen units, and (when `mode=radar` is present) opens straight into radar view. Sharing a URL never deletes someone's existing locations.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tailwind CDN, Leaflet CDN, proxy.js, app entry |
| `index.js` | DOM wiring, search box, tile + detail rendering, mode switching, auto-refresh |
| `api.js` | Open-Meteo + Zippopotam wrappers; WMO weather-code → emoji map |
| `state.js` | Persistent state shape, sanitization, share-URL helpers |
| `rainviewer.js` | RainViewer frame-index fetcher + tile-URL builder |
| `radar-map.js` | Leaflet wrapper: base map, location markers, time-stepped radar overlay, play/scrub controls |
| `style.css` | Custom styles on top of Tailwind (tiles, hourly strip, daily rows, radar map + slider) |
