/**
 * Composer — browser sheet-music editor (grand staff notation).
 */
import { setMasterVolume } from '../shared/audio.js';
import { makePrefs } from '../shared/prefs.js';
import { createHistory } from './history.js';
import { bindInput } from './input.js';
import { keySigCount, playheadX } from './layout.js';
import {
  clearNotes,
  findNote,
  insertMeasure,
  loadScore,
  removeMeasure,
  serializeScore,
  setMeasures,
  setTimeSig,
  snapshot,
  updateNote,
  chainHead,
  chainNotes,
  isTieContinue,
  notesSoundingAt
} from './model.js';
import { DUR, KEY_NAMES, TIME_SIGS, clamp, parseTimeSig, timeSigLabel } from './notation.js';
import { createPlayback } from './playback.js';
import { renderScore } from './render.js';
import { decodeScore, downloadScoreJson, encodeScore, scoreUrlFromHash } from './encode.js';

const Prefs = makePrefs('play.composer.prefs.v2');
const PrefsV1 = makePrefs('play.composer.prefs.v1');

const EXPORT_ACHIEVEMENT_MIN_NOTES = 8;

const els = {
  score: document.getElementById('score'),
  scroll: document.getElementById('score-scroll'),
  volume: document.getElementById('volume'),
  bpm: document.getElementById('bpm'),
  bpmValue: document.getElementById('bpm-value'),
  bpmFace: document.getElementById('bpm-face'),
  measures: document.getElementById('measures'),
  barsMinus: document.getElementById('bars-minus'),
  barsPlus: document.getElementById('bars-plus'),
  timeSig: document.getElementById('time-sig'),
  keySig: document.getElementById('key-sig'),
  playPause: document.getElementById('play-pause'),
  stop: document.getElementById('stop'),
  loop: document.getElementById('loop'),
  metronome: document.getElementById('metronome'),
  clear: document.getElementById('clear'),
  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  exportScore: document.getElementById('export-score'),
  importScore: document.getElementById('import-score'),
  importFile: document.getElementById('import-file'),
  copyLink: document.getElementById('copy-link'),
  sharePost: document.getElementById('share-post'),
  examples: document.getElementById('examples'),
  nowPlaying: document.getElementById('now-playing'),
  palette: document.getElementById('palette'),
  voice: document.getElementById('voice'),
  restBtn: document.getElementById('tool-rest'),
  dotBtn: document.getElementById('tool-dot'),
  tieBtn: document.getElementById('tool-tie'),
  dynBtns: document.querySelectorAll('[data-dynamic]')
};

let score = loadScore(null);
const history = createHistory(100);

const ui = {
  selectedId: null,
  playheadStart: 0,
  shadow: null,
  tool: {
    baseDur: DUR.quarter,
    dotted: false,
    rest: false,
    voice: 0
  },
  historyUndo: null,
  historyRedo: null,
  onToolChange: null
};

function getScore() {
  return score;
}
function getUi() {
  return ui;
}
function setUi(patch) {
  Object.assign(ui, patch);
  syncPaletteUi();
  syncDynamicsUi();
  syncHistoryUi();
}

function setStatus(text) {
  if (els.nowPlaying) els.nowPlaying.textContent = text;
}

/** Attacks the listener actually hears: no rests, and tied tails don't re-count. */
function soundedNoteCount(s) {
  return s.notes.filter((n) => !n.rest && !isTieContinue(s, n)).length;
}

const playback = createPlayback({
  onPlayhead(pos) {
    ui.playheadStart = pos;
    const line = els.score.querySelector('.playhead');
    const cap = els.score.querySelector('.playhead-cap');
    const hit = els.score.querySelector('.playhead-hit');
    const ks = keySigCount(score.keySig);
    const x = playheadX(pos, ks);
    if (line) {
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
    }
    if (cap) cap.setAttribute('cx', x);
    if (hit) hit.setAttribute('x', x - 12);
    setSoundingHighlight(playback.state.playing ? notesSoundingAt(score, pos) : []);
    scrollPlayheadIntoView();
    updatePlayButton();
  },
  onStatus: setStatus,
  onEnded() {
    updatePlayButton();
    redraw();
  }
});

function redraw() {
  renderScore(els.score, score, {
    selectedId: ui.selectedId,
    playheadStart: ui.playheadStart,
    shadow: ui.shadow
  });
  if (els.measures) els.measures.value = String(score.measures);
  updatePlayButton();
  syncHistoryUi();
  syncDynamicsUi();
}

function syncHistoryUi() {
  if (els.undo) els.undo.disabled = !history.canUndo();
  if (els.redo) els.redo.disabled = !history.canRedo();
}

function syncDynamicsUi() {
  if (!els.dynBtns?.length) return;
  let dyn = null;
  if (ui.selectedId) {
    const n = findNote(score, ui.selectedId);
    if (n && !n.rest) {
      const head = chainHead(score, n);
      dyn = head?.dynamic || null;
    }
  }
  els.dynBtns.forEach((btn) => {
    const d = btn.getAttribute('data-dynamic');
    btn.setAttribute('aria-pressed', dyn === d ? 'true' : 'false');
  });
}

let soundingEls = [];
/** Toggle the .is-sounding class on note groups currently under the playhead. */
function setSoundingHighlight(ids) {
  const next = new Set(ids);
  for (const el of soundingEls) {
    if (!next.has(el.getAttribute('data-id'))) el.classList.remove('is-sounding');
  }
  soundingEls = [];
  for (const id of next) {
    const el = els.score.querySelector(`.note[data-id="${id}"]`);
    if (el) {
      el.classList.add('is-sounding');
      soundingEls.push(el);
    }
  }
}

function scrollPlayheadIntoView() {
  const ks = keySigCount(score.keySig);
  const x = playheadX(ui.playheadStart, ks);
  const sc = els.scroll;
  if (!sc) return;
  const margin = 48;
  if (x < sc.scrollLeft + margin) sc.scrollLeft = Math.max(0, x - margin);
  else if (x > sc.scrollLeft + sc.clientWidth - margin) {
    sc.scrollLeft = x - sc.clientWidth + margin;
  }
}

function save() {
  Prefs.save(serializeScore(score));
  scheduleUrlSync();
}

let urlSyncTimer = null;
function scheduleUrlSync() {
  if (urlSyncTimer) clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    urlSyncTimer = null;
    try {
      const hash = encodeScore(score);
      if (location.hash.slice(1) !== hash) {
        window.history.replaceState(null, '', `#${hash}`);
      }
    } catch (_) {
      /* ignore oversized hashes */
    }
  }, 400);
}

function applyLoadedScore(next, statusText) {
  history.push(snapshot(score));
  score = next;
  ui.selectedId = null;
  ui.playheadStart = 0;
  syncTempoUi(score.bpm);
  els.volume.value = String(score.volume);
  els.measures.value = String(score.measures);
  if (els.timeSig) els.timeSig.value = timeSigLabel(score.timeSig);
  if (els.keySig) els.keySig.value = String(score.keySig);
  setMasterVolume(score.volume / 100);
  save();
  redraw();
  if (statusText) setStatus(statusText);
}

function mutate(fn) {
  history.push(snapshot(score));
  fn(score);
  save();
  redraw();
}

/** In-gesture updates (e.g. dragging a note) — no undo push. */
function mutateLive(fn) {
  fn(score);
  save();
  redraw();
}

function pushHistory() {
  history.push(snapshot(score));
}

function undo() {
  const prev = history.undo(snapshot(score));
  if (!prev) return;
  score = loadScore(prev);
  ui.selectedId = null;
  save();
  redraw();
  setStatus('Undo');
}

function redo() {
  const next = history.redo(snapshot(score));
  if (!next) return;
  score = loadScore(next);
  ui.selectedId = null;
  save();
  redraw();
  setStatus('Redo');
}

ui.historyUndo = undo;
ui.historyRedo = redo;

function updatePlayButton() {
  const pressed = playback.state.playing;
  if (!els.playPause) return;
  els.playPause.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  const icon = els.playPause.querySelector('.btn-icon');
  const label = els.playPause.querySelector('.btn-label');
  if (icon) icon.textContent = pressed ? '❚❚' : '▶';
  if (label) label.textContent = pressed ? 'Pause' : 'Play';
}

function syncPaletteUi() {
  if (!els.palette) return;
  els.palette.classList.toggle('is-rest-mode', !!ui.tool.rest);
  els.palette.querySelectorAll('[data-dur]').forEach((btn) => {
    const dur = Number(btn.getAttribute('data-dur'));
    btn.setAttribute('aria-pressed', dur === ui.tool.baseDur ? 'true' : 'false');
  });
  if (els.restBtn) els.restBtn.setAttribute('aria-pressed', ui.tool.rest ? 'true' : 'false');
  if (els.dotBtn) els.dotBtn.setAttribute('aria-pressed', ui.tool.dotted ? 'true' : 'false');
  if (els.voice) els.voice.value = String(ui.tool.voice);
}

ui.onToolChange = syncPaletteUi;

function loadInitial() {
  if (location.hash && location.hash.includes('m1.')) {
    score = decodeScore(location.hash);
  } else {
    let raw = Prefs.load();
    if (!raw || !Object.keys(raw).length) {
      const v1 = PrefsV1.load();
      if (v1 && Object.keys(v1).length) raw = v1;
    }
    score = loadScore(raw && Object.keys(raw).length ? raw : null);
  }
  els.volume.value = String(score.volume);
  syncTempoUi(score.bpm);
  els.measures.value = String(score.measures);
  if (els.timeSig) els.timeSig.value = timeSigLabel(score.timeSig);
  if (els.keySig) els.keySig.value = String(score.keySig);
  setMasterVolume(score.volume / 100);
}

function syncTempoUi(bpm) {
  const v = clamp(Math.round(bpm), 40, 280);
  if (els.bpm) {
    els.bpm.value = String(v);
    els.bpm.setAttribute('aria-valuetext', `${v} BPM`);
  }
  if (els.bpmValue) els.bpmValue.textContent = String(v);
}

function bindChrome() {
  els.volume.addEventListener('input', () => {
    score.volume = clamp(Number(els.volume.value) || 0, 0, 100);
    setMasterVolume(score.volume / 100);
    save();
  });

  let tempoArmed = false;
  els.bpm?.addEventListener('pointerdown', () => {
    if (tempoArmed) return;
    tempoArmed = true;
    history.push(snapshot(score));
  });
  els.bpm?.addEventListener('input', () => {
    score.bpm = clamp(Math.round(Number(els.bpm.value) || 100), 40, 280);
    syncTempoUi(score.bpm);
    playback.setBpm(score.bpm);
    save();
  });
  const endTempoDrag = () => {
    tempoArmed = false;
  };
  els.bpm?.addEventListener('pointerup', endTempoDrag);
  els.bpm?.addEventListener('pointercancel', endTempoDrag);
  els.bpm?.addEventListener('change', endTempoDrag);
  els.bpmFace?.addEventListener('click', () => {
    els.bpm?.focus();
  });

  els.measures.addEventListener('change', () => {
    mutate((s) => setMeasures(s, Math.round(Number(els.measures.value) || 4)));
    els.measures.value = String(score.measures);
  });

  els.barsMinus?.addEventListener('click', () => {
    mutate((s) => {
      if (!removeMeasure(s, s.measures - 1)) setStatus('Need at least one bar');
      else setStatus(`Removed bar ${s.measures + 1}`);
    });
  });

  els.barsPlus?.addEventListener('click', () => {
    mutate((s) => {
      if (!insertMeasure(s, s.measures)) setStatus('Max 16 bars');
      else setStatus(`Added bar ${s.measures}`);
    });
  });

  if (els.timeSig) {
    els.timeSig.addEventListener('change', () => {
      mutate((s) => setTimeSig(s, parseTimeSig(els.timeSig.value)));
    });
  }

  if (els.keySig) {
    els.keySig.addEventListener('change', () => {
      mutate((s) => {
        s.keySig = clamp(Math.round(Number(els.keySig.value) || 0), -7, 7);
      });
    });
  }

  els.playPause.addEventListener('click', () => {
    playback.toggle(score);
    if (playback.state.playing) window.heymingAchievements?.unlockForCurrentApp('first-action');
    ui.playheadStart = playback.state.playheadStart;
    updatePlayButton();
  });

  els.stop.addEventListener('click', () => {
    playback.stop(false);
    ui.playheadStart = 0;
    redraw();
  });

  els.loop?.addEventListener('click', () => {
    const on = playback.toggleLoop();
    els.loop.setAttribute('aria-pressed', on ? 'true' : 'false');
    setStatus(on ? 'Loop on' : 'Loop off');
  });

  els.metronome?.addEventListener('click', () => {
    const on = playback.toggleMetronome();
    els.metronome.setAttribute('aria-pressed', on ? 'true' : 'false');
    setStatus(on ? 'Metronome on' : 'Metronome off');
  });

  els.clear.addEventListener('click', () => {
    playback.stop(false);
    mutate((s) => clearNotes(s));
    ui.selectedId = null;
    ui.playheadStart = 0;
    setStatus('Cleared');
  });

  if (els.undo) els.undo.addEventListener('click', undo);
  if (els.redo) els.redo.addEventListener('click', redo);

  if (els.palette) {
    els.palette.querySelectorAll('[data-dur]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const baseDur = Number(btn.getAttribute('data-dur'));
        ui.tool.baseDur = baseDur;
        // Keep rest mode — duration picks length for notes and rests
        syncPaletteUi();
        inputApi.applyDurationToSelection(baseDur, ui.tool.dotted);
      });
    });
  }

  if (els.restBtn) {
    els.restBtn.addEventListener('click', () => {
      ui.tool.rest = !ui.tool.rest;
      syncPaletteUi();
    });
  }

  if (els.dotBtn) {
    els.dotBtn.addEventListener('click', () => {
      ui.tool.dotted = !ui.tool.dotted;
      syncPaletteUi();
      inputApi.applyDurationToSelection(ui.tool.baseDur, ui.tool.dotted);
    });
  }

  if (els.voice) {
    els.voice.addEventListener('change', () => {
      ui.tool.voice = Number(els.voice.value) === 1 ? 1 : 0;
      if (ui.selectedId) {
        mutate((s) => {
          const n = findNote(s, ui.selectedId);
          if (!n) return;
          const head = chainHead(s, n);
          for (const seg of chainNotes(s, head)) {
            updateNote(s, seg.id, { voice: ui.tool.voice });
          }
          ui.selectedId = head.id;
        });
      }
    });
  }

  if (els.tieBtn) {
    els.tieBtn.addEventListener('click', () => inputApi.tieSelected());
  }

  els.dynBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      inputApi.setDynamic(btn.getAttribute('data-dynamic'));
    });
  });

  els.exportScore?.addEventListener('click', () => {
    downloadScoreJson(score, 'composer-score.json');
    setStatus('Exported');
    window.trackEvent?.('composer_export', 'Engagement', 'json');
    if (soundedNoteCount(score) >= EXPORT_ACHIEVEMENT_MIN_NOTES) {
      window.heymingAchievements?.unlockForCurrentApp('score-exported');
    }
  });
  els.importScore?.addEventListener('click', () => els.importFile?.click());
  els.importFile?.addEventListener('change', async () => {
    const file = els.importFile?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      applyLoadedScore(decodeScore(text), `Imported “${file.name}”`);
      window.trackEvent?.('composer_import', 'Engagement', 'json');
    } catch (err) {
      console.warn(err);
      setStatus('Import failed');
    } finally {
      if (els.importFile) els.importFile.value = '';
    }
  });
  els.copyLink?.addEventListener('click', async () => {
    const hash = encodeScore(score);
    window.history.replaceState(null, '', `#${hash}`);
    const url = scoreUrlFromHash(hash);
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  });
  els.sharePost?.addEventListener('click', async () => {
    const hash = encodeScore(score);
    window.history.replaceState(null, '', `#${hash}`);
    const url = scoreUrlFromHash(hash);
    try {
      const { share } = await import('/posts/share-client.js');
      await share({
        text: `Composer score (${score.notes.length} notes @ ${score.bpm} BPM)\n${url}`,
        url
      });
      window.trackEvent?.('composer_share_post', 'Engagement', 'posts');
    } catch (err) {
      console.warn(err);
      setStatus('Share failed');
    }
  });

  els.examples?.addEventListener('change', () => {
    const id = els.examples?.value;
    if (id) loadExampleById(id);
  });

  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('m1.')) return;
    applyLoadedScore(decodeScore(location.hash), 'Loaded from link');
  });

  window.addEventListener('resize', () => redraw());

  const moreDetails = document.querySelector('.control-more');
  if (moreDetails instanceof HTMLDetailsElement) {
    const closeMore = () => {
      moreDetails.open = false;
    };
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!moreDetails.open) return;
        if (moreDetails.contains(/** @type {Node} */ (e.target))) return;
        closeMore();
      },
      true
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && moreDetails.open) closeMore();
    });
    moreDetails.querySelector('.more-panel')?.addEventListener('click', (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      // Close after a menu action; leave <select> open until change
      if (t.closest('button')) closeMore();
    });
    els.examples?.addEventListener('change', closeMore);
  }
}

const EXAMPLES_BASE = new URL('examples/', import.meta.url);

async function loadExamplesCatalog() {
  if (!els.examples) return;
  try {
    const res = await fetch(new URL('index.json', EXAMPLES_BASE));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data?.examples) ? data.examples : [];
    for (const ex of list) {
      if (!ex?.id || !ex?.title) continue;
      const opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = ex.title;
      opt.title = ex.blurb || '';
      opt.dataset.file = ex.file || `${ex.id}.json`;
      els.examples.append(opt);
    }
  } catch (err) {
    console.warn('Composer examples catalog failed', err);
  }
}

async function loadExampleById(id) {
  if (!els.examples || !id) return;
  const opt = [...els.examples.options].find((o) => o.value === id);
  if (!opt) return;
  const file = opt.dataset.file || `${id}.json`;
  const url = new URL(file, EXAMPLES_BASE).href;
  setStatus('Loading example…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applyLoadedScore(decodeScore(data), `Loaded “${opt.textContent}”`);
    window.trackEvent?.('composer_load_example', 'Engagement', id);
  } catch (err) {
    console.warn(err);
    setStatus('Could not load example');
  } finally {
    els.examples.value = '';
  }
}

const inputApi = bindInput({
  svg: els.score,
  getScore,
  getUi,
  setUi,
  mutate,
  mutateLive,
  pushHistory,
  playback,
  redraw,
  setStatus
});

async function init() {
  loadInitial();
  bindChrome();
  syncPaletteUi();
  redraw();
  loadExamplesCatalog();
  setStatus('Loading piano…');
  await playback.initPiano();
  if (!playback.state.playing) setStatus('Ready');
}

init();

void KEY_NAMES;
void TIME_SIGS;
