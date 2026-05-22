// Weather app API — talks to Open-Meteo (forecast + geocoding) and
// Zippopotam (US/CA/etc ZIP/postal lookup) through window.proxyService.
//
// All endpoints are CORS-friendly in theory, but we still route through
// /proxy.js so the app behaves identically to the stock dashboard and
// survives the occasional flaky network. fetchJson() handles retries,
// timeouts, and friendly error messages.
//
// Why Open-Meteo? Free, no API key, gives current + hourly + daily
// forecast in one call. Why Zippopotam? Open-Meteo's geocoder doesn't
// reliably accept bare postal codes, but Zippopotam does (and is
// likewise key-free).

/**
 * @typedef {Object} GeoHit
 * @property {string} id            Stable string id ("lat,lon" or zip:country:code).
 * @property {string} name          City / locality name.
 * @property {string} [admin1]      State / province.
 * @property {string} [country]
 * @property {string} [countryCode] ISO-3166-1 alpha-2.
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [zip]         When the hit originated from a zip lookup.
 * @property {number} [population]
 */

/**
 * @typedef {Object} CurrentWeather
 * @property {string} timeIso
 * @property {number} temperatureC
 * @property {number} apparentC
 * @property {number} humidity
 * @property {number} windKph
 * @property {number} windDirection  Degrees.
 * @property {number} weatherCode    WMO code; see weatherCodeMeta().
 * @property {boolean} isDay
 * @property {number} [precipitationMm]
 * @property {number} [pressureHpa]
 */

/**
 * @typedef {Object} HourlyPoint
 * @property {number} t              Unix ms.
 * @property {number} temperatureC
 * @property {number} apparentC
 * @property {number} precipitationProb  0..100.
 * @property {number} precipitationMm
 * @property {number} weatherCode
 * @property {boolean} isDay
 * @property {number} windKph
 */

/**
 * @typedef {Object} DailyPoint
 * @property {number} t              Unix ms (midnight local).
 * @property {string} dateIso
 * @property {number} tempMaxC
 * @property {number} tempMinC
 * @property {number} weatherCode
 * @property {number} precipitationMm
 * @property {number} precipitationProb
 * @property {string} [sunriseIso]
 * @property {string} [sunsetIso]
 * @property {number} [uvIndexMax]
 * @property {number} [windKphMax]
 */

/**
 * @typedef {Object} Forecast
 * @property {string} timezone
 * @property {number} utcOffsetSeconds
 * @property {number} elevationM
 * @property {CurrentWeather} current
 * @property {HourlyPoint[]} hourly
 * @property {DailyPoint[]} daily
 */

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const ZIPPOPOTAM_BASE = 'https://api.zippopotam.us';

function requireProxy() {
  if (!window.proxyService || typeof window.proxyService.fetchJson !== 'function') {
    throw new Error("Couldn't reach the weather service. Try reloading the page.");
  }
  return window.proxyService;
}

/**
 * Open-Meteo signals API errors with `{ error: true, reason: "..." }` and an
 * HTTP 4xx status. The CORS proxies we fall back to pass that JSON body
 * through with their own 200 status, so `proxy.fetchJson` happily returns
 * the error envelope instead of throwing. Catch it explicitly so callers
 * see a real Error (and the user sees the reason — usually "Daily API
 * request limit exceeded" when the shared proxy IP is over quota).
 *
 * @param {any} data
 * @param {string} fallback
 */
function ensureNotOpenMeteoError(data, fallback) {
  if (data && typeof data === 'object' && data.error === true) {
    const reason = typeof data.reason === 'string' && data.reason ? data.reason : fallback;
    throw new Error(reason);
  }
}

function buildUrl(base, params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

/** Matches "12345", "12345-1234", "K1A 0A6", "SW1A 1AA" — loose enough to feed Zippopotam. */
const POSTAL_RE = /^[A-Z0-9][A-Z0-9 -]{2,9}[A-Z0-9]$/i;

/**
 * Decide whether the query looks like a postal code rather than a city name.
 * Conservative: anything with letters AND no digits is treated as a city.
 *
 * @param {string} q
 * @returns {boolean}
 */
export function looksLikePostalCode(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (!POSTAL_RE.test(s)) return false;
  // Must contain at least one digit — pure-letter strings ("LA", "NYC") are cities.
  return /\d/.test(s);
}

/**
 * Look up a US zip code (or other Zippopotam-supported country) and turn it
 * into one or more GeoHit rows. Defaults to country "us" but the caller can
 * pass `country: 'ca'`, etc.
 *
 * @param {string} zip
 * @param {Object} [opts]
 * @param {string} [opts.country] ISO-3166-1 alpha-2, lowercased. Default 'us'.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<GeoHit[]>}
 */
export async function lookupZip(zip, opts = {}) {
  const code = String(zip || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!code) return [];
  const country = (opts.country || 'us').toLowerCase();
  const url = `${ZIPPOPOTAM_BASE}/${encodeURIComponent(country)}/${encodeURIComponent(code)}`;
  const proxy = requireProxy();

  /** @type {any} */
  let data;
  try {
    data = await proxy.fetchJson(url, {
      timeout: 10000,
      maxRetries: 1,
      signal: opts.signal,
      // Zippopotam allows CORS; try the user's own IP first so we don't burn
      // the shared proxy's quota on a tiny postal lookup.
      skipDirect: false
    });
  } catch {
    return [];
  }

  const places = Array.isArray(data?.places) ? data.places : [];
  return places
    .map((p) => {
      const lat = Number(p.latitude);
      const lon = Number(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `zip:${country}:${code}:${lat.toFixed(3)},${lon.toFixed(3)}`,
        name: String(p['place name'] || ''),
        admin1: String(p['state'] || p['state abbreviation'] || ''),
        country: String(data['country'] || ''),
        countryCode: String(data['country abbreviation'] || country.toUpperCase()),
        latitude: lat,
        longitude: lon,
        zip: code
      };
    })
    .filter(Boolean);
}

/**
 * Search Open-Meteo's geocoder for matching cities / localities. Returns up
 * to `count` hits, deduped by lat/lon.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.count]   Default 10.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<GeoHit[]>}
 */
export async function searchPlaces(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const url = buildUrl(OPEN_METEO_GEOCODE, {
    name: q,
    count: opts.count ?? 10,
    language: 'en',
    format: 'json'
  });

  const proxy = requireProxy();
  /** @type {any} */
  let data;
  try {
    data = await proxy.fetchJson(url, {
      timeout: 10000,
      maxRetries: 1,
      signal: opts.signal,
      friendlyError: "Couldn't read place search results. Try again in a moment.",
      // Open-Meteo's geocoder allows CORS; direct first avoids the shared
      // proxy's daily quota.
      skipDirect: false
    });
    ensureNotOpenMeteoError(data, "Couldn't read place search results. Try again in a moment.");
  } catch {
    return [];
  }

  const results = Array.isArray(data?.results) ? data.results : [];
  /** @type {Map<string, GeoHit>} */
  const seen = new Map();
  for (const r of results) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `geo:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name: String(r.name || ''),
      admin1: typeof r.admin1 === 'string' ? r.admin1 : '',
      country: typeof r.country === 'string' ? r.country : '',
      countryCode: typeof r.country_code === 'string' ? r.country_code : '',
      latitude: lat,
      longitude: lon,
      population: typeof r.population === 'number' ? r.population : undefined
    });
  }
  return [...seen.values()];
}

/**
 * Unified search: if the query looks like a postal code, try Zippopotam
 * first (and fall through to city search if that misses). Otherwise just
 * search by name.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.country]
 * @returns {Promise<GeoHit[]>}
 */
export async function searchAny(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (looksLikePostalCode(q)) {
    const hits = await lookupZip(q, opts);
    if (hits.length) return hits;
  }
  return searchPlaces(q, opts);
}

/**
 * Fetch a multi-day forecast for one location. Always asks for current,
 * hourly (next 48h), and 7-day daily blocks.
 *
 * @param {{ latitude: number, longitude: number }} loc
 * @param {Object} [opts]
 * @param {'fahrenheit'|'celsius'} [opts.tempUnit]   Server-side temperature unit. Default celsius.
 * @param {'kmh'|'mph'} [opts.windUnit]              Default kmh.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Forecast>}
 */
export async function fetchForecast(loc, opts = {}) {
  const lat = Number(loc?.latitude);
  const lon = Number(loc?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('latitude/longitude required');
  }

  const url = buildUrl(OPEN_METEO_FORECAST, {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'is_day',
      'precipitation',
      'pressure_msl',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m'
    ].join(','),
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'is_day'
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'sunrise',
      'sunset',
      'uv_index_max',
      'wind_speed_10m_max'
    ].join(','),
    timezone: 'auto',
    forecast_days: 7,
    temperature_unit: opts.tempUnit || 'celsius',
    wind_speed_unit: opts.windUnit || 'kmh'
  });

  const proxy = requireProxy();
  /** @type {any} */
  const data = await proxy.fetchJson(url, {
    timeout: 15000,
    maxRetries: 2,
    signal: opts.signal,
    friendlyError: "Couldn't read forecast data for that location.",
    // Open-Meteo's forecast API allows CORS; try the user's own IP first so
    // we don't pile onto the shared proxy IP's daily 10k-call quota (when
    // that quota is hit, Open-Meteo returns {error: true, reason: ...} and
    // the proxy passes the body through with HTTP 200 — see ensureNotOpenMeteoError).
    skipDirect: false
  });
  ensureNotOpenMeteoError(data, "Couldn't read forecast data for that location.");

  const tz = String(data?.timezone || 'UTC');
  const utcOffset = Number(data?.utc_offset_seconds || 0);
  const elev = Number(data?.elevation || 0);

  // Defense in depth: if the response made it past ensureNotOpenMeteoError
  // but somehow has no `current` block, refuse to render a tile full of NaN.
  if (!data || typeof data.current !== 'object' || data.current === null) {
    throw new Error('Forecast data was incomplete. Try again in a moment.');
  }

  const c = data.current;
  /** @type {CurrentWeather} */
  const current = {
    timeIso: String(c.time || ''),
    temperatureC: Number(c.temperature_2m),
    apparentC: Number(c.apparent_temperature),
    humidity: Number(c.relative_humidity_2m),
    windKph: Number(c.wind_speed_10m),
    windDirection: Number(c.wind_direction_10m),
    weatherCode: Number(c.weather_code),
    isDay: Number(c.is_day) === 1,
    precipitationMm: typeof c.precipitation === 'number' ? c.precipitation : undefined,
    pressureHpa: typeof c.pressure_msl === 'number' ? c.pressure_msl : undefined
  };

  const h = data?.hourly || {};
  /** @type {HourlyPoint[]} */
  const hourly = [];
  const hTimes = Array.isArray(h.time) ? h.time : [];
  for (let i = 0; i < hTimes.length; i++) {
    const t = Date.parse(hTimes[i]);
    if (!Number.isFinite(t)) continue;
    hourly.push({
      t,
      temperatureC: Number(h.temperature_2m?.[i]),
      apparentC: Number(h.apparent_temperature?.[i]),
      precipitationProb: Number(h.precipitation_probability?.[i] || 0),
      precipitationMm: Number(h.precipitation?.[i] || 0),
      weatherCode: Number(h.weather_code?.[i]),
      isDay: Number(h.is_day?.[i]) === 1,
      windKph: Number(h.wind_speed_10m?.[i] || 0)
    });
  }

  const d = data?.daily || {};
  /** @type {DailyPoint[]} */
  const daily = [];
  const dTimes = Array.isArray(d.time) ? d.time : [];
  for (let i = 0; i < dTimes.length; i++) {
    const t = Date.parse(dTimes[i]);
    if (!Number.isFinite(t)) continue;
    daily.push({
      t,
      dateIso: String(dTimes[i]),
      tempMaxC: Number(d.temperature_2m_max?.[i]),
      tempMinC: Number(d.temperature_2m_min?.[i]),
      weatherCode: Number(d.weather_code?.[i]),
      precipitationMm: Number(d.precipitation_sum?.[i] || 0),
      precipitationProb: Number(d.precipitation_probability_max?.[i] || 0),
      sunriseIso: typeof d.sunrise?.[i] === 'string' ? d.sunrise[i] : undefined,
      sunsetIso: typeof d.sunset?.[i] === 'string' ? d.sunset[i] : undefined,
      uvIndexMax: typeof d.uv_index_max?.[i] === 'number' ? d.uv_index_max[i] : undefined,
      windKphMax:
        typeof d.wind_speed_10m_max?.[i] === 'number' ? d.wind_speed_10m_max[i] : undefined
    });
  }

  return {
    timezone: tz,
    utcOffsetSeconds: utcOffset,
    elevationM: elev,
    current,
    hourly,
    daily
  };
}

/**
 * @typedef {Object} ModelComparison
 * @property {string} timezone
 * @property {number} utcOffsetSeconds
 * @property {number[]} times                 Unix ms timestamps (168 entries for forecast_days=7).
 * @property {Map<string, Record<string, Array<number | null>>>} byModel
 *           Per-model series, keyed by the Open-Meteo model id (`icon_seamless`,
 *           `gfs_seamless`, `ecmwf_ifs025`). Inner record is variable -> values[].
 */

/** Default model set used by the Compare view. */
export const COMPARE_MODELS = [
  { id: 'icon_seamless', label: 'DWD ICON', short: 'ICON' },
  { id: 'gfs_seamless', label: 'NCEP GFS', short: 'GFS' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', short: 'ECMWF' }
];

/** Variables we expose in the Compare view's picker. */
export const COMPARE_VARIABLES = [
  { id: 'temperature_2m', label: 'Temperature', emoji: '🌡', unit: '°C', tone: 'warm' },
  { id: 'precipitation', label: 'Precipitation', emoji: '🌧', unit: 'mm/h', tone: 'rain' },
  { id: 'wind_speed_10m', label: 'Wind', emoji: '💨', unit: 'km/h', tone: 'wind' },
  { id: 'cloud_cover', label: 'Cloud cover', emoji: '☁', unit: '%', tone: 'cloud' },
  { id: 'relative_humidity_2m', label: 'Humidity', emoji: '💧', unit: '%', tone: 'humid' },
  { id: 'pressure_msl', label: 'Pressure', emoji: '🌀', unit: 'hPa', tone: 'pressure' }
];

/**
 * Fetch a multi-model hourly comparison for one location. The API call
 * requests every variable in {@link COMPARE_VARIABLES} from every model
 * in {@link COMPARE_MODELS} in a single round-trip — Open-Meteo returns
 * per-model parallel series like `temperature_2m_icon_seamless`,
 * `temperature_2m_gfs_seamless`, etc.
 *
 * The default window is 7 forecast days (168 entries). Pass `pastDays`
 * to also include reanalysis for days before today — used by the
 * day-over-day overlay (yesterday vs tomorrow) to fetch
 * `past_days=1&forecast_days=2` in one shot.
 *
 * @param {{ latitude: number, longitude: number }} loc
 * @param {Object} [opts]
 * @param {number} [opts.pastDays]      0–7, default 0.
 * @param {number} [opts.forecastDays]  1–16, default 7.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ModelComparison>}
 */
export async function fetchModelComparison(loc, opts = {}) {
  const lat = Number(loc?.latitude);
  const lon = Number(loc?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('latitude/longitude required');
  }

  const forecastDays = Math.max(1, Math.min(16, Math.round(opts.forecastDays ?? 7)));
  const pastDays = Math.max(0, Math.min(7, Math.round(opts.pastDays ?? 0)));

  const hourlyVars = COMPARE_VARIABLES.map((v) => v.id).join(',');
  const modelIds = COMPARE_MODELS.map((m) => m.id).join(',');
  /** @type {Record<string, string | number>} */
  const params = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: hourlyVars,
    models: modelIds,
    forecast_days: forecastDays,
    timezone: 'auto'
  };
  if (pastDays > 0) params.past_days = pastDays;
  const url = buildUrl(OPEN_METEO_FORECAST, params);

  const proxy = requireProxy();
  /** @type {any} */
  const data = await proxy.fetchJson(url, {
    timeout: 15000,
    maxRetries: 1,
    signal: opts.signal,
    friendlyError: "Couldn't read comparison data for that location.",
    skipDirect: false
  });
  ensureNotOpenMeteoError(data, "Couldn't read comparison data for that location.");

  const h = data?.hourly || {};
  const times = Array.isArray(h.time) ? h.time : [];
  /** @type {number[]} */
  const tsMs = [];
  for (const iso of times) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) tsMs.push(t);
  }

  /** @type {Map<string, Record<string, Array<number | null>>>} */
  const byModel = new Map();
  for (const m of COMPARE_MODELS) {
    /** @type {Record<string, Array<number | null>>} */
    const series = {};
    for (const v of COMPARE_VARIABLES) {
      const key = `${v.id}_${m.id}`;
      const arr = Array.isArray(h[key]) ? h[key] : [];
      series[v.id] = arr.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
    }
    byModel.set(m.id, series);
  }

  return {
    timezone: String(data?.timezone || 'UTC'),
    utcOffsetSeconds: Number(data?.utc_offset_seconds || 0),
    times: tsMs,
    byModel
  };
}

/**
 * Fetch forecasts for many locations in parallel; never throws — failed
 * lookups come back as `{ id, error }` rows so the caller can render an
 * inline error tile instead of blowing up the whole page.
 *
 * @param {Array<{ id: string, latitude: number, longitude: number }>} locations
 * @param {Object} [opts]
 * @param {'fahrenheit'|'celsius'} [opts.tempUnit]
 * @param {'kmh'|'mph'} [opts.windUnit]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{ id: string, forecast?: Forecast, error?: string }>>}
 */
export async function fetchManyForecasts(locations, opts = {}) {
  return Promise.all(
    locations.map(async (loc) => {
      try {
        const forecast = await fetchForecast(loc, opts);
        return { id: loc.id, forecast };
      } catch (err) {
        return { id: loc.id, error: err?.message || String(err) };
      }
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────
// WMO weather code → label + emoji.
// Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {number} code WMO weather code.
 * @param {boolean} [isDay] Used to pick between sun/moon for clear skies.
 * @returns {{ label: string, emoji: string }}
 */
export function weatherCodeMeta(code, isDay = true) {
  const c = Number(code);
  if (c === 0) return { label: 'Clear', emoji: isDay ? '☀️' : '🌙' };
  if (c === 1) return { label: 'Mainly clear', emoji: isDay ? '🌤️' : '🌙' };
  if (c === 2) return { label: 'Partly cloudy', emoji: isDay ? '⛅' : '☁️' };
  if (c === 3) return { label: 'Overcast', emoji: '☁️' };
  if (c === 45 || c === 48) return { label: 'Fog', emoji: '🌫️' };
  if (c === 51) return { label: 'Light drizzle', emoji: '🌦️' };
  if (c === 53) return { label: 'Drizzle', emoji: '🌦️' };
  if (c === 55) return { label: 'Dense drizzle', emoji: '🌧️' };
  if (c === 56 || c === 57) return { label: 'Freezing drizzle', emoji: '🌧️❄️' };
  if (c === 61) return { label: 'Light rain', emoji: '🌦️' };
  if (c === 63) return { label: 'Rain', emoji: '🌧️' };
  if (c === 65) return { label: 'Heavy rain', emoji: '🌧️' };
  if (c === 66 || c === 67) return { label: 'Freezing rain', emoji: '🌧️❄️' };
  if (c === 71) return { label: 'Light snow', emoji: '🌨️' };
  if (c === 73) return { label: 'Snow', emoji: '❄️' };
  if (c === 75) return { label: 'Heavy snow', emoji: '❄️' };
  if (c === 77) return { label: 'Snow grains', emoji: '🌨️' };
  if (c === 80) return { label: 'Rain showers', emoji: '🌦️' };
  if (c === 81) return { label: 'Rain showers', emoji: '🌧️' };
  if (c === 82) return { label: 'Violent rain showers', emoji: '⛈️' };
  if (c === 85 || c === 86) return { label: 'Snow showers', emoji: '🌨️' };
  if (c === 95) return { label: 'Thunderstorm', emoji: '⛈️' };
  if (c === 96 || c === 99) return { label: 'Thunderstorm w/ hail', emoji: '⛈️' };
  return { label: 'Unknown', emoji: '❓' };
}
