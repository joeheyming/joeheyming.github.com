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

None of these require an API key.

## Search behaviour

`searchAny(q)` in `api.js` decides between the two paths:

- Strings matching `^[A-Z0-9 -]{3,11}$` **and** containing at least one digit are treated as postal codes — Zippopotam is queried first (US by default; pass `country` to switch).
- Everything else, plus failed postal lookups, falls back to Open-Meteo's name search.

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
}
```

State validation lives in `state.js` (the standard `createPrefs` lifecycle from `/play/shared/prefs.js`).

## Share URLs

`?lat=..&lon=..&name=..&units=f` adds a one-off "shared location" to the user's list (or activates the existing matching tile) and remembers the chosen units. Sharing a URL never deletes someone's existing locations.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tailwind CDN, proxy.js, app entry |
| `index.js` | DOM wiring, search box, tile + detail rendering, auto-refresh |
| `api.js` | Open-Meteo + Zippopotam wrappers; WMO weather-code → emoji map |
| `state.js` | Persistent state shape, sanitization, share-URL helpers |
| `style.css` | Custom styles on top of Tailwind (tiles, hourly strip, daily rows) |
