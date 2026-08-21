/**
 * Chiptune tracker — boot, UI wiring, URL sync, Posts share.
 */

import { setMasterVolume } from '../shared/audio.js';
import {
  WAVEFORMS,
  CHANNEL_COUNT,
  MIN_BARS,
  MAX_BARS,
  createSong,
  activePattern,
  addPattern,
  appendArrangement,
  barsOf,
  setBars,
  addBar,
  removeBar
} from './model.js';
import { encodeSong, decodeSong, songUrlFromHash, downloadSongJson } from './encode.js';
import { ChipTransport } from './synth.js';
import { PitchGrid } from './grid.js';
import { createHistory } from './history.js';

/** @type {import('./model.js').Song} */
let song = decodeSong(window.location.hash);
let urlTimer = 0;
const editHistory = createHistory(100);

const els = {
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('grid')),
  play: document.getElementById('play-btn'),
  stop: document.getElementById('stop-btn'),
  bpm: /** @type {HTMLInputElement|null} */ (document.getElementById('bpm')),
  bpmValue: document.getElementById('bpm-value'),
  measures: /** @type {HTMLInputElement|null} */ (document.getElementById('measures')),
  barsMinus: document.getElementById('bars-minus'),
  barsPlus: document.getElementById('bars-plus'),
  volume: /** @type {HTMLInputElement|null} */ (document.getElementById('volume')),
  status: document.getElementById('now-playing'),
  channels: document.getElementById('channel-list'),
  patterns: document.getElementById('pattern-tabs'),
  arrange: document.getElementById('arrangement'),
  addPattern: document.getElementById('add-pattern'),
  addArrange: document.getElementById('add-arrange'),
  clearArrange: document.getElementById('clear-arrange'),
  undo: /** @type {HTMLButtonElement|null} */ (document.getElementById('undo')),
  redo: /** @type {HTMLButtonElement|null} */ (document.getElementById('redo')),
  examples: /** @type {HTMLSelectElement|null} */ (document.getElementById('examples')),
  newSong: document.getElementById('new-song'),
  exportSong: document.getElementById('export-song'),
  importSong: document.getElementById('import-song'),
  importFile: /** @type {HTMLInputElement|null} */ (document.getElementById('import-file')),
  copyLink: document.getElementById('copy-link'),
  sharePost: document.getElementById('share-post'),
  wave: /** @type {HTMLSelectElement|null} */ (document.getElementById('wave')),
  chVolume: /** @type {HTMLInputElement|null} */ (document.getElementById('ch-volume')),
  attack: /** @type {HTMLInputElement|null} */ (document.getElementById('attack')),
  release: /** @type {HTMLInputElement|null} */ (document.getElementById('release')),
  mute: /** @type {HTMLButtonElement|null} */ (document.getElementById('mute-btn')),
  solo: /** @type {HTMLButtonElement|null} */ (document.getElementById('solo-btn'))
};

const transport = new ChipTransport({
  getSong: () => song,
  onStep: (step, arrIndex) => {
    grid.setPlayhead(step);
    highlightArrangement(arrIndex);
    if (els.status) {
      const pat = song.patterns[song.arrangement[arrIndex] ?? song.activePattern];
      els.status.textContent = `Playing ${pat?.name || '?'} · step ${step + 1}/${song.steps}`;
    }
  },
  onStop: () => {
    grid.clearPlayhead();
    highlightArrangement(-1);
    updatePlayButton();
    if (els.status) els.status.textContent = 'Ready';
  }
});

const grid = new PitchGrid({
  canvas: els.canvas,
  getSong: () => song,
  onBeforeEdit: () => pushHistory(),
  onChange: () => {
    afterEdit();
  },
  onPreview: (midi) => {
    const ch = song.channels[song.activeChannel];
    if (ch) transport.preview(ch, midi);
  }
});

function snapshot() {
  return structuredClone(song);
}

function pushHistory() {
  editHistory.push(snapshot());
  syncHistoryButtons();
}

function afterEdit() {
  scheduleUrlSync();
  renderSidePanels();
  syncHistoryButtons();
}

function restoreSong(next, statusText = 'Ready') {
  if (!next) return;
  song = next;
  grid.resize();
  renderSidePanels();
  scheduleUrlSync();
  syncHistoryButtons();
  updatePlayButton();
  if (els.status) els.status.textContent = statusText;
}

/**
 * Replace the current song (pushes undo). Stops playback.
 * @param {import('./model.js').Song} next
 * @param {string} [statusText]
 */
function loadSong(next, statusText = 'Song loaded') {
  transport.stop();
  pushHistory();
  restoreSong(next, statusText);
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
      if (ex.url) opt.dataset.url = ex.url;
      els.examples.append(opt);
    }
  } catch (err) {
    console.warn('Chiptune examples catalog failed', err);
  }
}

async function loadExampleById(id) {
  if (!els.examples || !id) return;
  const opt = [...els.examples.options].find((o) => o.value === id);
  if (!opt) return;
  const remote = opt.dataset.url;
  const file = opt.dataset.file || `${id}.json`;
  const url = remote || new URL(file, EXAMPLES_BASE).href;
  if (els.status) els.status.textContent = 'Loading example…';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    loadSong(decodeSong(data), `Loaded “${opt.textContent}”`);
    window.trackEvent?.('chiptune_load_example', 'Engagement', id);
  } catch (err) {
    console.warn(err);
    if (els.status) els.status.textContent = 'Could not load example';
  } finally {
    els.examples.value = '';
  }
}

function undo() {
  const prev = editHistory.undo(snapshot());
  restoreSong(prev);
}

function redo() {
  const next = editHistory.redo(snapshot());
  restoreSong(next);
}

function syncHistoryButtons() {
  if (els.undo) els.undo.disabled = !editHistory.canUndo();
  if (els.redo) els.redo.disabled = !editHistory.canRedo();
}

/** Discrete song mutation with one undo step. */
function mutate(fn) {
  pushHistory();
  fn(song);
  afterEdit();
  grid.draw();
}

function scheduleUrlSync() {
  if (urlTimer) clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const hash = encodeSong(song);
    window.history.replaceState(null, '', `#${hash}`);
  }, 250);
}

function updatePlayButton() {
  if (!els.play) return;
  const playing = transport.playing;
  els.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
  const label = els.play.querySelector('.btn-label');
  const icon = els.play.querySelector('.btn-icon');
  if (label) label.textContent = playing ? 'Stop' : 'Play';
  if (icon) icon.textContent = playing ? '■' : '▶';
}

function renderChannels() {
  if (!els.channels) return;
  els.channels.replaceChildren();
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const ch = song.channels[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'channel-btn' + (i === song.activeChannel ? ' is-active' : '');
    btn.innerHTML = `<span class="ch-idx">${i + 1}</span><span class="ch-wave">${ch.wave}</span>`;
    if (ch.mute) btn.classList.add('is-mute');
    if (ch.solo) btn.classList.add('is-solo');
    btn.addEventListener('click', () => {
      song.activeChannel = i;
      syncChannelControls();
      renderSidePanels();
      grid.draw();
      scheduleUrlSync();
    });
    els.channels.append(btn);
  }
}

function renderPatterns() {
  if (!els.patterns) return;
  els.patterns.replaceChildren();
  song.patterns.forEach((pat, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pattern-tab' + (i === song.activePattern ? ' is-active' : '');
    btn.textContent = pat.name;
    btn.addEventListener('click', () => {
      song.activePattern = i;
      renderSidePanels();
      grid.draw();
      scheduleUrlSync();
    });
    els.patterns.append(btn);
  });
}

function highlightArrangement(arrIndex) {
  if (!els.arrange) return;
  [...els.arrange.children].forEach((el, i) => {
    el.classList.toggle('is-playing', i === arrIndex);
  });
}

function renderArrangement() {
  if (!els.arrange) return;
  els.arrange.replaceChildren();
  song.arrangement.forEach((patIdx, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'arrange-chip';
    chip.textContent = song.patterns[patIdx]?.name || '?';
    chip.title = 'Remove from arrangement';
    chip.addEventListener('click', () => {
      mutate((s) => {
        s.arrangement.splice(i, 1);
        if (!s.arrangement.length) s.arrangement = [s.activePattern];
      });
    });
    els.arrange.append(chip);
  });
}

function renderSidePanels() {
  renderChannels();
  renderPatterns();
  renderArrangement();
  syncChannelControls();
}

function syncChannelControls() {
  const ch = song.channels[song.activeChannel];
  if (!ch) return;
  if (els.wave) els.wave.value = ch.wave;
  if (els.chVolume) els.chVolume.value = String(Math.round(ch.volume * 100));
  if (els.attack) els.attack.value = String(Math.round(ch.attack * 1000));
  if (els.release) els.release.value = String(Math.round(ch.release * 1000));
  if (els.mute) {
    els.mute.setAttribute('aria-pressed', ch.mute ? 'true' : 'false');
    els.mute.textContent = ch.mute ? 'Muted' : 'Mute';
  }
  if (els.solo) {
    els.solo.setAttribute('aria-pressed', ch.solo ? 'true' : 'false');
    els.solo.textContent = ch.solo ? 'Solo on' : 'Solo';
  }
  if (els.bpm) els.bpm.value = String(song.tempo);
  if (els.bpmValue) els.bpmValue.textContent = String(song.tempo);
  if (els.bpm) els.bpm.setAttribute('aria-valuetext', `${song.tempo} BPM`);
  if (els.measures) els.measures.value = String(barsOf(song));
}

function fillWaveSelect() {
  if (!els.wave) return;
  els.wave.replaceChildren();
  for (const w of WAVEFORMS) {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.label;
    els.wave.append(opt);
  }
}

function bind() {
  els.play?.addEventListener('click', () => {
    transport.toggle();
    if (transport.playing) window.heymingAchievements?.unlockForCurrentApp('first-action');
    updatePlayButton();
    if (transport.playing && els.status) els.status.textContent = 'Playing…';
  });
  els.stop?.addEventListener('click', () => {
    transport.stop();
    updatePlayButton();
  });
  els.undo?.addEventListener('click', undo);
  els.redo?.addEventListener('click', redo);

  const syncTempoUi = () => {
    if (els.bpm) {
      els.bpm.value = String(song.tempo);
      els.bpm.setAttribute('aria-valuetext', `${song.tempo} BPM`);
    }
    if (els.bpmValue) els.bpmValue.textContent = String(song.tempo);
  };
  let tempoArmed = false;
  els.bpm?.addEventListener('pointerdown', () => {
    if (tempoArmed) return;
    tempoArmed = true;
    pushHistory();
  });
  els.bpm?.addEventListener('input', () => {
    song.tempo = Math.min(280, Math.max(40, Number(els.bpm?.value) || 120));
    syncTempoUi();
    scheduleUrlSync();
  });
  const endTempoDrag = () => {
    tempoArmed = false;
    syncHistoryButtons();
  };
  els.bpm?.addEventListener('pointerup', endTempoDrag);
  els.bpm?.addEventListener('pointercancel', endTempoDrag);
  els.bpm?.addEventListener('change', endTempoDrag);
  document.getElementById('bpm-face')?.addEventListener('click', () => {
    els.bpm?.focus();
  });

  els.measures?.addEventListener('change', () => {
    mutate((s) => {
      setBars(s, Math.round(Number(els.measures?.value) || barsOf(s)));
    });
    if (els.measures) els.measures.value = String(barsOf(song));
    grid.resize();
  });
  els.barsMinus?.addEventListener('click', () => {
    if (barsOf(song) <= MIN_BARS) return;
    mutate((s) => removeBar(s));
    grid.resize();
  });
  els.barsPlus?.addEventListener('click', () => {
    if (barsOf(song) >= MAX_BARS) return;
    mutate((s) => addBar(s));
    grid.resize();
  });
  els.volume?.addEventListener('input', () => {
    const v = (Number(els.volume?.value) || 70) / 100;
    setMasterVolume(v);
    transport.setVolume(v);
  });
  els.wave?.addEventListener('change', () => {
    mutate((s) => {
      s.channels[s.activeChannel].wave = els.wave?.value || 'square';
    });
  });

  /** @param {HTMLInputElement|null} el @param {(s: import('./model.js').Song, v: number) => void} apply */
  const bindParamSlider = (el, apply) => {
    if (!el) return;
    let armed = false;
    el.addEventListener('pointerdown', () => {
      if (armed) return;
      armed = true;
      pushHistory();
    });
    el.addEventListener('input', () => {
      apply(song, Number(el.value));
      scheduleUrlSync();
    });
    const release = () => {
      armed = false;
      syncHistoryButtons();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('change', release);
  };
  bindParamSlider(els.chVolume, (s, v) => {
    s.channels[s.activeChannel].volume = (v || 65) / 100;
  });
  bindParamSlider(els.attack, (s, v) => {
    s.channels[s.activeChannel].attack = (v || 10) / 1000;
  });
  bindParamSlider(els.release, (s, v) => {
    s.channels[s.activeChannel].release = (v || 60) / 1000;
  });

  els.mute?.addEventListener('click', () => {
    mutate((s) => {
      s.channels[s.activeChannel].mute = !s.channels[s.activeChannel].mute;
    });
  });
  els.solo?.addEventListener('click', () => {
    mutate((s) => {
      s.channels[s.activeChannel].solo = !s.channels[s.activeChannel].solo;
    });
  });
  els.addPattern?.addEventListener('click', () => {
    mutate((s) => addPattern(s));
  });
  els.addArrange?.addEventListener('click', () => {
    mutate((s) => appendArrangement(s, s.activePattern));
  });
  els.clearArrange?.addEventListener('click', () => {
    mutate((s) => {
      s.arrangement = [s.activePattern];
    });
  });
  els.newSong?.addEventListener('click', () => {
    if (!window.confirm('Start a new blank song?')) return;
    transport.stop();
    pushHistory();
    song = createSong();
    window.history.replaceState(null, '', window.location.pathname);
    bootUi();
  });
  els.examples?.addEventListener('change', () => {
    const id = els.examples?.value;
    if (id) loadExampleById(id);
  });
  els.exportSong?.addEventListener('click', () => {
    downloadSongJson(song, 'chiptune-song.json');
    if (els.status) els.status.textContent = 'Exported JSON';
    window.trackEvent?.('chiptune_export', 'Engagement', 'json');
  });
  els.importSong?.addEventListener('click', () => els.importFile?.click());
  els.importFile?.addEventListener('change', async () => {
    const file = els.importFile?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      loadSong(decodeSong(text), `Imported “${file.name}”`);
      window.trackEvent?.('chiptune_import', 'Engagement', 'json');
    } catch (err) {
      console.warn(err);
      if (els.status) els.status.textContent = 'Import failed';
    } finally {
      if (els.importFile) els.importFile.value = '';
    }
  });
  els.copyLink?.addEventListener('click', async () => {
    const hash = encodeSong(song);
    window.history.replaceState(null, '', `#${hash}`);
    const url = songUrlFromHash(hash);
    try {
      await navigator.clipboard.writeText(url);
      if (els.status) els.status.textContent = 'Link copied';
    } catch {
      window.prompt('Copy this link:', url);
    }
  });
  els.sharePost?.addEventListener('click', async () => {
    const hash = encodeSong(song);
    window.history.replaceState(null, '', `#${hash}`);
    const url = songUrlFromHash(hash);
    const pat = activePattern(song);
    const noteCount = pat.tracks.reduce((n, t) => n + t.length, 0);
    try {
      const { share } = await import('/posts/share-client.js');
      await share({
        text: `Chiptune jam (${noteCount} notes @ ${song.tempo} BPM)\n${url}`,
        email: ''
      });
      window.trackEvent?.('chiptune_share_post', 'Engagement', 'posts');
    } catch (err) {
      console.warn(err);
      if (els.status) els.status.textContent = 'Could not open Posts';
    }
  });

  window.addEventListener('hashchange', () => {
    if (transport.playing) return;
    song = decodeSong(window.location.hash);
    editHistory.clear();
    bootUi();
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && /** @type {HTMLElement} */ (e.target).tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (/** @type {HTMLElement} */ (e.target)?.isContentEditable) return;
    const meta = e.metaKey || e.ctrlKey;

    if (e.code === 'Space') {
      e.preventDefault();
      transport.toggle();
      updatePlayButton();
      if (transport.playing && els.status) els.status.textContent = 'Playing…';
      return;
    }

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });
}

function bootUi() {
  fillWaveSelect();
  if (els.volume) setMasterVolume((Number(els.volume.value) || 70) / 100);
  renderSidePanels();
  grid.resize();
  updatePlayButton();
  syncHistoryButtons();
  if (els.status) els.status.textContent = 'Ready — paint notes on the grid';
}

bind();
bootUi();
loadExamplesCatalog();
