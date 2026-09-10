// Beat/time model, ported from StepMania 5.1:
//   - SMLoader::ProcessBPMsAndStops (src/NotesLoaderSM.cpp)
//   - TimingData::GetBeatInternal / GetElapsedTimeInternal (src/TimingData.cpp)
//
// Two things a naive "walk the BPM list" conversion gets wrong:
//
//   1. #STOPS and #DELAYS pause the chart without pausing the music, so any
//      chart with a freeze drifts by the total freeze duration from the first
//      one onward.
//   2. Negative BPMs and negative stops are not time running backwards. SM
//      converts them at load time into *warps*: zero-duration regions that
//      skip the beats inside them. Feeding a negative BPM into a forward-only
//      walk produces garbage beat numbers for the rest of the song.
//
// Everything here is pure: no gameState, no DOM. Beats are chart-relative
// (beat 0 is at time 0); #OFFSET is applied by the caller.

/** Rows of subdivision per beat. SM quantizes all timing to these. */
export const ROWS_PER_BEAT = 48;

/** At or above this, a BPM is an SM4-style instant warp rather than a speed. */
const FAST_BPM_WARP = 9999999;

/** SM's fallback when a simfile declares no usable BPM at all. */
const FALLBACK_BPM = 60;

const NOT_FOUND = 0;
const FOUND_WARP_DESTINATION = 1;
const FOUND_BPM_CHANGE = 2;
const FOUND_DELAY = 3;
const FOUND_MARKER = 4;
const FOUND_STOP = 5;
const FOUND_WARP = 6;

/** Segments walked between lookup snapshots. Matches SM's PrepareLookup. */
const SEGMENTS_PER_LOOKUP = 16;

/**
 * @typedef {Object} TimingPair
 * @property {number} beat
 * @property {number} value - BPM, or pause length in seconds
 */

/**
 * @typedef {Object} TimingData
 * @property {Array<{row: number, bpm: number}>} bpms
 * @property {Array<{row: number, seconds: number}>} stops
 * @property {Array<{row: number, seconds: number}>} delays
 * @property {Array<{row: number, lengthBeats: number}>} warps
 * @property {number} beat0OffsetDelta - Seconds to add to #OFFSET for pre-beat-0 stops
 */

/** @param {number} beat */
export function beatToNoteRow(beat) {
  return Math.round(beat * ROWS_PER_BEAT);
}

/** @param {number} row */
export function noteRowToBeat(row) {
  return row / ROWS_PER_BEAT;
}

/** @param {TimingPair[]} pairs */
function sortedByBeat(pairs) {
  return pairs
    .filter((p) => Number.isFinite(p.beat) && Number.isFinite(p.value))
    .sort((a, b) => a.beat - b.beat);
}

/** Sort by row, and when two entries share a row keep the last one added. */
function collapseByRow(segments) {
  const byRow = new Map();
  segments.forEach((seg) => byRow.set(seg.row, seg));
  return [...byRow.values()].sort((a, b) => a.row - b.row);
}

/**
 * Turn raw #BPMS and #STOPS into SM's segment lists, converting negative
 * values into warps. Port of SMLoader::ProcessBPMsAndStops.
 *
 * Zero-valued entries must already be dropped (SM does this while parsing).
 *
 * @param {TimingPair[]} bpmPairs
 * @param {TimingPair[]} stopPairs
 */
export function processBpmsAndStops(bpmPairs, stopPairs) {
  const bpms = sortedByBeat(bpmPairs);
  const stops = sortedByBeat(stopPairs);

  const outBpms = [];
  const outStops = [];
  const outWarps = [];
  let beat0OffsetDelta = 0;

  /** Current BPM, positive or negative */
  let bpm = 0;
  /** Beat of the previous timing change */
  let prevBeat = 0;
  /** Start of the current warp, or -1 when not warping */
  let warpStart = -1;
  /** BPM before the current warp began, to detect a change across it */
  let preWarpBpm = 0;
  /** How far behind we are because of negative values */
  let timeOfs = 0;

  let bi = 0;
  let si = 0;

  // Stops before beat 0 only move the arrows against the music, i.e. they
  // are really an offset adjustment.
  for (; si < stops.length && stops[si].beat < 0; si++) {
    beat0OffsetDelta -= stops[si].value;
  }

  // BPMs at or before beat 0 just establish the starting speed.
  for (; bi < bpms.length && bpms[bi].beat <= 0; bi++) {
    bpm = bpms[bi].value;
  }

  if (bpm === 0) {
    // Nothing established a BPM before beat 0, so borrow the next one. SM
    // increments past this entry before reading it, which walks off the end
    // on a chart with a single BPM change; read it in place instead.
    bpm = bi < bpms.length ? bpms[bi].value : FALLBACK_BPM;
  }

  // Always start with a BPM. If the chart opens inside a warp, the warp adds
  // one later instead.
  if (bpm > 0 && bpm <= FAST_BPM_WARP) {
    outBpms.push({ row: 0, bpm });
  }

  while (bi < bpms.length || si < stops.length) {
    // BPMs take precedence when both land on the same beat.
    const changeIsBpm = si >= stops.length || (bi < bpms.length && bpms[bi].beat <= stops[si].beat);
    const change = changeIsBpm ? bpms[bi] : stops[si];

    // Account for time spent at the current BPM. An "infinite" BPM passes
    // zero time, so it contributes nothing here.
    if (bpm <= FAST_BPM_WARP) {
      timeOfs += ((change.beat - prevBeat) * 60) / bpm;

      // A warp ends at the beat where the negative time has been paid back.
      if (warpStart >= 0 && bpm > 0 && timeOfs > 0) {
        const warpEnd = change.beat - (timeOfs * bpm) / 60;
        outWarps.push({ row: beatToNoteRow(warpStart), lengthBeats: warpEnd - warpStart });
        if (bpm !== preWarpBpm) {
          outBpms.push({ row: beatToNoteRow(warpStart), bpm });
        }
        warpStart = -1;
      }
    }

    prevBeat = change.beat;

    if (changeIsBpm) {
      if (warpStart < 0 && (change.value < 0 || change.value > FAST_BPM_WARP)) {
        warpStart = change.beat;
        preWarpBpm = bpm;
        timeOfs = 0;
      } else if (warpStart < 0) {
        outBpms.push({ row: beatToNoteRow(change.beat), bpm: change.value });
      }
      bpm = change.value;
      bi++;
    } else {
      if (warpStart < 0 && change.value < 0) {
        warpStart = change.beat;
        preWarpBpm = bpm;
        timeOfs = change.value;
      } else if (warpStart < 0) {
        outStops.push({ row: beatToNoteRow(change.beat), seconds: change.value });
      } else {
        // Already warping, so stops move the time deficit directly.
        timeOfs += change.value;

        // A stop that more than covers the deficit ends the warp and pauses
        // for whatever it went over by.
        if (change.value > 0 && timeOfs > 0) {
          outWarps.push({ row: beatToNoteRow(warpStart), lengthBeats: change.beat - warpStart });
          outStops.push({ row: beatToNoteRow(change.beat), seconds: timeOfs });

          if (bpm < 0 || bpm > FAST_BPM_WARP) {
            // The BPM is still warping us.
            warpStart = change.beat;
            timeOfs = 0;
          } else {
            if (bpm !== preWarpBpm) {
              outBpms.push({ row: beatToNoteRow(warpStart), bpm });
            }
            warpStart = -1;
          }
        }
      }
      si++;
    }
  }

  if (warpStart >= 0) {
    // A warp with nothing left to end it swallows the rest of the chart.
    const warpEnd = bpm < 0 || bpm > FAST_BPM_WARP ? 99999999 : prevBeat - (timeOfs * bpm) / 60;
    outWarps.push({ row: beatToNoteRow(warpStart), lengthBeats: warpEnd - warpStart });
    if (bpm !== preWarpBpm) {
      outBpms.push({ row: beatToNoteRow(warpStart), bpm });
    }
  }

  return {
    bpms: collapseByRow(outBpms),
    stops: collapseByRow(outStops),
    warps: collapseByRow(outWarps),
    beat0OffsetDelta
  };
}

/**
 * Build the timing model for a chart.
 *
 * @param {Object} tags
 * @param {TimingPair[]} [tags.bpms] - #BPMS
 * @param {TimingPair[]} [tags.stops] - #STOPS
 * @param {TimingPair[]} [tags.delays] - #DELAYS
 * @param {TimingPair[]} [tags.warps] - #WARPS (SM5 native, length in beats)
 * @returns {TimingData}
 */
export function buildTimingData({ bpms = [], stops = [], delays = [], warps = [] } = {}) {
  const processed = processBpmsAndStops(bpms, stops);

  // SM5 charts can declare warps directly instead of via negative BPMs.
  const nativeWarps = sortedByBeat(warps)
    .filter((w) => w.value > 0)
    .map((w) => ({ row: beatToNoteRow(w.beat), lengthBeats: w.value }));

  const timing = {
    bpms: processed.bpms,
    stops: processed.stops,
    delays: collapseByRow(
      sortedByBeat(delays)
        .filter((d) => d.value > 0)
        .map((d) => ({ row: beatToNoteRow(d.beat), seconds: d.value }))
    ),
    warps: collapseByRow([...processed.warps, ...nativeWarps]),
    beat0OffsetDelta: processed.beat0OffsetDelta
  };

  if (timing.bpms.length === 0) {
    timing.bpms.push({ row: 0, bpm: FALLBACK_BPM });
  }

  timing.lookup = prepareLookup(timing);
  return timing;
}

/** Timing for a chart with a single constant BPM and no gimmicks. */
export function constantTimingData(bpm) {
  return buildTimingData({ bpms: [{ beat: 0, value: bpm > 0 ? bpm : FALLBACK_BPM }] });
}

/** Last index whose row is at or before `row`, or -1. */
function segmentIndexAtRow(segments, row) {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].row <= row) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** @param {TimingData} timing */
function bpmAtRow(timing, row) {
  const i = segmentIndexAtRow(timing.bpms, row);
  if (i < 0) return timing.bpms[0]?.bpm ?? FALLBACK_BPM;
  return timing.bpms[i].bpm;
}

/** BPM in effect at a beat. */
export function getBpmAtBeat(timing, beat) {
  return bpmAtRow(timing, beatToNoteRow(beat));
}

function pauseAtRow(segments, row) {
  const i = segmentIndexAtRow(segments, row);
  if (i < 0 || segments[i].row !== row) return 0;
  return segments[i].seconds;
}

function newStarts() {
  return {
    bpm: 0,
    warp: 0,
    stop: 0,
    delay: 0,
    lastRow: 0,
    lastTime: 0,
    warpDestination: 0,
    isWarping: false
  };
}

function cloneStarts(starts) {
  return { ...starts };
}

/**
 * Find the next timing event at or after the walk position. Port of
 * FindEvent; the check order decides precedence when events share a row.
 */
function findEvent(timing, start, markerRow, findMarker) {
  let row = Infinity;
  let type = NOT_FOUND;

  if (start.isWarping && beatToNoteRow(start.warpDestination) < row) {
    row = beatToNoteRow(start.warpDestination);
    type = FOUND_WARP_DESTINATION;
  }
  if (start.bpm < timing.bpms.length && timing.bpms[start.bpm].row < row) {
    row = timing.bpms[start.bpm].row;
    type = FOUND_BPM_CHANGE;
  }
  // Delays resolve before the marker: a note on a delay row is hit after
  // the pause. Stops resolve after it, so a note on a stop row is hit as
  // the pause begins.
  if (start.delay < timing.delays.length && timing.delays[start.delay].row < row) {
    row = timing.delays[start.delay].row;
    type = FOUND_DELAY;
  }
  if (findMarker && markerRow < row) {
    row = markerRow;
    type = FOUND_MARKER;
  }
  if (start.stop < timing.stops.length && timing.stops[start.stop].row < row) {
    row = timing.stops[start.stop].row;
    type = FOUND_STOP;
  }
  if (start.warp < timing.warps.length && timing.warps[start.warp].row < row) {
    row = timing.warps[start.warp].row;
    type = FOUND_WARP;
  }

  return { row, type };
}

/**
 * Walk forward to `args.elapsedTime`, filling in beat/bps and whether that
 * moment sits inside a freeze. Port of TimingData::GetBeatInternal.
 */
function getBeatInternal(timing, start, args, maxSegment) {
  let currSegment = start.bpm + start.warp + start.stop + start.delay;
  let bps = bpmAtRow(timing, start.lastRow) / 60;

  while (currSegment < maxSegment) {
    const event = findEvent(timing, start, 0, false);
    if (event.type === NOT_FOUND) break;

    const timeToNextEvent = start.isWarping ? 0 : noteRowToBeat(event.row - start.lastRow) / bps;
    let nextEventTime = start.lastTime + timeToNextEvent;
    if (args.elapsedTime < nextEventTime) break;
    start.lastTime = nextEventTime;

    if (event.type === FOUND_WARP_DESTINATION) {
      start.isWarping = false;
    } else if (event.type === FOUND_BPM_CHANGE) {
      bps = timing.bpms[start.bpm].bpm / 60;
      start.bpm++;
      currSegment++;
    } else if (event.type === FOUND_DELAY || event.type === FOUND_STOP) {
      const isDelay = event.type === FOUND_DELAY;
      const segment = isDelay ? timing.delays[start.delay] : timing.stops[start.stop];
      nextEventTime = start.lastTime + segment.seconds;
      if (args.elapsedTime < nextEventTime) {
        args.freeze = !isDelay;
        args.delay = isDelay;
        args.beat = noteRowToBeat(segment.row);
        args.bps = bps;
        return;
      }
      start.lastTime = nextEventTime;
      if (isDelay) start.delay++;
      else start.stop++;
      currSegment++;
    } else if (event.type === FOUND_WARP) {
      start.isWarping = true;
      const warp = timing.warps[start.warp];
      const warpSum = warp.lengthBeats + noteRowToBeat(warp.row);
      if (warpSum > start.warpDestination) {
        start.warpDestination = warpSum;
      }
      start.warp++;
      currSegment++;
    }

    start.lastRow = event.row;
  }

  if (args.elapsedTime === Infinity) {
    args.elapsedTime = start.lastTime;
  }
  args.beat = noteRowToBeat(start.lastRow) + (args.elapsedTime - start.lastTime) * bps;
  args.bps = bps;
}

/**
 * Walk forward to `beat` and return its elapsed time. Port of
 * TimingData::GetElapsedTimeInternal.
 */
function getElapsedTimeInternal(timing, start, beat, maxSegment) {
  let currSegment = start.bpm + start.warp + start.stop + start.delay;
  let bps = bpmAtRow(timing, start.lastRow) / 60;
  const findMarker = Number.isFinite(beat);
  const markerRow = findMarker ? beatToNoteRow(beat) : 0;

  while (currSegment < maxSegment) {
    const event = findEvent(timing, start, markerRow, findMarker);
    if (event.type === NOT_FOUND) break;

    const timeToNextEvent = start.isWarping ? 0 : noteRowToBeat(event.row - start.lastRow) / bps;
    start.lastTime += timeToNextEvent;

    if (event.type === FOUND_MARKER) {
      // Events resolve on quantized rows, but the caller may ask for a
      // position between them (the play head, not a note). SM drops that
      // remainder; keeping it is what makes CMod scrolling smooth instead
      // of stepping once per 1/48 beat.
      const partialBeat = beat - noteRowToBeat(markerRow);
      return start.lastTime + (start.isWarping ? 0 : partialBeat / bps);
    } else if (event.type === FOUND_WARP_DESTINATION) {
      start.isWarping = false;
    } else if (event.type === FOUND_BPM_CHANGE) {
      bps = timing.bpms[start.bpm].bpm / 60;
      start.bpm++;
      currSegment++;
    } else if (event.type === FOUND_STOP) {
      start.lastTime += timing.stops[start.stop].seconds;
      start.stop++;
      currSegment++;
    } else if (event.type === FOUND_DELAY) {
      start.lastTime += timing.delays[start.delay].seconds;
      start.delay++;
      currSegment++;
    } else if (event.type === FOUND_WARP) {
      start.isWarping = true;
      const warp = timing.warps[start.warp];
      const warpSum = warp.lengthBeats + noteRowToBeat(warp.row);
      if (warpSum > start.warpDestination) {
        start.warpDestination = warpSum;
      }
      start.warp++;
      currSegment++;
    }

    start.lastRow = event.row;
  }

  if (findMarker) {
    start.lastTime += (beat - noteRowToBeat(start.lastRow)) / bps;
    start.lastRow = markerRow;
  }
  return start.lastTime;
}

/**
 * Snapshots of the walk state every SEGMENTS_PER_LOOKUP events, so a lookup
 * can start near its target instead of from beat 0. SM keeps the same two
 * tables; unlike SM's version the beat-keyed table is actually advanced.
 */
function prepareLookup(timing) {
  const totalSegments =
    timing.bpms.length + timing.warps.length + timing.stops.length + timing.delays.length;

  const byTime = [];
  const byBeat = [];

  for (
    let currSegment = SEGMENTS_PER_LOOKUP;
    currSegment < totalSegments;
    currSegment += SEGMENTS_PER_LOOKUP
  ) {
    const beatStart = newStarts();
    const args = { elapsedTime: Infinity, beat: 0, bps: 0, freeze: false, delay: false };
    getBeatInternal(timing, beatStart, args, currSegment);
    byTime.push({ key: args.elapsedTime, starts: beatStart });

    const timeStart = newStarts();
    getElapsedTimeInternal(timing, timeStart, Infinity, currSegment);
    byBeat.push({ key: noteRowToBeat(timeStart.lastRow), starts: timeStart });
  }

  return { byTime, byBeat };
}

/** Last snapshot at or before `key`, or null. */
function findEntryInLookup(entries, key) {
  let lo = 0;
  let hi = entries.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].key <= key) {
      found = entries[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Beat (and surrounding freeze state) at an elapsed chart time.
 *
 * @param {TimingData} timing
 * @param {number} seconds - Chart-relative seconds; beat 0 is at 0
 * @returns {{beat: number, bps: number, freeze: boolean, delay: boolean}}
 */
export function getBeatFromElapsedTime(timing, seconds) {
  const entry = findEntryInLookup(timing.lookup?.byTime ?? [], seconds);
  const start = entry ? cloneStarts(entry.starts) : newStarts();
  const args = { elapsedTime: seconds, beat: 0, bps: 0, freeze: false, delay: false };
  getBeatInternal(timing, start, args, Infinity);
  return { beat: args.beat, bps: args.bps, freeze: args.freeze, delay: args.delay };
}

/**
 * Elapsed chart time at a beat.
 *
 * @param {TimingData} timing
 * @param {number} beat
 * @returns {number} Chart-relative seconds
 */
export function getElapsedTimeFromBeat(timing, beat) {
  const entry = findEntryInLookup(timing.lookup?.byBeat ?? [], beat);
  const start = entry ? cloneStarts(entry.starts) : newStarts();
  return getElapsedTimeInternal(timing, start, beat, Infinity);
}

/**
 * Whether a beat is inside a warp, meaning the song skips past it. Port of
 * TimingData::IsWarpAtRow, including its allowance for stops inside warps.
 */
export function isWarpAtBeat(timing, beat) {
  if (!timing.warps.length) return false;

  const row = beatToNoteRow(beat);
  const i = segmentIndexAtRow(timing.warps, row);
  if (i < 0) return false;

  const warp = timing.warps[i];
  const warpBeat = noteRowToBeat(warp.row);
  const beatRow = noteRowToBeat(row);

  if (warpBeat <= beatRow && beatRow < warpBeat + warp.lengthBeats) {
    if (!timing.stops.length && !timing.delays.length) return true;
    // Stops inside warps are allowed, so a row carrying one is still real.
    if (pauseAtRow(timing.stops, row) !== 0 || pauseAtRow(timing.delays, row) !== 0) {
      return false;
    }
    return true;
  }
  return false;
}

/** Notes inside a warp are skipped by the song and cannot be hit. */
export function isJudgableAtBeat(timing, beat) {
  return !isWarpAtBeat(timing, beat);
}

/**
 * Drop notes the song warps past. They are unreachable, and leaving them in
 * would spray misses (and drain health) the instant the warp runs.
 *
 * @param {TimingData} timing
 * @param {Array<[number, number, Object]>} noteData
 */
export function filterUnjudgableNotes(timing, noteData) {
  if (!timing.warps.length) return noteData;
  return noteData.filter((note) => isJudgableAtBeat(timing, note[0]));
}
