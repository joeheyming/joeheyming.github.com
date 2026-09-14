import {
  createEmptyPack,
  setPackAsset,
  readZipFiles,
  packFromFiles,
  packFromFilesPlayable,
  packFromSimfileText,
  packToZipBlob,
  sanitizePathPart
} from '../stepmania/js/packIo.js';
import { formatTimingPairs, parseTimingPairs } from '../stepmania/js/msd.js';
import {
  buildTimingData,
  getBeatFromElapsedTime,
  getElapsedTimeFromBeat
} from '../stepmania/js/timingData.js';
import { parseBgChangesValue } from '../stepmania/js/simfileParser.js';
import { saveDraft, newDraftId } from '../stepmania/js/localPackStore.js';
import { mountNotefield } from './notefield.js';
import { resolveEditAction } from './editorKeymap.js';
import { adjacentChartIndex } from './chartNavigation.js';
import { toggleNote, placeHold, removeNote, propsForTool, quantizeBeat } from './editorNotes.js';
import { playPackInSurface, stopPackInSurface } from '../stepmania/js/portablePlayer.js';

const DIFFS = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge', 'Edit'];

const state = {
  pack: createEmptyPack({ title: 'New Song', bpm: 120 }),
  draftId: newDraftId(),
  chartIndex: 0,
  cursorBeat: 0,
  cursorCol: 0,
  snap: 16,
  tool: 'tap',
  playing: false,
  gamePlaying: false,
  playBeat: 0,
  gameAudioSecond: 0,
  /** @type {number|null} beat to stop at when previewing a marked area */
  playStopBeat: null,
  /** @type {number|null} */
  selStart: null,
  /** @type {number|null} */
  selEnd: null,
  zoom: 1,
  undo: [],
  redo: [],
  /** @type {Map<string, object>|null} file map of the last imported zip */
  importedFiles: null
};

const audio = document.getElementById('ed-audio');
let saveTimer = 0;
let objectUrl = null;

function parsed() {
  return state.pack.parsed;
}

function chart() {
  return parsed().charts[state.chartIndex] || parsed().charts[0];
}

function timingModel() {
  const c = chart();
  if (c?.hasSplitTiming && c.timing) return c.timing;
  return parsed().timing || buildTimingData(parsed().timingTags || {});
}

function offsetSec() {
  const c = chart();
  if (c?.hasSplitTiming && Number.isFinite(c.offset)) return c.offset;
  return Number(parsed().offset) || 0;
}

function snapshotNotes() {
  state.undo.push(structuredClone(chart().noteData || []));
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
}

function setNotes(next) {
  chart().noteData = next;
  scheduleSave();
}

function showMsg(text) {
  const el = document.getElementById('ed-msg');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function pairsToText(pairs) {
  return formatTimingPairs(pairs || []);
}

/** The beat/second pair that changes every frame while the music runs. */
function updateLiveReadout() {
  const activeBeat = state.playing || state.gamePlaying ? state.playBeat : state.cursorBeat;
  const second = state.gamePlaying
    ? state.gameAudioSecond
    : state.playing
    ? audio.currentTime
    : Math.max(0, getElapsedTimeFromBeat(timingModel(), activeBeat) - offsetSec());
  document.getElementById('info-beat').textContent = activeBeat.toFixed(3);
  document.getElementById('info-second').textContent = second.toFixed(6);
  document.getElementById('cursor-readout').textContent = `Beat ${activeBeat.toFixed(3)}  col ${
    state.cursorCol + 1
  }`;
}

function updateWorkspaceInfo() {
  const notes = chart()?.noteData || [];
  const counts = {
    taps: 0,
    holds: 0,
    rolls: 0,
    mines: 0,
    lifts: 0,
    fakes: 0
  };
  for (const [, , props] of notes) {
    switch (props?.Type) {
      case 2:
        counts.holds += 1;
        break;
      case 4:
        counts.rolls += 1;
        break;
      case 'M':
        counts.mines += 1;
        break;
      case 'L':
        counts.lifts += 1;
        break;
      case 'F':
        counts.fakes += 1;
        break;
      default:
        counts.taps += 1;
        break;
    }
  }
  let selection = 'none';
  if (state.selStart != null && state.selEnd == null) {
    selection = `${state.selStart.toFixed(3)}–…`;
  } else if (state.selStart != null && state.selEnd != null) {
    selection = `${state.selStart.toFixed(3)}–${state.selEnd.toFixed(3)}`;
  }
  const c = chart();
  updateLiveReadout();
  document.getElementById('info-snap').textContent = `${
    document.getElementById('snap').selectedOptions[0]?.textContent || state.snap
  } notes`;
  document.getElementById('info-selection').textContent = selection;
  document.getElementById('info-title').textContent = parsed().title || 'New Song';
  for (const name of Object.keys(counts)) {
    document.getElementById(`info-${name}`).textContent = String(counts[name]);
  }
  document.getElementById('info-timing-mode').textContent = c?.hasSplitTiming
    ? 'Chart timing'
    : 'Song timing';
  document.getElementById('info-offset').textContent = `${offsetSec().toFixed(3)} secs`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function applyMetadataFromForm() {
  const p = parsed();
  p.title = document.getElementById('f-title').value.trim() || 'New Song';
  p.artist = document.getElementById('f-artist').value.trim();
  p.metadata.TITLE = p.title;
  p.metadata.ARTIST = p.artist;
  p.metadata.CREDIT = document.getElementById('f-credit').value.trim();
  p.metadata.GENRE = document.getElementById('f-genre').value.trim();
  p.offset = parseFloat(document.getElementById('f-offset').value) || 0;
  p.bpm = parseFloat(document.getElementById('f-bpm').value) || 120;
  p.metadata.DISPLAYBPM = String(p.bpm);
  p.metadata.SAMPLESTART = document.getElementById('f-sample-start').value;
  p.metadata.SAMPLELENGTH = document.getElementById('f-sample-length').value;
  const c = chart();
  if (c) {
    c.difficulty = document.getElementById('chart-diff').value;
    c.rating = parseInt(document.getElementById('chart-meter').value, 10) || 1;
    c.hasSplitTiming = document.getElementById('split-timing').checked;
  }
  state.pack.songDir = sanitizePathPart(p.title);
}

function timingTarget() {
  const c = chart();
  if (c?.hasSplitTiming) {
    if (!c.timingTags) {
      c.timingTags = structuredClone(
        parsed().timingTags || { bpms: [], stops: [], delays: [], warps: [] }
      );
    }
    if (!c.timingExtras) c.timingExtras = {};
    return { tags: c.timingTags, extras: c.timingExtras, setOffset: (v) => (c.offset = v) };
  }
  if (!parsed().timingExtras) parsed().timingExtras = {};
  return {
    tags: parsed().timingTags,
    extras: parsed().timingExtras,
    setOffset: (v) => (parsed().offset = v)
  };
}

function applyTimingFromForm() {
  const target = timingTarget();
  target.tags.bpms = parseTimingPairs(document.getElementById('t-bpms').value);
  target.tags.stops = parseTimingPairs(document.getElementById('t-stops').value);
  target.tags.delays = parseTimingPairs(document.getElementById('t-delays').value);
  target.tags.warps = parseTimingPairs(document.getElementById('t-warps').value);
  const extras = {
    SPEEDS: document.getElementById('t-speeds').value.trim(),
    SCROLLS: document.getElementById('t-scrolls').value.trim(),
    FAKES: document.getElementById('t-fakes').value.trim(),
    LABELS: document.getElementById('t-labels').value.trim(),
    TIMESIGNATURES: document.getElementById('t-timesig').value.trim()
  };
  target.extras = Object.fromEntries(Object.entries(extras).filter(([, v]) => v));
  const c = chart();
  if (c?.hasSplitTiming) {
    c.timingExtras = target.extras;
    c.timing = buildTimingData(c.timingTags);
  } else {
    parsed().timingExtras = target.extras;
    parsed().timingTags = target.tags;
    parsed().timing = buildTimingData(target.tags);
    parsed().bpmChanges = (target.tags.bpms || []).map((x) => ({ beat: x.beat, bpm: x.value }));
    if (target.tags.bpms?.[0]) parsed().bpm = target.tags.bpms[0].value;
  }
  parsed().bgChanges = parseBgChangesValue(document.getElementById('t-bgchanges').value);
}

function fillForm() {
  const p = parsed();
  const c = chart();
  const songs = state.pack.songs || [];
  const songRow = document.getElementById('song-in-pack-row');
  songRow.hidden = songs.length < 2;
  if (!songRow.hidden) {
    const songSel = document.getElementById('song-in-pack');
    songSel.innerHTML = songs
      .map((s) => `<option value="${escapeAttr(s.simfilePath)}">${escapeHtml(s.title)}</option>`)
      .join('');
    songSel.value = state.pack.simfilePath || songs[0].simfilePath;
    const at = songs.findIndex((s) => s.simfilePath === songSel.value);
    document.getElementById('song-in-pack-label').textContent = `Song in pack (${at + 1} of ${
      songs.length
    })`;
  }
  document.getElementById('f-title').value = p.title || '';
  document.getElementById('f-artist').value = p.artist || '';
  document.getElementById('f-credit').value = p.metadata.CREDIT || '';
  document.getElementById('f-genre').value = p.metadata.GENRE || '';
  document.getElementById('f-offset').value = String(p.offset ?? 0);
  document.getElementById('f-bpm').value = String(p.bpm ?? 120);
  document.getElementById('f-sample-start').value = p.metadata.SAMPLESTART || '';
  document.getElementById('f-sample-length').value = p.metadata.SAMPLELENGTH || '';
  const sel = document.getElementById('chart-select');
  sel.innerHTML = p.charts
    .map(
      (ch, i) =>
        `<option value="${i}">${escapeHtml(ch.difficulty)} ${escapeHtml(ch.rating)} (${escapeHtml(
          ch.type
        )})</option>`
    )
    .join('');
  sel.value = String(state.chartIndex);
  if (c) {
    document.getElementById('chart-diff').value = DIFFS.includes(c.difficulty)
      ? c.difficulty
      : 'Beginner';
    document.getElementById('chart-meter').value = String(c.rating || 1);
    document.getElementById('split-timing').checked = !!c.hasSplitTiming;
  }
  const tags = c?.hasSplitTiming && c.timingTags ? c.timingTags : p.timingTags;
  const extras = (c?.hasSplitTiming && c.timingExtras) || p.timingExtras || {};
  document.getElementById('t-bpms').value = pairsToText(tags?.bpms);
  document.getElementById('t-stops').value = pairsToText(tags?.stops);
  document.getElementById('t-delays').value = pairsToText(tags?.delays);
  document.getElementById('t-warps').value = pairsToText(tags?.warps);
  document.getElementById('t-speeds').value = extras.SPEEDS || '';
  document.getElementById('t-scrolls').value = extras.SCROLLS || '';
  document.getElementById('t-fakes').value = extras.FAKES || '';
  document.getElementById('t-labels').value = extras.LABELS || '';
  document.getElementById('t-timesig').value = extras.TIMESIGNATURES || '';
  document.getElementById('t-bgchanges').value = (p.bgChanges || [])
    .map(
      (bg) =>
        `${Number(bg.beat).toFixed(3)}=${bg.file}=${bg.effect || '1.000'}=${bg.x || 0}=${bg.y || 0}`
    )
    .join(',');
  const assets = document.getElementById('asset-status');
  assets.innerHTML = [
    ['Music', state.pack.musicPath],
    ['Banner', state.pack.bannerPath],
    ['Background', state.pack.backgroundPath],
    ['Jacket', state.pack.jacketPath],
    ['Video', state.pack.videoPath]
  ]
    .map(([label, path]) => `<li>${label}: ${path ? escapeHtml(path.split('/').pop()) : '—'}</li>`)
    .join('');
  updateWorkspaceInfo();
}

function reloadAudio() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  const file = state.pack.musicPath && state.pack.files.get(state.pack.musicPath);
  if (!file?.blob) {
    audio.removeAttribute('src');
    return;
  }
  objectUrl = URL.createObjectURL(file.blob);
  audio.src = objectUrl;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistDraft();
  }, 600);
}

/** @returns {Promise<boolean>} whether the draft reached IndexedDB */
async function persistDraft() {
  applyMetadataFromForm();
  applyTimingFromForm();
  try {
    const zipBlob = await packToZipBlob(state.pack);
    await saveDraft({
      id: state.draftId,
      title: parsed().title,
      artist: parsed().artist,
      updatedAt: Date.now(),
      zipBlob
    });
    showMsg('');
    return true;
  } catch (err) {
    console.error(err);
    showMsg(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function downloadZip() {
  applyMetadataFromForm();
  applyTimingFromForm();
  const blob = await packToZipBlob(state.pack);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${parsed().title || 'song'}.smzip`;
  a.click();
}

async function playFromCursor() {
  await launchGameplayPreview(state.cursorBeat);
}

async function launchGameplayPreview(startBeat) {
  stopPlayback();
  applyMetadataFromForm();
  applyTimingFromForm();
  const preview = document.getElementById('game-preview');
  preview.hidden = false;
  state.gamePlaying = true;
  state.playBeat = startBeat;
  updateLiveReadout();
  // Take focus off the header control: while gameplay owns the screen, a stray
  // Enter or Space must not re-activate whatever launched it.
  document.getElementById('btn-return-to-edit').focus();
  try {
    await playPackInSurface({
      pack: state.pack,
      chartIndex: state.chartIndex,
      startBeat,
      onReturn: () => returnToEditor({ preserveCursor: true }),
      onPosition: ({ beat, audioSecond }) => {
        state.playBeat = beat;
        state.gameAudioSecond = audioSecond;
        updateLiveReadout();
      }
    });
  } catch (err) {
    state.gamePlaying = false;
    preview.hidden = true;
    showMsg(err instanceof Error ? err.message : String(err));
    updateLiveReadout();
  }
}

function returnToEditor({ preserveCursor = false } = {}) {
  const preview = document.getElementById('game-preview');
  if (preview.hidden) return;
  if (state.gamePlaying && !preserveCursor) {
    state.cursorBeat = Math.max(0, quantizeBeat(state.playBeat, state.snap));
  }
  stopPackInSurface();
  state.gamePlaying = false;
  preview.hidden = true;
  updateLiveReadout();
  document.getElementById('notefield').focus();
}

function adoptPack(pack) {
  state.pack = pack;
  state.chartIndex = 0;
  state.draftId = newDraftId();
  state.undo = [];
  state.redo = [];
  state.cursorBeat = 0;
  state.selStart = null;
  state.selEnd = null;
  state.playStopBeat = null;
  reloadAudio();
  fillForm();
  scheduleSave();
}

async function importFile(file) {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.sm') || name.endsWith('.ssc')) {
      state.importedFiles = null;
      adoptPack(packFromSimfileText(file.name, await file.text()));
      return;
    }
    // Keep the archive's file map so switching songs in a multi-song pack
    // doesn't require re-reading the zip.
    state.importedFiles = await readZipFiles(await file.arrayBuffer());
    adoptPack(packFromFilesPlayable(state.importedFiles));
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err));
  }
}

function switchSongInPack(simfilePath) {
  if (!state.importedFiles) return;
  try {
    adoptPack(packFromFiles(state.importedFiles, { simfilePath }));
    showMsg('');
  } catch (err) {
    showMsg(err instanceof Error ? err.message : String(err));
  }
}

function bindAsset(inputId, role) {
  document.getElementById(inputId).addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPackAsset(state.pack, role, file.name, file, file.type);
    if (role === 'music') reloadAudio();
    fillForm();
    scheduleSave();
  });
}

function currentProps() {
  return propsForTool(state.tool);
}

function placeAt(beat, col, endBeat) {
  snapshotNotes();
  const q = (b) => quantizeBeat(b, state.snap);
  const b0 = q(beat);
  if (state.tool === 'hold' || state.tool === 'roll') {
    const b1 = q(endBeat == null ? beat + 1 : endBeat);
    setNotes(placeHold(chart().noteData, b0, b1, col, state.tool === 'roll' ? 4 : 2));
  } else {
    setNotes(toggleNote(chart().noteData, b0, col, currentProps()));
  }
}

function onFieldInput(ev) {
  if (ev.type === 'down') {
    state.cursorBeat = quantizeBeat(ev.beat, state.snap);
    state.cursorCol = ev.col;
    if (state.tool !== 'hold' && state.tool !== 'roll') {
      placeAt(ev.beat, ev.col);
    }
    fillForm();
  }
  if (ev.type === 'up' && (state.tool === 'hold' || state.tool === 'roll')) {
    placeAt(ev.startBeat, ev.col, ev.beat);
    fillForm();
  }
  if (ev.type === 'wheel') {
    const step = 4 / state.snap;
    state.cursorBeat = Math.max(0, quantizeBeat(state.cursorBeat + ev.delta * step, state.snap));
    fillForm();
  }
}

function togglePlayback() {
  if (state.playing) stopPlayback();
  else startPlayback(state.cursorBeat);
}

/**
 * Beat under the playhead right now, read straight from the media clock.
 *
 * The `timeupdate` event only fires a few times a second, so driving the
 * playhead from it steps the notefield in visible jumps. `currentTime` itself
 * advances continuously, so sampling it per frame scrolls smoothly and stops a
 * marked area within one frame instead of up to a quarter second late.
 */
function currentPlayBeat() {
  const songSeconds = audio.currentTime + offsetSec();
  return Math.max(0, getBeatFromElapsedTime(timingModel(), songSeconds).beat);
}

let playRaf = 0;

function playTick() {
  if (!state.playing) return;
  state.playBeat = currentPlayBeat();
  if (state.playStopBeat != null && state.playBeat >= state.playStopBeat) {
    stopPlayback();
    return;
  }
  updateLiveReadout();
  playRaf = requestAnimationFrame(playTick);
}
audio.addEventListener('pause', () => {
  state.playing = false;
  document.getElementById('btn-play').textContent = 'Preview audio';
});
audio.addEventListener('ended', () => {
  state.playing = false;
  document.getElementById('btn-play').textContent = 'Preview audio';
});

// --- StepMania edit-mode keymap -------------------------------------------
// Ported from the SM5 defaults in Docs/Mapping_keys_for_edit_mode.txt and
// ScreenEdit.cpp, so muscle memory carries over. Notably: Space lays an area
// marker (it is not play/pause), P plays, and Enter/Escape return to editing.

const SNAP_CYCLE = [4, 8, 12, 16, 24, 32, 48, 64, 192];
const TAP_CYCLE = ['tap', 'mine', 'lift', 'fake'];
const TIMING_DELTA = 0.02;

function snapStepBeats() {
  return 4 / state.snap;
}

function cycleSnap(direction) {
  const at = SNAP_CYCLE.indexOf(state.snap);
  const next = Math.min(SNAP_CYCLE.length - 1, Math.max(0, (at < 0 ? 3 : at) + direction));
  state.snap = SNAP_CYCLE[next];
  document.getElementById('snap').value = String(state.snap);
}

function cycleTapType(direction) {
  const at = TAP_CYCLE.indexOf(state.tool);
  const next = (at + direction + TAP_CYCLE.length) % TAP_CYCLE.length;
  selectTool(at < 0 ? TAP_CYCLE[0] : TAP_CYCLE[next]);
}

function selectTool(tool) {
  state.tool = tool;
  for (const b of document.querySelectorAll('.ed-tools [data-tool]')) {
    b.classList.toggle('is-on', b.getAttribute('data-tool') === tool);
  }
}

function scrollTo(beat) {
  state.cursorBeat = Math.max(0, quantizeBeat(beat, state.snap));
  fillForm();
}

/** SCROLL_NEXT / SCROLL_PREV: jump to the next row that holds a note. */
function scrollToAdjacentNote(direction) {
  const beats = [...new Set((chart()?.noteData || []).map((n) => n[0]))].sort((a, b) => a - b);
  const target =
    direction > 0
      ? beats.find((b) => b > state.cursorBeat + 1e-6)
      : [...beats].reverse().find((b) => b < state.cursorBeat - 1e-6);
  if (target != null) scrollTo(target);
}

function lastNoteBeat() {
  return (chart()?.noteData || []).reduce((max, n) => Math.max(max, n[0]), 0);
}

function laySelect() {
  const at = state.cursorBeat;
  if (state.selStart == null) {
    state.selStart = at;
    state.selEnd = null;
  } else if (state.selEnd == null) {
    if (Math.abs(at - state.selStart) < 1e-6) {
      state.selStart = null;
    } else {
      state.selEnd = Math.max(state.selStart, at);
      state.selStart = Math.min(state.selStart, at);
    }
  } else {
    state.selStart = at;
    state.selEnd = null;
  }
}

function startPlayback(fromBeat, stopBeat = null) {
  if (!state.pack.musicPath) {
    showMsg('Add a music file to preview from the cursor.');
    return;
  }
  const songSeconds = getElapsedTimeFromBeat(timingModel(), fromBeat);
  audio.currentTime = Math.max(0, songSeconds - offsetSec());
  state.playBeat = fromBeat;
  state.playStopBeat = stopBeat;
  audio.play().catch((err) => showMsg(String(err)));
  state.playing = true;
  document.getElementById('btn-play').textContent = 'Pause';
  cancelAnimationFrame(playRaf);
  playRaf = requestAnimationFrame(playTick);
}

function stopPlayback() {
  state.playStopBeat = null;
  cancelAnimationFrame(playRaf);
  playRaf = 0;
  audio.pause();
  state.playing = false;
  document.getElementById('btn-play').textContent = 'Preview audio';
  updateLiveReadout();
}

/** PLAY_SELECTION, falling back to play-from-cursor when nothing is marked. */
function playSelection() {
  if (state.selStart != null && state.selEnd != null) {
    startPlayback(state.selStart, state.selEnd);
  } else {
    startPlayback(state.cursorBeat);
  }
}

function playSampleMusic() {
  if (!state.pack.musicPath) return;
  const start = parseFloat(parsed().metadata.SAMPLESTART) || 0;
  const length = parseFloat(parsed().metadata.SAMPLELENGTH) || 12;
  audio.currentTime = start;
  state.playStopBeat = null;
  state.playing = false;
  audio.play().catch((err) => showMsg(String(err)));
  clearTimeout(playSampleMusic.timer);
  playSampleMusic.timer = setTimeout(() => audio.pause(), length * 1000);
}

function bpmAtBeat(pairs, beat) {
  let value = parsed().bpm || 120;
  for (const pair of pairs || []) {
    if (pair.beat <= beat + 1e-6) value = pair.value;
  }
  return value;
}

/**
 * Adjust a timing value at the cursor, matching ScreenEdit's ±0.020 step and
 * its Alt-for-fine modifier (÷20).
 * @param {'bpm'|'stop'|'delay'|'offset'|'sampleStart'|'sampleLength'} kind
 * @param {number} direction
 * @param {boolean} fine
 */
function adjustTiming(kind, direction, fine) {
  const delta = direction * (fine ? TIMING_DELTA / 20 : TIMING_DELTA);
  const target = timingTarget();
  if (kind === 'offset') {
    target.setOffset(Number(((Number(offsetSec()) || 0) + delta).toFixed(6)));
  } else if (kind === 'bpm') {
    const pairs = target.tags.bpms || (target.tags.bpms = []);
    const at = pairs.find((p) => Math.abs(p.beat - state.cursorBeat) < 1e-6);
    const next = Number((bpmAtBeat(pairs, state.cursorBeat) + delta).toFixed(6));
    if (next <= 0) return;
    if (at) at.value = next;
    else pairs.push({ beat: state.cursorBeat, value: next });
    pairs.sort((a, b) => a.beat - b.beat);
  } else if (kind === 'stop' || kind === 'delay') {
    const key = kind === 'stop' ? 'stops' : 'delays';
    const pairs = target.tags[key] || (target.tags[key] = []);
    const at = pairs.find((p) => Math.abs(p.beat - state.cursorBeat) < 1e-6);
    const next = Number(((at?.value || 0) + delta).toFixed(6));
    if (at) {
      if (next <= 0) pairs.splice(pairs.indexOf(at), 1);
      else at.value = next;
    } else if (next > 0) {
      pairs.push({ beat: state.cursorBeat, value: next });
      pairs.sort((a, b) => a.beat - b.beat);
    }
  } else {
    const key = kind === 'sampleStart' ? 'SAMPLESTART' : 'SAMPLELENGTH';
    const current = parseFloat(parsed().metadata[key]) || 0;
    parsed().metadata[key] = Math.max(0, current + delta).toFixed(3);
  }
  if (kind !== 'sampleStart' && kind !== 'sampleLength') {
    const c = chart();
    if (c?.hasSplitTiming) c.timing = buildTimingData(c.timingTags);
    else parsed().timing = buildTimingData(parsed().timingTags);
  }
  fillForm();
  scheduleSave();
}

function undoNotes() {
  const prev = state.undo.pop();
  if (!prev) return;
  state.redo.push(structuredClone(chart().noteData));
  chart().noteData = prev;
  scheduleSave();
}

function redoNotes() {
  const next = state.redo.pop();
  if (!next) return;
  state.undo.push(structuredClone(chart().noteData));
  chart().noteData = next;
  scheduleSave();
}

function toggleSplitTiming() {
  const box = document.getElementById('split-timing');
  box.checked = !box.checked;
  applyMetadataFromForm();
  applyTimingFromForm();
  fillForm();
  scheduleSave();
}

function layColumn(column, roll) {
  state.cursorCol = column;
  const previousTool = state.tool;
  if (roll) state.tool = 'roll';
  placeAt(state.cursorBeat, column);
  state.tool = previousTool;
  fillForm();
}

function deleteAtCursor() {
  snapshotNotes();
  setNotes(removeNote(chart().noteData, state.cursorBeat, state.cursorCol));
  fillForm();
}

function switchChart(direction) {
  applyMetadataFromForm();
  applyTimingFromForm();
  const songSeconds = getElapsedTimeFromBeat(timingModel(), state.cursorBeat) - offsetSec();
  const next = adjacentChartIndex(parsed().charts, state.chartIndex, direction);
  if (next === state.chartIndex) return;

  state.chartIndex = next;
  state.undo = [];
  state.redo = [];
  state.cursorBeat = Math.max(
    0,
    getBeatFromElapsedTime(timingModel(), songSeconds + offsetSec()).beat
  );
  fillForm();
  scheduleSave();
}

/** @param {KeyboardEvent} e */
function handleEditKey(e) {
  if (!document.getElementById('game-preview').hidden) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      returnToEditor();
      return;
    }
    // ScreenEdit has no paused play state, and neither can this: the player's
    // Space binding would stop the music with gameplay still on screen and no
    // obvious way out. Swallow it before inputManager sees it.
    if (e.key === ' ') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    return;
  }
  if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
  const hit = resolveEditAction(e, { playing: state.playing });
  if (!hit) return;
  if (hit.preventDefault) e.preventDefault();
  const fine = hit.fine;

  switch (hit.action) {
    case 'RETURN_TO_EDIT':
      stopPlayback();
      break;
    case 'PLAY_FROM_START':
      void launchGameplayPreview(0);
      break;
    case 'PLAY_FROM_CURSOR':
      void launchGameplayPreview(state.cursorBeat);
      break;
    case 'PLAY_SELECTION':
      playSelection();
      break;
    case 'PLAY_SAMPLE_MUSIC':
      playSampleMusic();
      break;
    case 'SAVE':
      void persistDraft();
      break;
    case 'UNDO':
      undoNotes();
      break;
    case 'REDO':
      redoNotes();
      break;
    case 'LAY_SELECT':
      laySelect();
      break;
    case 'SCROLL_UP_LINE':
      scrollTo(state.cursorBeat - snapStepBeats());
      break;
    case 'SCROLL_DOWN_LINE':
      scrollTo(state.cursorBeat + snapStepBeats());
      break;
    case 'SCROLL_UP_PAGE':
      scrollTo(state.cursorBeat - 4);
      break;
    case 'SCROLL_DOWN_PAGE':
      scrollTo(state.cursorBeat + 4);
      break;
    case 'SCROLL_HOME':
      scrollTo(0);
      break;
    case 'SCROLL_END':
      scrollTo(lastNoteBeat());
      break;
    case 'SCROLL_PREV':
      scrollToAdjacentNote(-1);
      break;
    case 'SCROLL_NEXT':
      scrollToAdjacentNote(1);
      break;
    case 'SCROLL_SPEED_UP':
      state.zoom = Math.min(3, state.zoom * 1.2);
      break;
    case 'SCROLL_SPEED_DOWN':
      state.zoom = Math.max(0.3, state.zoom / 1.2);
      break;
    // SM's SNAP_NEXT steps to the previous (coarser) note type; see
    // EDIT_BUTTON_SNAP_NEXT calling PrevSnapMode() in ScreenEdit.cpp.
    case 'SNAP_NEXT':
      cycleSnap(-1);
      break;
    case 'SNAP_PREV':
      cycleSnap(1);
      break;
    case 'DELETE':
      deleteAtCursor();
      break;
    case 'BPM_DOWN':
      adjustTiming('bpm', -1, fine);
      break;
    case 'BPM_UP':
      adjustTiming('bpm', 1, fine);
      break;
    case 'STOP_DOWN':
      adjustTiming('stop', -1, fine);
      break;
    case 'STOP_UP':
      adjustTiming('stop', 1, fine);
      break;
    case 'DELAY_DOWN':
      adjustTiming('delay', -1, fine);
      break;
    case 'DELAY_UP':
      adjustTiming('delay', 1, fine);
      break;
    case 'OFFSET_DOWN':
      adjustTiming('offset', -1, fine);
      break;
    case 'OFFSET_UP':
      adjustTiming('offset', 1, fine);
      break;
    case 'SAMPLE_START_DOWN':
      adjustTiming('sampleStart', -1, fine);
      break;
    case 'SAMPLE_START_UP':
      adjustTiming('sampleStart', 1, fine);
      break;
    case 'SAMPLE_LENGTH_DOWN':
      adjustTiming('sampleLength', -1, fine);
      break;
    case 'SAMPLE_LENGTH_UP':
      adjustTiming('sampleLength', 1, fine);
      break;
    case 'CYCLE_TAP_LEFT':
      cycleTapType(-1);
      break;
    case 'CYCLE_TAP_RIGHT':
      cycleTapType(1);
      break;
    case 'SWITCH_TIMINGS':
      toggleSplitTiming();
      break;
    case 'OPEN_INPUT_HELP': {
      const help = document.getElementById('ed-keys');
      help.open = !help.open;
      break;
    }
    case 'OPEN_PREV_STEPS':
      switchChart(-1);
      break;
    case 'OPEN_NEXT_STEPS':
      switchChart(1);
      break;
    default:
      if (hit.column != null) layColumn(hit.column, hit.roll);
      break;
  }
  updateWorkspaceInfo();
}

function setDrawer(id, open) {
  const panel = document.getElementById(id);
  panel.classList.toggle('is-open', open);
  const triggerId = id === 'song-panel' ? 'btn-song-panel' : 'btn-timing-panel';
  document.getElementById(triggerId).setAttribute('aria-expanded', String(open));
}

document.getElementById('btn-song-panel').addEventListener('click', () => {
  setDrawer('timing-panel', false);
  setDrawer('song-panel', !document.getElementById('song-panel').classList.contains('is-open'));
});
document.getElementById('btn-timing-panel').addEventListener('click', () => {
  setDrawer('song-panel', false);
  setDrawer('timing-panel', !document.getElementById('timing-panel').classList.contains('is-open'));
});
document.getElementById('btn-close-song').addEventListener('click', () => {
  setDrawer('song-panel', false);
});
document.getElementById('btn-close-timing').addEventListener('click', () => {
  setDrawer('timing-panel', false);
});

document.getElementById('btn-new').addEventListener('click', () => {
  state.importedFiles = null;
  adoptPack(createEmptyPack({ title: 'New Song', bpm: 120 }));
  showMsg('');
});
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) void importFile(file);
});
document.getElementById('btn-download').addEventListener('click', () => void downloadZip());
document.getElementById('btn-play-sm').addEventListener('click', () => void playFromCursor());
document.getElementById('btn-play').addEventListener('click', togglePlayback);
document.getElementById('btn-return-to-edit').addEventListener('click', returnToEditor);
document.getElementById('btn-add-chart').addEventListener('click', () => {
  parsed().charts.push({
    type: 'dance-single',
    description: '',
    difficulty: 'Easy',
    rating: parsed().charts.length + 1,
    radarValues: '0,0,0,0,0',
    noteData: [],
    chartName: '',
    credit: '',
    hasSplitTiming: false
  });
  state.chartIndex = parsed().charts.length - 1;
  fillForm();
  scheduleSave();
});
document.getElementById('song-in-pack').addEventListener('change', (e) => {
  switchSongInPack(e.target.value);
});
document.getElementById('chart-select').addEventListener('change', (e) => {
  state.chartIndex = parseInt(e.target.value, 10) || 0;
  fillForm();
});
document.getElementById('snap').addEventListener('change', (e) => {
  state.snap = parseInt(e.target.value, 10) || 16;
  updateWorkspaceInfo();
});
for (const btn of document.querySelectorAll('.ed-tools [data-tool]')) {
  btn.addEventListener('click', () => selectTool(btn.getAttribute('data-tool')));
}
bindAsset('a-music', 'music');
bindAsset('a-banner', 'banner');
bindAsset('a-bg', 'background');
bindAsset('a-jacket', 'jacket');
bindAsset('a-video', 'video');

for (const id of [
  'f-title',
  'f-artist',
  'f-credit',
  'f-genre',
  'f-offset',
  'f-bpm',
  'f-sample-start',
  'f-sample-length',
  'chart-diff',
  'chart-meter',
  'split-timing',
  't-bpms',
  't-stops',
  't-delays',
  't-warps',
  't-speeds',
  't-scrolls',
  't-fakes',
  't-labels',
  't-timesig',
  't-bgchanges'
]) {
  document.getElementById(id).addEventListener('change', () => {
    applyMetadataFromForm();
    applyTimingFromForm();
    fillForm();
    scheduleSave();
  });
}

// Capture phase: the editor decides what gameplay input is allowed to see.
document.addEventListener('keydown', handleEditKey, true);

mountNotefield(
  document.getElementById('notefield'),
  () => ({
    noteData: chart()?.noteData || [],
    cursorBeat: state.cursorBeat,
    cursorCol: state.cursorCol,
    snap: state.snap,
    playBeat: state.playing ? currentPlayBeat() : state.playBeat,
    playing: state.playing,
    selStart: state.selStart,
    selEnd: state.selEnd,
    zoom: state.zoom,
    quantize: (b) => quantizeBeat(b, state.snap)
  }),
  onFieldInput
);

fillForm();
scheduleSave();

if (typeof window.trackProductEvent === 'function') {
  window.trackProductEvent('stepmania_editor_open');
}
