/**
 * Trip recorder controller.
 *
 * Owns the GPS recording lifecycle: Start → (Pause ↔ Resume) → Finish →
 * Save/Discard. Wires the `triplog-tracker.js` GPS source to:
 *   - the IDB write loop (`flushPointBuffer`, periodic row updates)
 *   - the live map (`addLivePoint`, first-fix zoom)
 *   - the splits trackers (km + mi, both fed so the unit toggle is free)
 *   - the live UI (`applyStatsToUi`, `setRecorderMode`, etc.)
 *   - the permission card on a GPS error
 *
 * Also owns the Finish dialog content (snapshot stats, editable name)
 * and the cleanup that resets the UI between trips.
 */

import {
  ACTIVITY_TUNING,
  METERS_PER_KM,
  METERS_PER_MILE,
  TRIP_STATUS,
  defaultTripName,
  randomUuid
} from './triplog-constants.js';
import { createKeepalive } from './triplog-keepalive.js';
import { createSplitTracker } from './triplog-splits.js';
import { createTracker } from './triplog-tracker.js';

/**
 * @param {{
 *   state: any,
 *   dom: {
 *     btnStart: HTMLButtonElement,
 *     btnFollow: HTMLButtonElement,
 *     finishDialog: HTMLDialogElement,
 *     finishNameInput: HTMLInputElement,
 *     finishDistance: HTMLElement,
 *     finishDuration: HTMLElement,
 *     finishPace: HTMLElement,
 *     finishPaceLabel: HTMLElement,
 *     finishElevation: HTMLElement,
 *     finishActivityBadge: HTMLElement,
 *     btnFinishSave: HTMLButtonElement,
 *     btnFinishDiscard: HTMLButtonElement,
 *     btnFinishBack: HTMLButtonElement,
 *     statusEl: HTMLElement,
 *     pausedBadge: HTMLElement
 *   },
 *   format: typeof import('./triplog-format.js'),
 *   embed: { notify(message: string, opts?: { kind?: string }): void },
 *   liveUi: ReturnType<typeof import('./triplog-live-ui.js').createLiveUi>,
 *   permissionCard: ReturnType<typeof import('./triplog-permission-card.js').createPermissionCard>,
 *   intervals: { flushMs: number, tripRowUpdateMs: number },
 *   callbacks: {
 *     refreshTripsList: () => Promise<void> | void,
 *     ensureLiveMap: () => ReturnType<typeof import('./triplog-map.js').createLiveMap>
 *   }
 * }} deps
 */
export function createRecorder(deps) {
  const { state, dom, format, embed, liveUi, permissionCard, intervals, callbacks } = deps;
  const { setStatus, formatDistance, formatDuration, formatElevation, formatPace, formatSpeed } =
    format;

  // One keep-alive instance for the lifetime of the recorder. It's
  // idempotent — start()/stop() are no-ops when already in that state
  // — so we don't need to recreate it per trip.
  const keepalive = createKeepalive();

  async function flushPointBuffer() {
    if (!state.db || state.buffer.length === 0) {
      return;
    }
    const batch = state.buffer;
    state.buffer = [];
    try {
      await state.db.addPoints(batch);
    } catch (err) {
      console.error('[triplog] flush failed; re-queueing', err);
      // Put the points back so the next flush retries them. Most IDB
      // failures here are transient (quota, version change in another
      // tab); blocking the UI on it would be worse.
      state.buffer = batch.concat(state.buffer);
      setStatus(dom.statusEl, 'Saving GPS points failed; will retry…', true);
    }
  }

  async function periodicTripRowUpdate() {
    if (!state.db || !state.currentTripId || !state.tracker) {
      return;
    }
    try {
      const stats = state.tracker.stats;
      await state.db.updateTripStats(state.currentTripId, {
        distanceMeters: stats.distanceMeters,
        durationSec: stats.durationSec,
        elapsedSec: stats.elapsedSec,
        pointCount: stats.pointCount,
        elevationGainM: stats.elevationGainM
      });
    } catch (err) {
      console.warn('[triplog] periodicTripRowUpdate', err);
    }
  }

  /**
   * Push the latest stats into the keep-alive title ticker + MediaSession
   * metadata. Cheap, called from every `onPoint` / `onStats` tick.
   *
   * @param {import('./triplog-tracker.js').TrackerStats} stats
   */
  function pushKeepaliveStatus(stats) {
    if (!keepalive.isActive) {
      return;
    }
    const title = `${formatDistance(stats.distanceMeters, state.unit)} · ${formatDuration(
      stats.durationSec
    )}`;
    keepalive.update({ paused: stats.paused, title });
  }

  async function start() {
    if (!state.db) {
      setStatus(dom.statusEl, 'Database is not ready yet.', true);
      return;
    }
    if (state.tracker?.isRecording) {
      return;
    }
    dom.btnStart.disabled = true;
    setStatus(dom.statusEl, 'Asking for GPS…');

    try {
      const tripId = randomUuid();
      const startedAt = new Date();
      const activity = state.activity;
      // Strava-style: the trip gets a friendly auto-name now and the
      // user can rename it in the Finish dialog if they care to.
      const name = defaultTripName(startedAt, activity);

      await state.db.createTrip({ id: tripId, name, startedAt, activity });
      state.currentTripId = tripId;
      state.buffer = [];
      state.splits.km = createSplitTracker(METERS_PER_KM);
      state.splits.mi = createSplitTracker(METERS_PER_MILE);
      liveUi.renderSplits();

      // First-fix latch: zoom the live map in tight the moment we get
      // a real position. We can't do it before `tracker.start` because
      // the user may still be looking at the OS permission prompt.
      let zoomedToTrip = false;

      const tuning = ACTIVITY_TUNING[activity];
      const tracker = createTracker({
        tuning: {
          autoPauseSpeedMs: tuning.autoPauseSpeedMs,
          autoPauseSeconds: tuning.autoPauseSeconds
        },
        onPoint: (p, stats) => {
          state.buffer.push(p);
          if (!zoomedToTrip) {
            // Zoom 17 shows a couple of blocks of context around the
            // dot — enough to see where you're heading while still
            // close enough to trace the path. We used to slam in at
            // zoom 22, which is well past OSM's native zoom 19 and
            // shows upscaled tiles with almost no surrounding context.
            state.liveMap?.setView({ lat: p.lat, lon: p.lon }, 17);
            zoomedToTrip = true;
          }
          state.liveMap?.addLivePoint({
            lat: p.lat,
            lon: p.lon,
            accuracy: p.accuracy,
            gap: p.gap === true
          });
          if (p.gap === true) {
            // First gap-resume of the trip flips on the live "GPS gap"
            // badge so the user knows the dashed segment they just
            // saw drawn was the tab waking back up.
            liveUi.markGapDetected();
          }
          // Feed both split trackers so toggling units mid-trip is free.
          state.splits.km?.update(stats.distanceMeters, stats.durationSec);
          state.splits.mi?.update(stats.distanceMeters, stats.durationSec);
          liveUi.applyStatsToUi(stats);
          liveUi.renderSplits();
          pushKeepaliveStatus(stats);
        },
        onStats: (stats) => {
          // Time-only tick (no new fix): still push to splits so the
          // in-progress row's time keeps counting while standing still.
          state.splits.km?.update(stats.distanceMeters, stats.durationSec);
          state.splits.mi?.update(stats.distanceMeters, stats.durationSec);
          liveUi.applyStatsToUi(stats);
          liveUi.renderSplits();
          pushKeepaliveStatus(stats);
        },
        onError: (err) => {
          const code = 'code' in err ? err.code : 0;
          if (code === 1) {
            permissionCard.show('site-blocked');
            setStatus(dom.statusEl, '');
          } else if (code === 2) {
            permissionCard.show('system-off');
            setStatus(dom.statusEl, '');
          } else if (code === 3) {
            permissionCard.show('timeout');
            setStatus(dom.statusEl, '');
          } else {
            setStatus(dom.statusEl, err.message || 'GPS error', true);
          }
        }
      });
      state.tracker = tracker;

      await tracker.start({ tripId });

      // Spin up the background keep-alive (silent audio + MediaSession
      // metadata + title ticker). This is our best non-native shot at
      // keeping `watchPosition` callbacks flowing once the screen
      // locks; see triplog-keepalive.js for the rationale. We have a
      // user gesture here (the Start button), which is what AudioContext
      // needs in order to actually emit samples.
      keepalive.start({
        onPause: () => pause(),
        onResume: () => resume()
      });
      pushKeepaliveStatus(tracker.stats);

      liveUi.setRecorderMode('recording');
      dom.btnFollow.classList.remove('hidden');
      dom.btnFollow.classList.add('flex');
      dom.btnFollow.setAttribute('aria-pressed', 'true');
      dom.btnFollow.dataset.on = 'true';
      liveUi.setActivityPickerLocked(true);

      callbacks.ensureLiveMap();

      state.flushHandle = window.setInterval(() => void flushPointBuffer(), intervals.flushMs);
      state.tripRowUpdateHandle = window.setInterval(
        () => void periodicTripRowUpdate(),
        intervals.tripRowUpdateMs
      );

      setStatus(dom.statusEl, 'Recording.');
      embed.notify('Trip Log: started recording.', { kind: 'info' });
      void callbacks.refreshTripsList();
    } catch (err) {
      console.error('[triplog] startRecording', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
      state.tracker = null;
      state.buffer = [];
      state.currentTripId = null;
      // The keep-alive may or may not have started before the failure;
      // stop() is idempotent, so unconditionally call it.
      keepalive.stop();
    } finally {
      dom.btnStart.disabled = false;
    }
  }

  function pause() {
    if (!state.tracker?.isRecording || state.tracker.isManuallyPaused) {
      return;
    }
    state.tracker.pauseManual();
    liveUi.setRecorderMode('paused');
    setStatus(dom.statusEl, 'Paused.');
    pushKeepaliveStatus(state.tracker.stats);
  }

  function resume() {
    if (!state.tracker?.isRecording || !state.tracker.isManuallyPaused) {
      return;
    }
    state.tracker.resumeManual();
    liveUi.setRecorderMode('recording');
    setStatus(dom.statusEl, 'Recording.');
    pushKeepaliveStatus(state.tracker.stats);
  }

  /**
   * Open the Strava-style "Finish trip" dialog. The recording is *not*
   * stopped yet — that happens when the user taps Save or Discard from
   * inside the dialog. "Back" returns to the paused state so they can
   * keep going.
   */
  async function openFinish() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    // Make sure we're paused before we open the dialog so the timers
    // freeze and the snapshot we show doesn't tick under the user.
    if (!state.tracker.isManuallyPaused) {
      state.tracker.pauseManual();
      liveUi.setRecorderMode('paused');
      pushKeepaliveStatus(state.tracker.stats);
    }
    const snap = state.tracker.stats;
    const tuning = ACTIVITY_TUNING[state.activity];
    const usePace = tuning.prefersPace;

    dom.finishDistance.textContent = formatDistance(snap.distanceMeters, state.unit);
    dom.finishDuration.textContent = formatDuration(snap.durationSec);
    dom.finishPaceLabel.textContent = usePace ? 'Avg pace' : 'Avg speed';
    dom.finishPace.textContent = usePace
      ? formatPace(snap.averageSpeedMs, state.unit)
      : formatSpeed(snap.averageSpeedMs, state.unit);
    dom.finishElevation.textContent = formatElevation(snap.elevationGainM, state.unit);
    dom.finishActivityBadge.textContent = `${tuning.emoji} ${tuning.label}`;

    // Pre-fill the editable name with whatever's currently on the trip
    // (the auto-name picked at Start), so the user only has to type if
    // they actually want a different name.
    const current = state.db ? await state.db.getTrip(state.currentTripId) : null;
    dom.finishNameInput.value = current?.name || defaultTripName(new Date(), state.activity);

    if (typeof dom.finishDialog.showModal === 'function') {
      dom.finishDialog.showModal();
    } else {
      dom.finishDialog.setAttribute('open', '');
    }
    // Focus the name field on a slight delay so the dialog has actually
    // mounted before we try to grab focus (avoids a Safari quirk).
    requestAnimationFrame(() => dom.finishNameInput.select());
  }

  /**
   * Shared cleanup after a trip has been finished (either saved or
   * discarded). Resets the recorder UI and in-memory state so the user
   * can immediately start another trip.
   */
  function resetAfterFinish() {
    state.tracker = null;
    state.buffer = [];
    state.currentTripId = null;
    state.splits.km = null;
    state.splits.mi = null;
    liveUi.setRecorderMode('idle');
    dom.btnFollow.classList.add('hidden');
    dom.btnFollow.classList.remove('flex');
    liveUi.setActivityPickerLocked(false);
    dom.pausedBadge.hidden = true;
    liveUi.clearGapBadge();
    liveUi.renderSplits();
    keepalive.stop();
  }

  /**
   * Persist the in-progress trip, applying any name change from the
   * Finish dialog. Closes the dialog and refreshes the trips list.
   */
  async function save() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    dom.btnFinishSave.disabled = true;
    dom.btnFinishDiscard.disabled = true;
    dom.btnFinishBack.disabled = true;
    try {
      const tripId = state.currentTripId;
      const final = state.tracker.stop();
      if (state.flushHandle !== null) {
        window.clearInterval(state.flushHandle);
        state.flushHandle = null;
      }
      if (state.tripRowUpdateHandle !== null) {
        window.clearInterval(state.tripRowUpdateHandle);
        state.tripRowUpdateHandle = null;
      }
      await flushPointBuffer();

      if (state.db) {
        // First update the rolling stats fields...
        const updated = await state.db.updateTripStats(tripId, {
          distanceMeters: final.distanceMeters,
          durationSec: final.durationSec,
          elapsedSec: final.elapsedSec,
          pointCount: final.pointCount,
          elevationGainM: final.elevationGainM,
          endedAt: final.endedAt,
          status: TRIP_STATUS.COMPLETE
        });
        // ...then apply the (possibly edited) name in a second write.
        // We keep the rename out of `updateTripStats` to avoid blowing
        // out its narrow contract; this is the only place rename
        // happens.
        const desiredName = dom.finishNameInput.value.trim();
        if (desiredName && desiredName !== updated.name) {
          await state.db.renameTrip(tripId, desiredName);
        }
      }

      dom.finishDialog.close();
      setStatus(
        dom.statusEl,
        `Saved — ${formatDistance(final.distanceMeters, state.unit)} in ${formatDuration(
          final.durationSec
        )}`
      );
      embed.notify(
        `Trip saved: ${formatDistance(final.distanceMeters, state.unit)} in ${formatDuration(
          final.durationSec
        )}`,
        { kind: 'success' }
      );
    } catch (err) {
      console.error('[triplog] saveTrip', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      dom.btnFinishSave.disabled = false;
      dom.btnFinishDiscard.disabled = false;
      dom.btnFinishBack.disabled = false;
      resetAfterFinish();
      void callbacks.refreshTripsList();
    }
  }

  /**
   * Throw away the in-progress trip — deletes the IDB record and every
   * point — after a confirmation prompt. Used by the Discard button in
   * the Finish dialog when the user starts and immediately realises
   * they didn't mean to.
   */
  async function discard() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    if (!globalThis.confirm('Discard this trip? It will be deleted and cannot be recovered.')) {
      return;
    }
    dom.btnFinishSave.disabled = true;
    dom.btnFinishDiscard.disabled = true;
    dom.btnFinishBack.disabled = true;
    try {
      const tripId = state.currentTripId;
      try {
        state.tracker.stop();
      } catch {
        /* already stopped */
      }
      if (state.flushHandle !== null) {
        window.clearInterval(state.flushHandle);
        state.flushHandle = null;
      }
      if (state.tripRowUpdateHandle !== null) {
        window.clearInterval(state.tripRowUpdateHandle);
        state.tripRowUpdateHandle = null;
      }
      // Drop the in-memory buffer so it can't get flushed against the
      // about-to-be-deleted trip's id.
      state.buffer = [];
      if (state.db) {
        await state.db.deleteTrip(tripId);
      }
      dom.finishDialog.close();
      setStatus(dom.statusEl, 'Trip discarded.');
    } catch (err) {
      console.error('[triplog] discardTrip', err);
      setStatus(dom.statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      dom.btnFinishSave.disabled = false;
      dom.btnFinishDiscard.disabled = false;
      dom.btnFinishBack.disabled = false;
      resetAfterFinish();
      void callbacks.refreshTripsList();
    }
  }

  return {
    start,
    pause,
    resume,
    openFinish,
    save,
    discard,
    flushPointBuffer
  };
}
