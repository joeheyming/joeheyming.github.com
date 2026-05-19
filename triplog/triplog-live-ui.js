/**
 * Live recorder UI controller.
 *
 * Owns the always-visible left rail of the recording screen: the
 * stats grid (distance / duration / pace / elevation / accuracy),
 * the paused badge, the splits panel, the units toggle button, the
 * activity dropdown, and the three Start/Pause/Resume/Finish
 * buttons (driven by `setRecorderMode`).
 *
 * Pure UI — does not own the GPS tracker. The recorder calls into
 * here with each fresh `TrackerStats` via `applyStatsToUi`, and the
 * orchestrator calls `toggleUnits` / `setActivity` from event
 * listeners.
 */

import {
  ACTIVITY_TUNING,
  UNITS,
  saveStoredActivity,
  saveStoredUnit
} from './triplog-constants.js';

/**
 * @param {{
 *   state: any,
 *   dom: {
 *     statDistance: HTMLElement,
 *     statDuration: HTMLElement,
 *     statElapsed: HTMLElement,
 *     statSpeed: HTMLElement,
 *     statSpeedLabel: HTMLElement,
 *     statAvgSpeed: HTMLElement,
 *     statAvgSpeedLabel: HTMLElement,
 *     statElevation: HTMLElement,
 *     statAccuracy: HTMLElement,
 *     pausedBadge: HTMLElement,
 *     gapBadge: HTMLElement,
 *     splitsCard: HTMLElement,
 *     splitsList: HTMLElement,
 *     splitsUnitLabel: HTMLElement,
 *     splitsSummary: HTMLElement,
 *     btnUnits: HTMLButtonElement,
 *     btnStart: HTMLButtonElement,
 *     btnPause: HTMLButtonElement,
 *     btnResume: HTMLButtonElement,
 *     btnFinish: HTMLButtonElement,
 *     activitySelect: HTMLSelectElement
 *   },
 *   format: typeof import('./triplog-format.js'),
 *   callbacks: {
 *     onUnitChange: () => void
 *   }
 * }} deps
 */
export function createLiveUi(deps) {
  const { state, dom, format, callbacks } = deps;
  const {
    formatAccuracy,
    formatDistance,
    formatDuration,
    formatElevation,
    formatPace,
    formatSpeed,
    formatSplitTime
  } = format;

  /** Bike shows speed; run/walk show pace. Driven by the activity tuning. */
  function activityPrefersPace() {
    return ACTIVITY_TUNING[state.activity].prefersPace;
  }

  /**
   * Drive button visibility from the three recorder states. Single
   * source of truth so we don't get stuck with both Pause and Resume
   * showing at the same time.
   *
   * @param {'idle' | 'recording' | 'paused'} mode
   */
  function setRecorderMode(mode) {
    dom.btnStart.hidden = mode !== 'idle';
    dom.btnPause.hidden = mode !== 'recording';
    dom.btnResume.hidden = mode !== 'paused';
    dom.btnFinish.hidden = mode !== 'paused';
  }

  function applyStatsToUi(stats) {
    state.lastStats = stats;
    dom.statDistance.textContent = formatDistance(stats.distanceMeters, state.unit);
    dom.statDuration.textContent = formatDuration(stats.durationSec);
    dom.statElapsed.textContent = formatDuration(stats.elapsedSec || stats.durationSec);
    if (activityPrefersPace()) {
      dom.statSpeedLabel.textContent = 'Pace';
      dom.statAvgSpeedLabel.textContent = 'Avg pace';
      dom.statSpeed.textContent = formatPace(stats.currentSpeedMs, state.unit);
      dom.statAvgSpeed.textContent = formatPace(stats.averageSpeedMs, state.unit);
    } else {
      dom.statSpeedLabel.textContent = 'Speed';
      dom.statAvgSpeedLabel.textContent = 'Avg speed';
      dom.statSpeed.textContent = formatSpeed(stats.currentSpeedMs, state.unit);
      dom.statAvgSpeed.textContent = formatSpeed(stats.averageSpeedMs, state.unit);
    }
    dom.statElevation.textContent = formatElevation(stats.elevationGainM, state.unit);
    dom.statAccuracy.textContent = formatAccuracy(stats.accuracyM, state.unit);
    if (stats.paused) {
      dom.pausedBadge.hidden = false;
      dom.pausedBadge.lastElementChild?.remove?.();
      dom.pausedBadge.textContent = '';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⏸';
      const label = document.createTextNode(
        ' ' + (stats.pauseReason === 'manual' ? 'Paused' : 'Auto-paused')
      );
      dom.pausedBadge.append(icon, label);
    } else {
      dom.pausedBadge.hidden = true;
    }
    // Keep button visibility in lock-step with manual pause. We only
    // toggle between recording/paused here; idle is owned by start/stop.
    if (state.tracker?.isRecording) {
      setRecorderMode(stats.pauseReason === 'manual' ? 'paused' : 'recording');
    }
  }

  /**
   * Show the "GPS gap" badge on the live stats card. Idempotent — once
   * a trip has had a single gap-resume the badge stays on for the
   * rest of that trip (gaps are a quality flag for the *whole* trip,
   * not a momentary state).
   */
  function markGapDetected() {
    dom.gapBadge.hidden = false;
  }

  /** Hide the gap badge — called when a recording ends or is discarded. */
  function clearGapBadge() {
    dom.gapBadge.hidden = true;
  }

  /** Empty placeholder stats; used between trips and after init. */
  function emptyStats() {
    return /** @type {import('./triplog-tracker.js').TrackerStats} */ ({
      distanceMeters: 0,
      durationSec: 0,
      elapsedSec: 0,
      pointCount: 0,
      currentSpeedMs: null,
      averageSpeedMs: 0,
      accuracyM: null,
      elevationGainM: 0,
      paused: false,
      pauseReason: null
    });
  }

  /**
   * Render the units toggle text to reflect the *opposite* of the
   * current unit (because the button label tells the user what
   * tapping it will switch to, not what they're currently seeing).
   */
  function refreshUnitsButton() {
    dom.btnUnits.textContent = state.unit === UNITS.IMPERIAL ? 'Switch to km' : 'Switch to mi';
    dom.btnUnits.setAttribute(
      'aria-label',
      state.unit === UNITS.IMPERIAL ? 'Switch to metric units' : 'Switch to imperial units'
    );
  }

  function toggleUnits() {
    state.unit = state.unit === UNITS.IMPERIAL ? UNITS.METRIC : UNITS.IMPERIAL;
    saveStoredUnit(state.unit);
    refreshUnitsButton();
    renderSplits();
    if (state.lastStats) {
      applyStatsToUi(state.lastStats);
    } else {
      // No active recording — just refresh the placeholders so the
      // unit labels in "— km/h" / "0.00 km" reflect the new choice.
      applyStatsToUi(emptyStats());
    }
    callbacks.onUnitChange();
  }

  /** @param {import('./triplog-constants.js').Activity} activity */
  function setActivity(activity) {
    if (state.activity === activity) {
      return;
    }
    state.activity = activity;
    saveStoredActivity(activity);
    refreshActivityPicker();
    // Activity changes what "Speed" vs "Pace" means, so re-render stats.
    if (state.lastStats) {
      applyStatsToUi(state.lastStats);
    } else {
      applyStatsToUi(emptyStats());
    }
  }

  /** Populate the activity dropdown from ACTIVITY_TUNING. Idempotent. */
  function populateActivitySelect() {
    dom.activitySelect.replaceChildren();
    for (const [value, tuning] of Object.entries(ACTIVITY_TUNING)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = `${tuning.emoji} ${tuning.label}`;
      dom.activitySelect.appendChild(opt);
    }
    dom.activitySelect.value = state.activity;
  }

  function refreshActivityPicker() {
    if (dom.activitySelect.value !== state.activity) {
      dom.activitySelect.value = state.activity;
    }
  }

  /** Lock the activity picker once recording starts; unlock when it ends. */
  function setActivityPickerLocked(locked) {
    dom.activitySelect.disabled = locked;
  }

  /**
   * Render the splits panel from the active split tracker (chosen by
   * `state.unit`). Hides the panel entirely when there are no completed
   * splits AND nothing in progress — i.e. before recording starts.
   */
  function renderSplits() {
    const tracker = state.unit === UNITS.IMPERIAL ? state.splits.mi : state.splits.km;
    dom.splitsUnitLabel.textContent = state.unit === UNITS.IMPERIAL ? '(mi)' : '(km)';
    if (!tracker) {
      dom.splitsCard.hidden = true;
      dom.splitsList.replaceChildren();
      dom.splitsSummary.textContent = '';
      return;
    }
    const snap = tracker.snapshot();
    if (snap.completed.length === 0 && !snap.inProgress) {
      dom.splitsCard.hidden = true;
      dom.splitsList.replaceChildren();
      dom.splitsSummary.textContent = '';
      return;
    }
    dom.splitsCard.hidden = false;

    dom.splitsList.replaceChildren();
    for (const s of snap.completed) {
      dom.splitsList.appendChild(renderSplitRow(s.index, s.timeSec, s.paceSecPerMeter, false));
    }
    if (snap.inProgress && snap.inProgress.distanceMeters > 0) {
      dom.splitsList.appendChild(
        renderSplitRow(
          snap.inProgress.index,
          snap.inProgress.timeSec,
          snap.inProgress.paceSecPerMeter,
          true
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
      dom.splitsSummary.textContent = `Fastest: split ${fastest.index} • ${fastestPaceLabel}`;
    } else {
      dom.splitsSummary.textContent = '';
    }
  }

  /**
   * Build a single row of the splits list. Marks the in-progress
   * (partial) split with reduced opacity and a "current" suffix so
   * runners don't think their pace just got 3× better.
   *
   * @param {number} index
   * @param {number} timeSec
   * @param {number} paceSecPerMeter
   * @param {boolean} inProgress
   */
  function renderSplitRow(index, timeSec, paceSecPerMeter, inProgress) {
    const li = document.createElement('li');
    li.className =
      'flex items-baseline justify-between gap-3 py-1.5 text-sm' +
      (inProgress ? ' text-zinc-500 dark:text-zinc-400' : '');
    const left = document.createElement('span');
    left.className = 'w-12 font-semibold';
    left.textContent = `${index}${inProgress ? '·' : ''}`;
    const time = document.createElement('span');
    time.className = 'flex-1 text-right';
    time.textContent = formatSplitTime(timeSec);
    const pace = document.createElement('span');
    pace.className = 'w-24 text-right text-zinc-600 dark:text-zinc-300';
    pace.textContent = formatPace(paceSecPerMeter > 0 ? 1 / paceSecPerMeter : null, state.unit);
    li.append(left, time, pace);
    return li;
  }

  return {
    activityPrefersPace,
    applyStatsToUi,
    clearGapBadge,
    emptyStats,
    markGapDetected,
    populateActivitySelect,
    refreshActivityPicker,
    refreshUnitsButton,
    renderSplits,
    setActivity,
    setActivityPickerLocked,
    setRecorderMode,
    toggleUnits
  };
}
