/**
 * Thin wrapper around Leaflet (loaded from CDN by `index.html`) so the
 * rest of the app doesn't have to know about marker layers, projections,
 * or that fiddly auto-recenter dance.
 *
 * Two flavours:
 *
 *   • `createLiveMap(container)` — used while a trip is recording. Has
 *     `addLivePoint({lat, lon})` that extends a polyline and pans the
 *     camera so the latest fix stays visible (only when the user hasn't
 *     manually dragged the map).
 *
 *   • `createReplayMap(container)` — used for "view past trip". Draws
 *     the whole polyline at once and zooms to fit.
 *
 * Both expose `destroy()` so the caller can swap maps cleanly.
 */

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * How much to shrink the viewport when deciding whether to auto-pan.
 * `-0.2` keeps the user inside the middle 60% of the visible area;
 * once they drift past that "safe zone" we pan to recenter them.
 * Negative values shrink the bounds (see Leaflet's `LatLngBounds.pad`).
 */
const FOLLOW_INNER_PAD = -0.2;

/** @typedef {{ lat: number, lon: number }} LatLon */

/**
 * Get the global `L` Leaflet object loaded by the page. Throws a friendly
 * error if Leaflet hasn't loaded yet.
 */
function leaflet() {
  // eslint-disable-next-line no-undef
  const L = /** @type {any} */ (globalThis).L;
  if (!L || typeof L.map !== 'function') {
    throw new Error('Leaflet is not loaded yet.');
  }
  return L;
}

/**
 * @param {HTMLElement} container
 * @param {{ initialView?: { lat: number, lon: number, zoom: number } }} [opts]
 */
export function createLiveMap(container, opts = {}) {
  const L = leaflet();
  const startView = opts.initialView ?? { lat: 0, lon: 0, zoom: 2 };
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true
  }).setView([startView.lat, startView.lon], startView.zoom);

  L.tileLayer(TILE_URL, {
    // OSM has real tiles up through zoom 19. Above that, Leaflet
    // upscales the z19 tile so the user can pinch in further and still
    // see *something* (just blurrier). Useful on a trip recorder where
    // "where exactly am I" beats "perfectly crisp tile."
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: TILE_ATTR
  }).addTo(map);

  const polyline = L.polyline([], {
    color: '#7c3aed',
    weight: 5,
    opacity: 0.9,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);

  /** @type {any} */
  let currentMarker = null;
  /** @type {any} */
  let accuracyCircle = null;

  // Once the user drags the map by hand, stop forcing recenter. Resumes
  // when they tap "follow" (we expose `setFollow(true)`).
  let following = true;
  map.on('dragstart', () => {
    following = false;
  });

  /**
   * Pan only when the marker has drifted into the outer band of the
   * viewport. This avoids the jittery "recenter on every fix" feel
   * while still preventing the live polyline from wandering off-screen.
   * @param {any} latLng
   */
  function panToKeepInView(latLng) {
    const safe = map.getBounds().pad(FOLLOW_INNER_PAD);
    if (!safe.contains(latLng)) {
      map.panTo(latLng, { animate: true });
    }
  }

  function updateMarker(lat, lon, accuracyM) {
    if (!currentMarker) {
      currentMarker = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#7c3aed',
        fillOpacity: 1
      }).addTo(map);
    } else {
      currentMarker.setLatLng([lat, lon]);
    }
    if (typeof accuracyM === 'number' && Number.isFinite(accuracyM)) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle([lat, lon], {
          radius: accuracyM,
          color: '#7c3aed',
          weight: 1,
          opacity: 0.4,
          fillColor: '#7c3aed',
          fillOpacity: 0.08
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng([lat, lon]);
        accuracyCircle.setRadius(accuracyM);
      }
    }
  }

  return {
    /**
     * Show the user's location before recording starts so they have
     * context. Doesn't extend the polyline.
     * @param {LatLon & { accuracy?: number, zoom?: number }} p
     */
    showInitialPosition(p) {
      map.setView([p.lat, p.lon], p.zoom ?? 16);
      updateMarker(p.lat, p.lon, p.accuracy);
    },

    /**
     * Append a new GPS fix to the live track. When `following` is true
     * the camera pans only once the marker reaches the outer band of
     * the viewport — so the user keeps a stable view while they're
     * comfortably on-screen, and we re-center before they walk off it.
     * @param {LatLon & { accuracy?: number }} p
     */
    addLivePoint(p) {
      const latLng = L.latLng(p.lat, p.lon);
      polyline.addLatLng(latLng);
      updateMarker(p.lat, p.lon, p.accuracy);
      if (following) {
        panToKeepInView(latLng);
      }
    },

    /**
     * Recenter and zoom the map to a specific point. Used at the start
     * of a recording so the user sees their immediate surroundings
     * instead of whatever zoom level we happened to be at.
     * @param {LatLon} p
     * @param {number} zoom
     */
    setView(p, zoom) {
      map.setView([p.lat, p.lon], zoom);
    },

    /** @param {boolean} on */
    setFollow(on) {
      following = on;
      const m = currentMarker;
      if (on && m) {
        map.panTo(m.getLatLng());
      }
    },

    isFollowing() {
      return following;
    },

    invalidateSize() {
      map.invalidateSize();
    },

    destroy() {
      map.remove();
    }
  };
}

/**
 * @param {HTMLElement} container
 */
export function createReplayMap(container) {
  const L = leaflet();
  const map = L.map(container, { zoomControl: true }).setView([0, 0], 2);
  L.tileLayer(TILE_URL, {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: TILE_ATTR
  }).addTo(map);

  /** @type {any} */
  let polyline = null;
  /** @type {any} */
  let startMarker = null;
  /** @type {any} */
  let endMarker = null;

  return {
    /** @param {LatLon[]} points */
    drawTrack(points) {
      if (polyline) {
        polyline.remove();
        polyline = null;
      }
      if (startMarker) {
        startMarker.remove();
        startMarker = null;
      }
      if (endMarker) {
        endMarker.remove();
        endMarker = null;
      }
      if (points.length === 0) {
        return;
      }
      const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
      polyline = L.polyline(latLngs, {
        color: '#7c3aed',
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(map);

      const start = points[0];
      const end = points[points.length - 1];
      startMarker = L.circleMarker([start.lat, start.lon], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1
      })
        .bindTooltip('Start', { permanent: false })
        .addTo(map);
      endMarker = L.circleMarker([end.lat, end.lon], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1
      })
        .bindTooltip('End', { permanent: false })
        .addTo(map);

      if (points.length === 1) {
        map.setView(latLngs[0], 16);
      } else {
        map.fitBounds(polyline.getBounds(), { padding: [24, 24] });
      }
    },

    invalidateSize() {
      map.invalidateSize();
    },

    destroy() {
      map.remove();
    }
  };
}
