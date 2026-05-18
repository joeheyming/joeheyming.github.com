// Weather app — state shape + localStorage persistence.
// Same `createPrefs` pattern the stock app uses: validated load, debounced
// save, URL-state hooks so share links resurrect the saved locations on a
// fresh browser.

import { createPrefs } from '/play/shared/prefs.js';

/**
 * @typedef {Object} SavedLocation
 * @property {string} id
 * @property {string} name          City / locality.
 * @property {string} [admin1]      State / province.
 * @property {string} [country]
 * @property {string} [countryCode]
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [zip]
 */

/**
 * @typedef {Object} AppState
 * @property {SavedLocation[]} locations
 * @property {string} activeLocationId   Empty string until the user picks one.
 * @property {'c'|'f'} units             Temperature units.
 * @property {boolean} autoRefresh       Refresh every ~5 minutes.
 * @property {'cards'|'radar'} mode      View mode: forecast cards or radar map.
 */

export const STORAGE_KEY = 'heyming.weather.v1';

/** @returns {AppState} */
export function defaultState() {
  return {
    locations: [],
    activeLocationId: '',
    units: 'f',
    autoRefresh: true,
    mode: 'cards'
  };
}

/** @returns {AppState} */
export function sanitize(raw) {
  const d = defaultState();
  const r = raw && typeof raw === 'object' ? raw : {};
  /** @type {SavedLocation[]} */
  const locations = Array.isArray(r.locations)
    ? r.locations
        .map((loc) => {
          if (!loc || typeof loc !== 'object') return null;
          const lat = Number(loc.latitude);
          const lon = Number(loc.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            id: typeof loc.id === 'string' && loc.id ? loc.id : `geo:${lat.toFixed(3)},${lon.toFixed(3)}`,
            name: typeof loc.name === 'string' ? loc.name : '',
            admin1: typeof loc.admin1 === 'string' ? loc.admin1 : '',
            country: typeof loc.country === 'string' ? loc.country : '',
            countryCode: typeof loc.countryCode === 'string' ? loc.countryCode : '',
            latitude: lat,
            longitude: lon,
            zip: typeof loc.zip === 'string' ? loc.zip : undefined
          };
        })
        .filter(/** @returns {x is SavedLocation} */ (x) => x !== null)
    : [];

  // Drop dupes by id while preserving order.
  const seen = new Set();
  const dedup = [];
  for (const loc of locations) {
    if (seen.has(loc.id)) continue;
    seen.add(loc.id);
    dedup.push(loc);
  }

  /** @type {AppState} */
  const out = {
    locations: dedup,
    activeLocationId:
      typeof r.activeLocationId === 'string' && dedup.some((l) => l.id === r.activeLocationId)
        ? r.activeLocationId
        : dedup[0]?.id || '',
    units: r.units === 'c' ? 'c' : r.units === 'f' ? 'f' : d.units,
    autoRefresh: r.autoRefresh !== false,
    mode: r.mode === 'radar' ? 'radar' : 'cards'
  };
  return out;
}

/**
 * URL state encodes one optional shared location:
 *   ?lat=37.77&lon=-122.42&name=San+Francisco&units=f
 * Loading a share URL appends/activates that location without nuking the
 * user's existing list.
 */
export function readUrlState() {
  if (typeof location === 'undefined') return null;
  const url = new URL(location.href);
  const sp = url.searchParams;
  if (![...sp.keys()].length) return null;
  /** @type {any} */
  const out = {};
  const lat = Number(sp.get('lat'));
  const lon = Number(sp.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.__sharedLocation = {
      id: `geo:${lat.toFixed(3)},${lon.toFixed(3)}`,
      name: sp.get('name') || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      admin1: sp.get('admin1') || '',
      country: sp.get('country') || '',
      countryCode: sp.get('cc') || '',
      latitude: lat,
      longitude: lon
    };
  }
  const u = sp.get('units');
  if (u === 'c' || u === 'f') out.units = u;
  const m = sp.get('mode');
  if (m === 'cards' || m === 'radar') out.mode = m;
  return Object.keys(out).length ? out : null;
}

function _mergeSharedLocation(state, shared) {
  if (!shared) return state;
  const exists = state.locations.find((l) => l.id === shared.id);
  if (exists) {
    return { ...state, activeLocationId: shared.id };
  }
  return {
    ...state,
    locations: [...state.locations, shared],
    activeLocationId: shared.id
  };
}

const _prefs = createPrefs({
  key: STORAGE_KEY,
  defaults: defaultState,
  sanitize: (raw) => {
    let s = sanitize(raw);
    if (raw && raw.__sharedLocation) {
      s = sanitize(_mergeSharedLocation(s, raw.__sharedLocation));
    }
    return s;
  },
  readUrlState
});

/** @returns {AppState} */
export function loadInitialState() {
  return _prefs.load();
}

export function saveState(state) {
  _prefs.save(state);
}

/**
 * Build a share URL for the currently active location (if any).
 *
 * @param {AppState} state
 * @returns {string}
 */
export function buildShareUrl(state) {
  if (typeof location === 'undefined') return '';
  const url = new URL(location.href);
  url.search = '';
  const active = state.locations.find((l) => l.id === state.activeLocationId);
  if (active) {
    url.searchParams.set('lat', active.latitude.toFixed(4));
    url.searchParams.set('lon', active.longitude.toFixed(4));
    if (active.name) url.searchParams.set('name', active.name);
    if (active.admin1) url.searchParams.set('admin1', active.admin1);
    if (active.country) url.searchParams.set('country', active.country);
    if (active.countryCode) url.searchParams.set('cc', active.countryCode);
  }
  url.searchParams.set('units', state.units);
  if (state.mode === 'radar') url.searchParams.set('mode', 'radar');
  return url.toString();
}
