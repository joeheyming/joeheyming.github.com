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
/** @typedef {{ lat: number, lon: number, label: string }} MileMarker */

/**
 * Interpolate red → orange → green for a normalized 0..1 value.
 * 0 = slow (red), 1 = fast (green). HSL hue space is good enough for
 * the speed gradient and doesn't need a palette table.
 *
 * @param {number} t
 * @returns {string}
 */
function speedColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const hue = clamped * 120; // 0=red, 60=yellow, 120=green
  return `hsl(${hue.toFixed(0)}, 75%, 45%)`;
}

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

  /**
   * One or more Leaflet polylines. With a plain track this is a
   * single solid line; with `setColoredTrack` it's an array of
   * short segments tinted by speed.
   * @type {any[]}
   */
  let polylines = [];
  /** Dashed grey overlay used during crop preview to show the trimmed tail. */
  /** @type {any} */
  let trimmedPolyline = null;
  /** @type {any} */
  let startMarker = null;
  /** @type {any} */
  let endMarker = null;
  /** @type {any[]} */
  let mileMarkers = [];
  /** Single transient marker driven by `setHoverMarker`. */
  /** @type {any} */
  let hoverMarker = null;
  /** Last-drawn full track, kept so `previewCrop` can slice it without re-fetching. */
  /** @type {LatLon[]} */
  let lastTrack = [];

  function clearPolylines() {
    for (const p of polylines) {
      p.remove();
    }
    polylines = [];
  }

  function clearMileMarkers() {
    for (const m of mileMarkers) {
      m.remove();
    }
    mileMarkers = [];
  }

  function clearLayers() {
    clearPolylines();
    if (trimmedPolyline) {
      trimmedPolyline.remove();
      trimmedPolyline = null;
    }
    if (startMarker) {
      startMarker.remove();
      startMarker = null;
    }
    if (endMarker) {
      endMarker.remove();
      endMarker = null;
    }
    clearMileMarkers();
    if (hoverMarker) {
      hoverMarker.remove();
      hoverMarker = null;
    }
  }

  /**
   * Common end-cap markers and zoom-to-fit. Pulled out so both
   * `drawTrack` and `setColoredTrack` can share the same setup.
   *
   * @param {LatLon[]} points
   */
  function addEndCapsAndFit(points) {
    if (points.length === 0) return;
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
      map.setView([start.lat, start.lon], 16);
    } else if (polylines.length > 0) {
      // Fit to the bounds of the first polyline — for colored tracks
      // we accumulate the full bounds across segments below.
      let bounds = polylines[0].getBounds();
      for (let i = 1; i < polylines.length; i += 1) {
        bounds = bounds.extend(polylines[i].getBounds());
      }
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }

  return {
    /** @param {LatLon[]} points */
    drawTrack(points) {
      clearLayers();
      lastTrack = points.slice();
      if (points.length === 0) {
        return;
      }
      const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
      polylines = [
        L.polyline(latLngs, {
          color: '#7c3aed',
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(map)
      ];
      addEndCapsAndFit(points);
    },

    /**
     * Render the track as a sequence of short segments tinted by
     * `segmentSpeedsMs[i]` (the speed between `points[i]` and
     * `points[i+1]` in m/s). Slow segments turn red, fast turn green.
     * If `segmentSpeedsMs` is missing or all the speeds are zero,
     * falls back to a plain violet track.
     *
     * @param {LatLon[]} points
     * @param {number[]} segmentSpeedsMs
     */
    setColoredTrack(points, segmentSpeedsMs) {
      clearLayers();
      lastTrack = points.slice();
      if (points.length === 0) {
        return;
      }
      const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
      let speedMin = Infinity;
      let speedMax = -Infinity;
      for (const s of segmentSpeedsMs) {
        if (!Number.isFinite(s) || s <= 0) continue;
        if (s < speedMin) speedMin = s;
        if (s > speedMax) speedMax = s;
      }
      const haveRange =
        Number.isFinite(speedMin) && Number.isFinite(speedMax) && speedMax > speedMin;
      if (!haveRange) {
        polylines = [
          L.polyline(latLngs, {
            color: '#7c3aed',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round'
          }).addTo(map)
        ];
      } else {
        const span = speedMax - speedMin;
        polylines = [];
        for (let i = 0; i < latLngs.length - 1; i += 1) {
          const s = segmentSpeedsMs[i];
          const t = Number.isFinite(s) && s > 0 ? (s - speedMin) / span : 0;
          const seg = L.polyline([latLngs[i], latLngs[i + 1]], {
            color: speedColor(t),
            weight: 5,
            opacity: 0.95,
            lineJoin: 'round',
            lineCap: 'round'
          }).addTo(map);
          polylines.push(seg);
        }
      }
      addEndCapsAndFit(points);
    },

    /**
     * Drop small numbered circles at each km / mi boundary along the
     * track. Pass an empty array (or omit `markers`) to clear them.
     *
     * @param {MileMarker[]} [markers]
     */
    setMileMarkers(markers) {
      clearMileMarkers();
      if (!markers || markers.length === 0) {
        return;
      }
      for (const m of markers) {
        const icon = L.divIcon({
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          html: `<div style="
              display:flex;align-items:center;justify-content:center;
              width:22px;height:22px;border-radius:9999px;
              background:rgba(255,255,255,0.95);color:#3f3f46;
              border:2px solid #7c3aed;font:600 11px/1 system-ui,sans-serif;
              box-shadow:0 1px 2px rgba(0,0,0,0.15);
            ">${m.label}</div>`
        });
        mileMarkers.push(L.marker([m.lat, m.lon], { icon, interactive: false }).addTo(map));
      }
    },

    /**
     * Show or hide a transient marker, used to mirror the chart hover
     * position on the map. Pass `null` to clear.
     *
     * @param {LatLon | null} latLon
     */
    setHoverMarker(latLon) {
      if (!latLon) {
        if (hoverMarker) {
          hoverMarker.remove();
          hoverMarker = null;
        }
        return;
      }
      if (!hoverMarker) {
        hoverMarker = L.circleMarker([latLon.lat, latLon.lon], {
          radius: 8,
          color: '#fff',
          weight: 3,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          interactive: false
        }).addTo(map);
      } else {
        hoverMarker.setLatLng([latLon.lat, latLon.lon]);
      }
    },

    /**
     * While the user is sliding the crop cursor, show the kept portion
     * in solid violet and the trimmed tail dashed-grey so they can see
     * what they'd be removing without committing to it. `keepCount`
     * is the number of points to retain (1..total). Re-uses the
     * `lastTrack` from `drawTrack`.
     *
     * The colored-track view (multiple per-segment polylines) is
     * collapsed back to a single solid line while cropping — keeps
     * the visual logic simple and gives the user a clear sense of
     * what's "kept" vs "trimmed".
     *
     * @param {number} keepCount
     */
    previewCrop(keepCount) {
      if (lastTrack.length === 0) {
        return;
      }
      const total = lastTrack.length;
      const k = Math.max(1, Math.min(total, Math.round(keepCount)));
      const keptPts = lastTrack.slice(0, k);
      const trimmedPts = lastTrack.slice(Math.max(0, k - 1)); // include cut point for continuity

      const keptLatLngs = keptPts.map((p) => L.latLng(p.lat, p.lon));
      const trimmedLatLngs = trimmedPts.map((p) => L.latLng(p.lat, p.lon));

      // Collapse any per-segment colored polylines into a single
      // solid kept-portion line.
      clearPolylines();
      polylines = [
        L.polyline(keptLatLngs, {
          color: '#7c3aed',
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(map)
      ];
      if (trimmedLatLngs.length > 1) {
        if (trimmedPolyline) {
          trimmedPolyline.setLatLngs(trimmedLatLngs);
        } else {
          trimmedPolyline = L.polyline(trimmedLatLngs, {
            color: '#71717a', // zinc-500
            weight: 4,
            opacity: 0.7,
            dashArray: '6 8',
            lineJoin: 'round',
            lineCap: 'round'
          }).addTo(map);
        }
      } else if (trimmedPolyline) {
        trimmedPolyline.remove();
        trimmedPolyline = null;
      }
      const newEnd = keptPts[keptPts.length - 1];
      if (endMarker) {
        endMarker.setLatLng([newEnd.lat, newEnd.lon]);
      }
    },

    /** Drop the dashed preview overlay (call after commit/cancel). */
    clearCropPreview() {
      if (trimmedPolyline) {
        trimmedPolyline.remove();
        trimmedPolyline = null;
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
