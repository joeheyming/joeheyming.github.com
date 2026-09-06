/**
 * Trip-view modal controller.
 *
 * Owns the replay modal end-to-end: opening / closing, the replay
 * map polyline + mile markers, the stats card, the elevation +
 * pace charts with hover-synced map markers, the best-efforts
 * list, the splits panel, and the end-crop bar (slider, summary,
 * save, exit). Also handles deleting the currently-open trip.
 *
 * One factory, one mutable `state` reference (so the orchestrator
 * and the recorder can both see `currentReplayTripId` / `replayMap`
 * mutations from here), one DOM-ref bag.
 */

import {
  ACTIVITY_TUNING,
  METERS_PER_FOOT,
  METERS_PER_KM,
  METERS_PER_MILE,
  TRIP_STATUS,
  UNITS
} from './triplog-constants.js';
import { downsample, renderLineChart } from './triplog-chart.js';
import { createReplayMap } from './triplog-map.js';
import { createSplitTracker } from './triplog-splits.js';
import { haversineMeters, isGapSegment } from './triplog-tracker.js';
import {
  computeMileMarkers,
  computeSegmentSpeeds,
  cumulativeDistances,
  recomputeStatsFromPoints,
  smoothSpeeds
} from './triplog-trip-stats.js';

/**
 * @param {{
 *   state: any,
 *   dom: {
 *     tripViewDialog: HTMLDialogElement,
 *     tripViewMap: HTMLElement,
 *     tripViewTitle: HTMLElement,
 *     tripViewSummary: HTMLElement,
 *     tvActivityBadge: HTMLElement,
 *     tvGapBadge: HTMLElement,
 *     tvWhen: HTMLElement,
 *     tvDistance: HTMLElement,
 *     tvDuration: HTMLElement,
 *     tvElapsed: HTMLElement,
 *     tvPace: HTMLElement,
 *     tvPaceLabel: HTMLElement,
 *     tvElevation: HTMLElement,
 *     tvPoints: HTMLElement,
 *     tvElevCard: HTMLElement,
 *     tvElevChart: HTMLElement,
 *     tvElevHover: HTMLElement,
 *     tvPaceCard: HTMLElement,
 *     tvPaceChart: HTMLElement,
 *     tvPaceTitle: HTMLElement,
 *     tvPaceHover: HTMLElement,
 *     tvPaceScaleMin: HTMLElement,
 *     tvPaceScaleMax: HTMLElement,
 *     tvBestsCard: HTMLElement,
 *     tvBestsList: HTMLElement,
 *     tvSplitsCard: HTMLElement,
 *     tvSplitsList: HTMLElement,
 *     tvSplitsUnitLabel: HTMLElement,
 *     tvSplitsSummary: HTMLElement,
 *     btnTripViewCrop: HTMLButtonElement,
 *     btnTripViewDelete: HTMLButtonElement,
 *     btnTripViewPost: HTMLButtonElement,
 *     tripViewPostMap: HTMLInputElement,
 *     tripViewPostMapOption: HTMLElement,
 *     cropBar: HTMLElement,
 *     cropSlider: HTMLInputElement,
 *     cropKeepSummary: HTMLElement,
 *     cropTrimSummary: HTMLElement,
 *     btnCropSave: HTMLButtonElement,
 *     btnCropCancel: HTMLButtonElement,
 *     statusEl: HTMLElement
 *   },
 *   format: typeof import('./triplog-format.js'),
 *   callbacks: {
 *     refreshTripsList: () => Promise<void> | void
 *   }
 * }} deps
 */
export function createTripView(deps) {
  const { state, dom, format, callbacks } = deps;
  const {
    setStatus,
    formatDistance,
    formatDuration,
    formatElevation,
    formatPace,
    formatSpeed,
    formatSplitTime,
    formatTripStartedAt,
    formatTripShareMarkdown
  } = format;

  /** @param {import('./triplog-db.js').TripRecord} trip */
  async function open(trip) {
    if (!state.db) {
      return;
    }
    state.currentReplayTripId = trip.id;
    dom.tripViewTitle.textContent = trip.name || 'Untitled trip';
    dom.tripViewSummary.textContent = `${formatTripStartedAt(trip.startedAt)} • ${formatDistance(
      trip.distanceMeters,
      state.unit
    )} • ${formatDuration(trip.durationSec)}`;
    dom.tripViewDialog.showModal();

    // Posts sharing is only for completed/saved trips — hide the CTA while
    // a recording is still in progress.
    const canPost = trip.status === TRIP_STATUS.COMPLETE;
    dom.btnTripViewPost.hidden = !canPost;
    dom.btnTripViewPost.disabled = !canPost;
    dom.tripViewPostMapOption.hidden = !canPost;
    dom.tripViewPostMap.checked = false;
    dom.tripViewPostMap.disabled = true;

    if (state.replayMap) {
      state.replayMap.destroy();
      state.replayMap = null;
    }
    dom.tripViewMap.innerHTML = '';
    state.replayMap = createReplayMap(dom.tripViewMap);
    requestAnimationFrame(() => state.replayMap?.invalidateSize());

    // Reset the secondary cards while we load — avoids briefly showing
    // the previous trip's chart/splits if the user opens a new one.
    dom.tvElevCard.hidden = true;
    dom.tvElevChart.replaceChildren();
    dom.tvElevHover.textContent = '';
    dom.tvPaceCard.hidden = true;
    dom.tvPaceChart.replaceChildren();
    dom.tvPaceHover.textContent = '';
    dom.tvBestsCard.hidden = true;
    dom.tvBestsList.replaceChildren();
    dom.tvSplitsCard.hidden = true;
    dom.tvSplitsList.replaceChildren();
    dom.tvSplitsSummary.textContent = '';
    renderTripStatsCard(trip, []);

    try {
      const points = await state.db.listPoints(trip.id);
      state.replayPoints = points;
      renderTripViewDetails(trip, points);
      dom.tripViewPostMap.disabled = points.length === 0;
      dom.tripViewPostMapOption.title = points.length
        ? 'Include the visible route map as an image attachment'
        : 'This trip has no route points to map';
      // Crop is only meaningful on completed trips with at least 2 points
      // (anything less can be deleted, not cropped).
      dom.btnTripViewCrop.disabled = points.length < 2 || trip.status === TRIP_STATUS.RECORDING;
    } catch (err) {
      console.error('[triplog] openTripView', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  /**
   * Render all the trip-view detail panels (colored polyline, mile
   * markers, stats grid, elevation + pace charts, best efforts,
   * splits). Called whenever the trip viewer needs a full refresh
   * — initial open, unit toggle, after a crop save, after exiting
   * crop mode.
   *
   * @param {import('./triplog-db.js').TripRecord} trip
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripViewDetails(trip, points) {
    const activityKey =
      trip.activity && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, trip.activity)
        ? /** @type {import('./triplog-constants.js').Activity} */ (trip.activity)
        : 'other';
    const tuning = ACTIVITY_TUNING[activityKey];
    const segmentSpeeds = computeSegmentSpeeds(points);
    state.replayMap?.setColoredTrack(points, segmentSpeeds);
    state.replayMap?.setMileMarkers(computeMileMarkers(points, state.unit));
    renderTripStatsCard(trip, points);
    renderElevationChart(points);
    renderPaceChart(points, tuning);
    renderBestEfforts(points, tuning);
    renderTripSplits(points);
  }

  /**
   * Populate the trip-view stats card from a `TripRecord` plus the
   * full point list. We rely on the stored stats for moving time and
   * elevation (those needed live computation we can't perfectly
   * replay), and use `points` to fill in elapsed time and the GPS
   * sample count.
   *
   * @param {import('./triplog-db.js').TripRecord} trip
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripStatsCard(trip, points) {
    const activityKey =
      trip.activity && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, trip.activity)
        ? /** @type {import('./triplog-constants.js').Activity} */ (trip.activity)
        : 'other';
    const tuning = ACTIVITY_TUNING[activityKey];
    dom.tvActivityBadge.textContent = `${tuning.emoji} ${tuning.label}`;
    dom.tvWhen.textContent = formatTripStartedAt(trip.startedAt);

    // Show the GPS-gap badge if the recording has any silent stretch.
    // Tagged-on-recording (`gap: true`) is the modern signal; the
    // timestamp-delta fallback inside `isGapSegment` keeps older trips
    // honest.
    let hasGap = false;
    for (let i = 1; i < points.length; i += 1) {
      if (isGapSegment(points[i - 1], points[i])) {
        hasGap = true;
        break;
      }
    }
    dom.tvGapBadge.hidden = !hasGap;

    dom.tvDistance.textContent = formatDistance(trip.distanceMeters, state.unit);
    dom.tvDuration.textContent = formatDuration(trip.durationSec);

    // Prefer the stored elapsedSec; if it's missing (old trips) or
    // zero, derive it from the points' first/last timestamps.
    let elapsedSec = trip.elapsedSec ?? 0;
    if ((!elapsedSec || elapsedSec < trip.durationSec) && points.length >= 2) {
      elapsedSec = Math.max(0, (points[points.length - 1].t - points[0].t) / 1000);
    }
    dom.tvElapsed.textContent = formatDuration(elapsedSec);

    // Average pace/speed is derived from distance / moving time, the
    // same way the live screen shows it during recording.
    const avgMs = trip.durationSec > 0 ? trip.distanceMeters / trip.durationSec : 0;
    if (tuning.prefersPace) {
      dom.tvPaceLabel.textContent = 'Avg pace';
      dom.tvPace.textContent = formatPace(avgMs, state.unit);
    } else {
      dom.tvPaceLabel.textContent = 'Avg speed';
      dom.tvPace.textContent = formatSpeed(avgMs, state.unit);
    }

    dom.tvElevation.textContent = formatElevation(trip.elevationGainM ?? 0, state.unit);
    dom.tvPoints.textContent = String(trip.pointCount ?? points.length);
  }

  /**
   * Build the elevation-over-distance area chart. Skips if too few
   * points or if no altitude data was recorded (which is the case on
   * a lot of phones — the GPS chip reports altitude when it has it
   * and `null` when it doesn't).
   *
   * Hover/drag the chart to drop a synced marker on the trip map.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderElevationChart(points) {
    dom.tvElevChart.replaceChildren();
    dom.tvElevHover.textContent = '';
    if (points.length < 2) {
      dom.tvElevCard.hidden = true;
      return;
    }
    // Walk the points once to build {distanceCumulative, altitude}
    // tuples, skipping samples without altitude. Lat/lon ride along so
    // the hover callback can drop a synced marker on the map.
    /** @type {{ x: number, y: number, lat: number, lon: number }[]} */
    const series = [];
    let cumDist = 0;
    /** @type {import('./triplog-db.js').PointRecord | null} */
    let prev = null;
    for (const p of points) {
      if (prev) {
        cumDist += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      }
      if (typeof p.altitude === 'number' && Number.isFinite(p.altitude)) {
        series.push({ x: cumDist, y: p.altitude, lat: p.lat, lon: p.lon });
      }
      prev = p;
    }
    if (series.length < 2) {
      // No usable altitude data — hide the card rather than show an
      // empty chart.
      dom.tvElevCard.hidden = true;
      return;
    }
    dom.tvElevCard.hidden = false;
    const sampled = downsample(series, 180);
    const useImperial = state.unit === UNITS.IMPERIAL;
    const xDivisor = useImperial ? METERS_PER_MILE : METERS_PER_KM;
    const xLabel = useImperial ? 'mi' : 'km';
    const xConverted = sampled.map((p) => ({
      x: p.x / xDivisor,
      y: useImperial ? p.y / METERS_PER_FOOT : p.y,
      lat: p.lat,
      lon: p.lon
    }));
    /** @param {number} v */
    const fmtY = (v) => `${Math.round(v)}${useImperial ? ' ft' : ' m'}`;
    /** @param {number} v */
    const fmtX = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${xLabel}`;
    const svg = renderLineChart({
      points: xConverted,
      color: '#7c3aed',
      fillColor: 'rgba(124, 58, 237, 0.18)',
      width: 360,
      height: 130,
      title: 'Elevation profile',
      formatY: fmtY,
      formatX: fmtX,
      onHover: (_idx, p) => {
        if (!p) {
          state.replayMap?.setHoverMarker(null);
          dom.tvElevHover.textContent = '';
          return;
        }
        state.replayMap?.setHoverMarker({ lat: p.lat, lon: p.lon });
        dom.tvElevHover.textContent = `${fmtX(p.x)} • ${fmtY(p.y)}`;
      }
    });
    dom.tvElevChart.appendChild(svg);
  }

  /**
   * Build the pace (or speed) chart. Smoothed using a ~10-second
   * sliding window so GPS jitter doesn't create a saw-tooth. For
   * paced activities (run/walk/etc.) we plot pace (sec / unit) so
   * the chart reads like a Strava pace chart: peaks = slow points.
   * For wheel activities we plot speed (units / hour) instead.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {import('./triplog-constants.js').ActivityTuning} tuning
   */
  function renderPaceChart(points, tuning) {
    dom.tvPaceChart.replaceChildren();
    dom.tvPaceHover.textContent = '';
    if (points.length < 2) {
      dom.tvPaceCard.hidden = true;
      return;
    }
    const useImperial = state.unit === UNITS.IMPERIAL;
    const metersPerUnit = useImperial ? METERS_PER_MILE : METERS_PER_KM;
    const unitLabel = useImperial ? 'mi' : 'km';

    const speedsMs = smoothSpeeds(points, 10);
    const cumDistArr = cumulativeDistances(points);
    /** @type {{ x: number, y: number, lat: number, lon: number }[]} */
    const series = [];
    for (let i = 0; i < points.length; i += 1) {
      const sp = speedsMs[i];
      // Skip basically-stationary samples — they'd otherwise yank the
      // line to the floor (or to infinite pace) and ruin the Y range.
      if (!Number.isFinite(sp) || sp < 0.3) continue;
      const x = cumDistArr[i] / metersPerUnit;
      const y = tuning.prefersPace
        ? metersPerUnit / sp // seconds per unit (pace)
        : (sp * 3600) / metersPerUnit; // units per hour (speed)
      series.push({ x, y, lat: points[i].lat, lon: points[i].lon });
    }
    if (series.length < 2) {
      dom.tvPaceCard.hidden = true;
      return;
    }
    dom.tvPaceCard.hidden = false;
    dom.tvPaceTitle.textContent = tuning.prefersPace ? 'Pace profile' : 'Speed profile';
    const sampled = downsample(series, 180);

    /** @param {number} secPerUnit */
    const formatPaceSec = (secPerUnit) => {
      const total = Math.max(0, Math.round(secPerUnit));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, '0')} /${unitLabel}`;
    };
    /** @param {number} v */
    const fmtY = tuning.prefersPace
      ? formatPaceSec
      : (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${useImperial ? 'mph' : 'km/h'}`;
    /** @param {number} v */
    const fmtX = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${unitLabel}`;

    // The min/max labels under the gradient strip mirror the trip's
    // observed range, in the same unit the chart uses.
    const ys = sampled.map((p) => p.y);
    if (tuning.prefersPace) {
      // High Y = slow pace, low Y = fast pace.
      dom.tvPaceScaleMin.textContent = `slow (${fmtY(Math.max(...ys))})`;
      dom.tvPaceScaleMax.textContent = `fast (${fmtY(Math.min(...ys))})`;
    } else {
      dom.tvPaceScaleMin.textContent = `slow (${fmtY(Math.min(...ys))})`;
      dom.tvPaceScaleMax.textContent = `fast (${fmtY(Math.max(...ys))})`;
    }

    const svg = renderLineChart({
      points: sampled,
      color: '#0d9488', // teal — distinct from the violet elevation chart
      fillColor: 'rgba(13, 148, 136, 0.18)',
      width: 360,
      height: 130,
      title: tuning.prefersPace ? 'Pace profile' : 'Speed profile',
      formatY: fmtY,
      formatX: fmtX,
      onHover: (_idx, p) => {
        if (!p) {
          state.replayMap?.setHoverMarker(null);
          dom.tvPaceHover.textContent = '';
          return;
        }
        state.replayMap?.setHoverMarker({ lat: p.lat, lon: p.lon });
        dom.tvPaceHover.textContent = `${fmtX(p.x)} • ${fmtY(p.y)}`;
      }
    });
    dom.tvPaceChart.appendChild(svg);
  }

  /**
   * Sliding-window best efforts (fastest 1k / 1mi / 5k / 10k / half /
   * full) for paced activities. Skipped for wheel activities — "best
   * 5 km on a bike" isn't really a thing people care about.
   *
   * For each target distance, we find the smallest time window in
   * which the cumulative distance grows by ≥ target. Binary search
   * keeps it O(N log N) which is fine for the few-thousand points a
   * GPS trip produces.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {import('./triplog-constants.js').ActivityTuning} tuning
   */
  function renderBestEfforts(points, tuning) {
    dom.tvBestsList.replaceChildren();
    if (!tuning.prefersPace || points.length < 2) {
      dom.tvBestsCard.hidden = true;
      return;
    }
    /** @type {{ meters: number, label: string }[]} */
    const targets = [
      { meters: 400, label: '400 m' },
      { meters: METERS_PER_KM, label: '1 km' },
      { meters: METERS_PER_MILE, label: '1 mi' },
      { meters: 5 * METERS_PER_KM, label: '5 km' },
      { meters: 10 * METERS_PER_KM, label: '10 km' },
      { meters: 21097.5, label: 'Half marathon' },
      { meters: 42195, label: 'Marathon' }
    ];
    const cumDistArr = cumulativeDistances(points);
    const totalDist = cumDistArr[cumDistArr.length - 1];
    /** @type {{ label: string, meters: number, timeSec: number }[]} */
    const results = [];
    for (const target of targets) {
      if (totalDist < target.meters) continue;
      let bestTime = Infinity;
      for (let i = 0; i < cumDistArr.length; i += 1) {
        const need = cumDistArr[i] + target.meters;
        // Binary search for the smallest j where cumDist[j] >= need.
        let lo = i + 1;
        let hi = cumDistArr.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cumDistArr[mid] >= need) hi = mid;
          else lo = mid + 1;
        }
        if (cumDistArr[lo] < need) break;
        const time = (points[lo].t - points[i].t) / 1000;
        if (time > 0 && time < bestTime) {
          bestTime = time;
        }
      }
      if (Number.isFinite(bestTime)) {
        results.push({ label: target.label, meters: target.meters, timeSec: bestTime });
      }
    }
    if (results.length === 0) {
      dom.tvBestsCard.hidden = true;
      return;
    }
    dom.tvBestsCard.hidden = false;
    for (const r of results) {
      const li = document.createElement('li');
      li.className = 'flex items-baseline justify-between gap-3 py-1.5 text-sm';
      const label = document.createElement('span');
      label.className = 'flex-1 font-medium';
      label.textContent = r.label;
      const time = document.createElement('span');
      time.className = 'w-20 text-right tabular-nums';
      time.textContent = formatDuration(r.timeSec);
      const paceMs = r.meters / r.timeSec;
      const pace = document.createElement('span');
      pace.className = 'w-24 text-right text-text-2';
      pace.textContent = formatPace(paceMs, state.unit);
      li.append(label, time, pace);
      dom.tvBestsList.appendChild(li);
    }
  }

  /**
   * Recompute splits from the persisted points so past trips show the
   * same splits the user saw live. Uses the active unit (km vs mi)
   * and pipes cumulative distance + (best-effort) elapsed time into
   * the existing `createSplitTracker`. We don't have the live
   * auto-pause window here, so "time per split" is wall-clock from
   * the first to the last point in that split — close enough for a
   * post-trip recap.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripSplits(points) {
    dom.tvSplitsList.replaceChildren();
    dom.tvSplitsSummary.textContent = '';
    if (points.length < 2) {
      dom.tvSplitsCard.hidden = true;
      return;
    }
    const unitMeters = state.unit === UNITS.IMPERIAL ? METERS_PER_MILE : METERS_PER_KM;
    dom.tvSplitsUnitLabel.textContent = state.unit === UNITS.IMPERIAL ? '(mi)' : '(km)';
    const splits = createSplitTracker(unitMeters);
    let cumDist = 0;
    const t0 = points[0].t;
    /** @type {import('./triplog-db.js').PointRecord | null} */
    let prev = null;
    for (const p of points) {
      if (prev) {
        cumDist += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      }
      splits.update(cumDist, Math.max(0, (p.t - t0) / 1000));
      prev = p;
    }
    const snap = splits.snapshot();
    if (snap.completed.length === 0 && !snap.inProgress) {
      dom.tvSplitsCard.hidden = true;
      return;
    }
    dom.tvSplitsCard.hidden = false;
    // Pre-compute the min/max pace across completed splits so the bar
    // widths give a relative sense of which splits were slower. The
    // bar is filled in proportion to (pace - minPace) / range, so the
    // slowest split gets a full bar and the fastest a near-empty one.
    const paces = snap.completed.map((s) => s.paceSecPerMeter).filter((p) => p > 0);
    const minPace = paces.length ? Math.min(...paces) : 0;
    const maxPace = paces.length ? Math.max(...paces) : 0;
    const range = maxPace - minPace;
    /** @param {number} pace */
    const widthFor = (pace) => {
      if (!Number.isFinite(pace) || pace <= 0 || range === 0) return 0.5;
      return 0.15 + 0.85 * ((pace - minPace) / range);
    };
    for (const s of snap.completed) {
      dom.tvSplitsList.appendChild(
        renderTripSplitRow(
          s.index,
          s.timeSec,
          s.paceSecPerMeter,
          false,
          widthFor(s.paceSecPerMeter)
        )
      );
    }
    if (snap.inProgress && snap.inProgress.distanceMeters > 0) {
      dom.tvSplitsList.appendChild(
        renderTripSplitRow(
          snap.inProgress.index,
          snap.inProgress.timeSec,
          snap.inProgress.paceSecPerMeter,
          true,
          widthFor(snap.inProgress.paceSecPerMeter)
        )
      );
    }
    if (snap.completed.length > 0) {
      const fastest = snap.completed.reduce((best, s) =>
        s.paceSecPerMeter > 0 &&
        (best.paceSecPerMeter === 0 || s.paceSecPerMeter < best.paceSecPerMeter)
          ? s
          : best
      );
      const fastestPaceLabel = formatPace(
        fastest.paceSecPerMeter > 0 ? 1 / fastest.paceSecPerMeter : null,
        state.unit
      );
      dom.tvSplitsSummary.textContent = `Fastest: split ${fastest.index} • ${fastestPaceLabel}`;
    }
  }

  /**
   * @param {number} index
   * @param {number} timeSec
   * @param {number} paceSecPerMeter
   * @param {boolean} inProgress
   * @param {number} [barWidth] 0..1 — used for the inline "longer bar = slower" indicator
   */
  function renderTripSplitRow(index, timeSec, paceSecPerMeter, inProgress, barWidth = 0.5) {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-3 py-1.5 text-sm' + (inProgress ? ' text-text-3' : '');
    const left = document.createElement('span');
    left.className = 'w-8 font-semibold';
    left.textContent = `${index}${inProgress ? '·' : ''}`;
    // Bar takes the middle column; the inner fill is colored with the
    // brand accent and sized by `barWidth`. Visually mirrors Strava-style
    // split bars where slower splits stretch farther across the row.
    const barWrap = document.createElement('span');
    barWrap.className = 'relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2';
    const barFill = document.createElement('span');
    barFill.className = 'absolute inset-y-0 left-0 rounded-full bg-accent-primary/80';
    barFill.style.width = `${Math.round(Math.max(0, Math.min(1, barWidth)) * 100)}%`;
    barWrap.appendChild(barFill);
    const time = document.createElement('span');
    time.className = 'w-12 text-right tabular-nums';
    time.textContent = formatSplitTime(timeSec);
    const pace = document.createElement('span');
    pace.className = 'w-24 text-right tabular-nums text-text-2';
    pace.textContent = formatPace(paceSecPerMeter > 0 ? 1 / paceSecPerMeter : null, state.unit);
    li.append(left, barWrap, time, pace);
    return li;
  }

  function close() {
    if (dom.tripViewDialog.open) {
      dom.tripViewDialog.close();
    }
    if (state.replayMap) {
      state.replayMap.destroy();
      state.replayMap = null;
    }
    state.currentReplayTripId = null;
    state.replayPoints = [];
    exitCrop();
  }

  /** Push crop summary text + slider value into the bar. */
  function renderCropSummary() {
    const total = state.replayPoints.length;
    const keep = Math.max(1, Math.min(total, Number(dom.cropSlider.value) || total));
    const kept = state.replayPoints.slice(0, keep);
    const trimmedCount = total - keep;
    const keptStats = recomputeStatsFromPoints(kept);
    const lastKeptT = kept[kept.length - 1]?.t ?? 0;
    const firstT = kept[0]?.t ?? 0;
    const keptDurSec = Math.max(0, (lastKeptT - firstT) / 1000);
    dom.cropKeepSummary.textContent = `${formatDistance(
      keptStats.distanceMeters,
      state.unit
    )} • ${formatDuration(keptDurSec)}`;
    if (trimmedCount === 0) {
      dom.cropTrimSummary.textContent = '0 points';
    } else {
      const trimmed = state.replayPoints.slice(keep);
      const trimmedStats = recomputeStatsFromPoints([kept[kept.length - 1], ...trimmed]);
      const tailDurSec =
        trimmed.length > 0 ? Math.max(0, (trimmed[trimmed.length - 1].t - lastKeptT) / 1000) : 0;
      dom.cropTrimSummary.textContent = `${trimmedCount} points • ${formatDistance(
        trimmedStats.distanceMeters,
        state.unit
      )} • ${formatDuration(tailDurSec)}`;
    }
    state.replayMap?.previewCrop?.(keep);
  }

  function enterCrop() {
    if (state.replayPoints.length < 2 || !state.replayMap) {
      return;
    }
    state.cropMode = true;
    dom.cropBar.hidden = false;
    dom.cropSlider.max = String(state.replayPoints.length);
    dom.cropSlider.value = String(state.replayPoints.length);
    // Hide the destructive Delete button while cropping so the bar is
    // the focused interaction.
    dom.btnTripViewDelete.disabled = true;
    dom.btnTripViewCrop.disabled = true;
    dom.btnTripViewPost.disabled = true;
    renderCropSummary();
  }

  function exitCrop() {
    state.cropMode = false;
    dom.cropBar.hidden = true;
    dom.btnTripViewDelete.disabled = false;
    // Only re-enable Crop if there's a trip loaded with enough points.
    dom.btnTripViewCrop.disabled = state.replayPoints.length < 2;
    // Re-enable Make a Post when this is a completed trip (not recording).
    if (!dom.btnTripViewPost.hidden) {
      dom.btnTripViewPost.disabled = false;
    }
    state.replayMap?.clearCropPreview?.();
    // Redraw the full track in its colored form so the dashed overlay
    // disappears and the end marker snaps back to the true end.
    if (state.replayPoints.length > 0 && state.db && state.currentReplayTripId) {
      const id = state.currentReplayTripId;
      state.db
        .getTrip(id)
        .then((trip) => {
          if (trip && state.currentReplayTripId === id) {
            renderTripViewDetails(trip, state.replayPoints);
          } else {
            state.replayMap?.drawTrack(state.replayPoints);
          }
        })
        .catch((err) => {
          console.error('[triplog] exitCropMode refresh', err);
          state.replayMap?.drawTrack(state.replayPoints);
        });
    }
  }

  async function saveCrop() {
    if (!state.db || !state.currentReplayTripId || !state.cropMode) {
      return;
    }
    const total = state.replayPoints.length;
    const keep = Math.max(1, Math.min(total, Number(dom.cropSlider.value) || total));
    if (keep >= total) {
      // Nothing to trim.
      exitCrop();
      return;
    }
    const kept = state.replayPoints.slice(0, keep);
    const keepThroughMs = kept[kept.length - 1].t;
    const tripId = state.currentReplayTripId;

    dom.btnCropSave.disabled = true;
    dom.btnCropCancel.disabled = true;
    try {
      const removed = await state.db.removePointsAfter(tripId, keepThroughMs);
      const recomputed = recomputeStatsFromPoints(kept);
      const firstT = kept[0].t;
      const newEndedAt = new Date(keepThroughMs);
      // Wall-clock duration to the new end point. We lose the moving-
      // time refinement because we don't replay the auto-pause logic
      // here; that's a deliberate trade-off — cropping is usually about
      // removing a forgotten-to-stop tail, where wall-clock is the
      // honest number anyway.
      const newDurationSec = Math.max(0, (keepThroughMs - firstT) / 1000);
      await state.db.updateTripStats(tripId, {
        distanceMeters: recomputed.distanceMeters,
        durationSec: newDurationSec,
        elapsedSec: newDurationSec,
        pointCount: kept.length,
        elevationGainM: recomputed.elevationGainM,
        endedAt: newEndedAt
      });
      state.replayPoints = kept;
      // exitCrop below will redraw the colored track and refresh
      // all the detail cards from the freshly-persisted trip record.
      exitCrop();
      const updated = await state.db.getTrip(tripId);
      if (updated) {
        dom.tripViewSummary.textContent = `${formatTripStartedAt(
          updated.startedAt
        )} • ${formatDistance(updated.distanceMeters, state.unit)} • ${formatDuration(
          updated.durationSec
        )}`;
        renderTripViewDetails(updated, kept);
      }
      void callbacks.refreshTripsList();
      setStatus(dom.statusEl, `Trimmed ${removed} point${removed === 1 ? '' : 's'} from the end.`);
    } catch (err) {
      console.error('[triplog] saveCrop', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      dom.btnCropSave.disabled = false;
      dom.btnCropCancel.disabled = false;
    }
  }

  async function deleteCurrent() {
    if (!state.db || !state.currentReplayTripId) {
      return;
    }
    const id = state.currentReplayTripId;
    if (id === state.currentTripId) {
      setStatus(dom.statusEl, 'Stop the active recording before deleting this trip.', true);
      return;
    }
    if (!globalThis.confirm('Delete this trip and all of its GPS points? This cannot be undone.')) {
      return;
    }
    try {
      await state.db.deleteTrip(id);
      close();
      void callbacks.refreshTripsList();
      setStatus(dom.statusEl, 'Trip deleted.');
    } catch (err) {
      console.error('[triplog] deleteCurrentReplayTrip', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  /**
   * Capture the visible replay map. The route image is only produced
   * after the user explicitly opts in because it reveals location.
   * @returns {Promise<Blob>}
   */
  async function captureMapImage() {
    const capture = /** @type {Window & {
     *   html2canvas?: (
     *     element: HTMLElement,
     *     options?: {
     *       useCORS?: boolean,
     *       allowTaint?: boolean,
     *       backgroundColor?: string,
     *       logging?: boolean,
     *       scale?: number
     *     }
     *   ) => Promise<HTMLCanvasElement>
     * }} */ (window).html2canvas;
    if (typeof capture !== 'function') {
      throw new Error('Map image capture is unavailable.');
    }
    const canvas = await capture(dom.tripViewMap, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#e5e7eb',
      logging: false,
      scale: Math.min(2, window.devicePixelRatio || 1)
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture the map image.'));
      }, 'image/png');
    });
  }

  /**
   * Share a privacy-safe aggregate summary of the open trip to Posts,
   * optionally with the visible route map when the user opts in.
   */
  async function sharePost() {
    if (!state.db || !state.currentReplayTripId || dom.btnTripViewPost.hidden) {
      return;
    }
    const trip = await state.db.getTrip(state.currentReplayTripId);
    if (!trip || trip.status !== TRIP_STATUS.COMPLETE) {
      setStatus(dom.statusEl, 'Only saved trips can be shared as a post.', true);
      return;
    }
    dom.btnTripViewPost.disabled = true;
    try {
      const attachments = [];
      if (dom.tripViewPostMap.checked) {
        if (state.replayPoints.length === 0) {
          throw new Error('This trip has no route points to map.');
        }
        setStatus(dom.statusEl, 'Capturing map…');
        attachments.push(await captureMapImage());
      }
      const { share } = await import('/posts/share-client.js');
      await share({
        text: formatTripShareMarkdown(trip, state.unit),
        attachments
      });
    } catch (err) {
      console.error('[triplog] sharePost', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
      dom.btnTripViewPost.disabled = false;
    }
  }

  /**
   * Re-render the open replay if any (used by the unit toggle). No-op
   * if the dialog isn't open or no trip is loaded.
   */
  function refreshIfOpen() {
    if (!dom.tripViewDialog.open || !state.currentReplayTripId || !state.db) {
      return;
    }
    const currentId = state.currentReplayTripId;
    state.db
      .getTrip(currentId)
      .then((trip) => {
        if (!trip || state.currentReplayTripId !== currentId) {
          return;
        }
        renderTripViewDetails(trip, state.replayPoints);
      })
      .catch((err) => console.error('[triplog] refresh trip view after units', err));
  }

  return {
    open,
    close,
    enterCrop,
    exitCrop,
    saveCrop,
    deleteCurrent,
    sharePost,
    renderCropSummary,
    refreshIfOpen
  };
}
