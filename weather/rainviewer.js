// RainViewer — free precipitation-radar tile service.
// Public API: https://api.rainviewer.com/public/weather-maps.json
// Tile docs:  https://www.rainviewer.com/api/weather-maps-api.html
//
// We route the JSON index through window.proxyService.fetchJson so the
// app behaves identically to every other data fetch (and so an outage
// on the direct origin doesn't sink the radar view). Tile PNGs are loaded
// directly by Leaflet — the browser handles those, not us.

/**
 * @typedef {Object} RainviewerFrame
 * @property {number} t        Unix seconds (RainViewer's native time field).
 * @property {string} path     Tile-server path fragment, e.g. "/v2/radar/1715958000".
 */

/**
 * @typedef {Object} RainviewerFrameSet
 * @property {string} host                Tile host, e.g. "https://tilecache.rainviewer.com".
 * @property {string} generatedIso        ISO timestamp when the index was generated.
 * @property {RainviewerFrame[]} radarPast       Past 2h precipitation frames.
 * @property {RainviewerFrame[]} radarNowcast    Nowcast frames (~30 min ahead).
 */

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

function requireProxy() {
  if (!window.proxyService || typeof window.proxyService.fetchJson !== 'function') {
    throw new Error("Couldn't reach the radar service. Try reloading the page.");
  }
  return window.proxyService;
}

/**
 * Fetch the current RainViewer frame index. Returns past + nowcast radar
 * frames in time order.
 *
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<RainviewerFrameSet>}
 */
export async function fetchRainviewerFrames(opts = {}) {
  const proxy = requireProxy();
  /** @type {any} */
  const data = await proxy.fetchJson(RAINVIEWER_INDEX, {
    timeout: 12000,
    maxRetries: 1,
    signal: opts.signal,
    friendlyError: "Couldn't load radar frame index."
  });

  const host = String(data?.host || 'https://tilecache.rainviewer.com');
  const generatedIso = data?.generated
    ? new Date(Number(data.generated) * 1000).toISOString()
    : new Date().toISOString();

  const mapFrames = (/** @type {any[]} */ arr) =>
    Array.isArray(arr)
      ? arr
          .map((f) => ({ t: Number(f?.time), path: String(f?.path || '') }))
          .filter((f) => Number.isFinite(f.t) && f.path)
          .sort((a, b) => a.t - b.t)
      : [];

  return {
    host,
    generatedIso,
    radarPast: mapFrames(data?.radar?.past),
    radarNowcast: mapFrames(data?.radar?.nowcast)
  };
}

/**
 * Build a Leaflet-compatible tile URL template for a single RainViewer
 * frame. `{z}/{x}/{y}` placeholders are left for Leaflet to fill in.
 *
 * Color scheme `2` is RainViewer's "Universal Blue" radar palette, which
 * reads cleanly on a dark map. Flags `1_1` enable tile smoothing and
 * snow/rain discrimination.
 *
 * @param {RainviewerFrame} frame
 * @param {Object} opts
 * @param {string} opts.host
 * @param {'radar'} [opts.kind]   Always 'radar' for now. Kept as a knob
 *                                in case future revisions add a layer
 *                                toggle back.
 * @param {number} [opts.size]    256 or 512. Default 256 (matches Leaflet's
 *                                default `tileSize` so no zoomOffset hacks).
 * @returns {string}
 */
export function frameTileUrl(frame, opts) {
  const size = opts.size === 512 ? 512 : 256;
  return `${opts.host}${frame.path}/${size}/{z}/{x}/{y}/2/1_1.png`;
}
