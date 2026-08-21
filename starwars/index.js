'use strict';

// ── Player ────────────────────────────────────────────────────────────────
// Film data is loaded from sw-data.js as `var film = [...]`
// Format: every 14 elements = one frame.
//   film[i*14]       = display-duration in 67ms ticks
//   film[i*14+1..13] = 13 lines of ASCII art
//
// Original player logic adapted from asciimation.co.nz
// © 1997-2026 Simon Jansen — used with attribution for fan/educational purposes.

const LINES_PER_FRAME = 14;
const BASE_DELAY_MS = 67; // milliseconds per tick at 1× speed

const screenEl = document.getElementById('screen');
const frameCounterEl = document.getElementById('frame-counter');
const progressBarEl = document.getElementById('progress-bar');
const btnPlayPause = document.getElementById('btn-playpause');
const speedRange = document.getElementById('speed-range');
const speedLabel = document.getElementById('speed-label');

// Speed map: slider value → multiplier
const SPEED_MAP = [0.25, 0.5, 0.75, 1, 2, 4, 8, 16];

let totalFrames = 0;
let currentFrame = 0;
let isPlaying = false;
let timerHandle = null;
let speedMultiplier = 1;

function init() {
  if (!window.film || film.length < LINES_PER_FRAME) {
    screenEl.textContent = 'Error: film data not loaded.';
    return;
  }
  totalFrames = Math.floor(film.length / LINES_PER_FRAME);
  currentFrame = 0;
  renderFrame(0);
  startPlay();
}

function renderFrame(n) {
  if (n < 0 || n >= totalFrames) return;
  const base = n * LINES_PER_FRAME;
  const lines = [];
  for (let i = 1; i < LINES_PER_FRAME; i++) {
    lines.push(film[base + i] || '');
  }
  screenEl.textContent = lines.join('\n');
  frameCounterEl.textContent = `Frame ${n + 1} / ${totalFrames}`;
  const pct = totalFrames > 1 ? ((n / (totalFrames - 1)) * 100).toFixed(2) : 0;
  progressBarEl.style.width = pct + '%';
  currentFrame = n;
}

function getFrameDelay(n) {
  const raw = parseInt(film[n * LINES_PER_FRAME], 10) || 1;
  return Math.max(1, Math.round((raw * BASE_DELAY_MS) / speedMultiplier));
}

function scheduleNext() {
  const delay = getFrameDelay(currentFrame);
  timerHandle = setTimeout(() => {
    if (!isPlaying) return;
    const next = currentFrame + 1;
    if (next >= totalFrames) {
      // Loop back to start
      renderFrame(0);
    } else {
      renderFrame(next);
    }
    scheduleNext();
  }, delay);
}

function startPlay() {
  if (isPlaying) return;
  isPlaying = true;
  btnPlayPause.textContent = '⏸ Pause';
  btnPlayPause.classList.add('active');
  scheduleNext();
}

function pausePlay() {
  isPlaying = false;
  btnPlayPause.textContent = '▶ Play';
  btnPlayPause.classList.remove('active');
  clearTimeout(timerHandle);
}

function togglePlayPause() {
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  if (isPlaying) {
    pausePlay();
  } else {
    startPlay();
  }
}

function restart() {
  pausePlay();
  renderFrame(0);
  startPlay();
}

function stepFrame(delta) {
  const wasPlaying = isPlaying;
  pausePlay();
  const next = Math.max(0, Math.min(totalFrames - 1, currentFrame + delta));
  renderFrame(next);
  if (wasPlaying) startPlay();
}

function jumpToEnd() {
  pausePlay();
  renderFrame(totalFrames - 1);
}

// ── Controls ──────────────────────────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', restart);
document.getElementById('btn-prev').addEventListener('click', () => stepFrame(-1));
btnPlayPause.addEventListener('click', togglePlayPause);
document.getElementById('btn-next').addEventListener('click', () => stepFrame(1));
document.getElementById('btn-end').addEventListener('click', jumpToEnd);

speedRange.addEventListener('input', () => {
  const idx = parseInt(speedRange.value, 10) - 1;
  speedMultiplier = SPEED_MAP[idx];
  const label = speedMultiplier < 1 ? `${speedMultiplier}×` : `${speedMultiplier}×`;
  speedLabel.textContent = label;
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      stepFrame(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      stepFrame(1);
      break;
    case 'Home':
      e.preventDefault();
      restart();
      break;
    case 'End':
      e.preventDefault();
      jumpToEnd();
      break;
  }
});

// Progress bar seek
document.getElementById('progress-bar-container').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const target = Math.floor(ratio * (totalFrames - 1));
  const wasPlaying = isPlaying;
  pausePlay();
  renderFrame(Math.max(0, Math.min(totalFrames - 1, target)));
  if (wasPlaying) startPlay();
});

// ── Boot ─────────────────────────────────────────────────────────────────
// Wait for sw-data.js to be available (it's in <head> so sync)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
