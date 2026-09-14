// Minimal imperative wrapper around the StepMania renderer.
//
// This deliberately owns no song browser, loading overlay, settings, score
// chrome, URL state, or mobile controls. Hosts provide an already-loaded pack
// and decide how entering/leaving gameplay should look.

import gameState from './gameState.js';
import { songManager } from './songManager.js';
import { audioManager } from './audioManager.js';
import { inputManager } from './inputManager.js';
import { CanvasManager } from './canvasManager.js';
import {
  buildTimingData,
  filterUnjudgableNotes,
  getBeatFromElapsedTime,
  getElapsedTimeFromBeat
} from './timingData.js';
import { playTimingForChart, revokePackObjectUrls, songFromPack } from './songFromPack.js';
import { resetGame, setGameplayActive, startStepmania } from './stepmania.js';

let initialized = false;
let onReturn = null;
let positionRaf = 0;
let surfaceActive = false;
let loadedPack = null;

function startPositionUpdates(timing, musicOffset, onPosition) {
  cancelAnimationFrame(positionRaf);
  function tick() {
    if (!surfaceActive) return;
    const audioSecond = audioManager.currentTime;
    const beat = Math.max(0, getBeatFromElapsedTime(timing, audioSecond + musicOffset).beat);
    onPosition?.({ beat, audioSecond });
    positionRaf = requestAnimationFrame(tick);
  }
  positionRaf = requestAnimationFrame(tick);
}

/**
 * Initialize the shared renderer against host-provided DOM.
 * @param {() => void} returnHandler
 */
function ensureInitialized(returnHandler) {
  onReturn = returnHandler;
  if (initialized) return;
  startStepmania({
    containerId: 'editor-gameplay-surface',
    audioElement: document.getElementById('editor-gameplay-audio'),
    video: {
      videoElement: document.getElementById('editor-gameplay-video'),
      gameArea: document.getElementById('editor-gameplay-surface'),
      statusElement: document.getElementById('editor-video-status'),
      statusTextElement: document.getElementById('editor-video-status-text')
    },
    embedded: true,
    active: false,
    onEnded: () => onReturn?.()
  });
  initialized = true;
}

/**
 * Play one chart without booting the full StepMania application shell.
 * @param {Object} options
 * @param {import('./packIo.js').SongPack} options.pack
 * @param {number} options.chartIndex
 * @param {number} options.startBeat
 * @param {() => void} options.onReturn
 * @param {(position: {beat: number, audioSecond: number}) => void} [options.onPosition]
 */
export async function playPackInSurface({
  pack,
  chartIndex,
  startBeat,
  onReturn: returnHandler,
  onPosition
}) {
  ensureInitialized(returnHandler);
  onReturn = returnHandler;
  if (loadedPack !== pack) {
    revokePackObjectUrls();
    loadedPack = pack;
  }

  const key = `editor_${Date.now()}`;
  const { songData, parsedData } = songFromPack(pack, key);
  const chart = parsedData.charts[chartIndex] || parsedData.charts[0];
  if (!chart) throw new Error('This song has no dance-single chart to play.');
  if (!songData.audioBlob && !songData.url) {
    throw new Error('Add a music file before playing the chart.');
  }

  songManager.cacheParsedData(key, parsedData);
  songManager.setCurrentSong(key, songData);
  songManager.setCurrentDifficulty(chartIndex);

  const playTiming = playTimingForChart(parsedData, chart);
  const timing = playTiming.timing || buildTimingData({});
  const offset = Number.isFinite(playTiming.offset) ? playTiming.offset : 0;
  const musicOffset = offset + timing.beat0OffsetDelta;
  const allNotes = filterUnjudgableNotes(timing, structuredClone(chart.noteData || []));
  const noteData =
    startBeat > 0 ? allNotes.filter((note) => note[0] >= startBeat - 1e-6) : allNotes;

  gameState.setAutoplay(false);
  gameState.setSong({
    bpm: parsedData.bpm,
    addToMusicPosition: musicOffset,
    bpmChanges: playTiming.bpmChanges || parsedData.bpmChanges || [],
    timing
  });
  gameState.setSteps({ noteData });
  gameState.setNoteData(noteData);
  gameState.setBgChanges(songManager.prepareBgChanges(parsedData.bgChanges || []));

  const surface = document.getElementById('editor-gameplay-surface');
  const overlay = 'linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35))';
  surface.style.backgroundImage = songData.background
    ? `${overlay}, url(${songData.background})`
    : overlay;

  if (songData.audioBlob) {
    await audioManager.loadBlob(
      songData.audioBlob,
      songData.audioType || songData.audioBlob.type || 'audio/mpeg'
    );
  } else {
    await audioManager.loadUrl(songData.url, songData.audioType || 'audio/mpeg');
  }

  resetGame();
  CanvasManager.resize('editor-gameplay-surface');
  const audioSecond = Math.max(
    0,
    getElapsedTimeFromBeat(timing, Math.max(0, startBeat)) - musicOffset
  );
  audioManager.seek(audioSecond);
  inputManager.enable();
  setGameplayActive(true);
  surfaceActive = true;
  startPositionUpdates(timing, musicOffset, onPosition);
  await audioManager.play();
}

/** Stop playback and leave the reusable renderer dormant. */
export function stopPackInSurface() {
  surfaceActive = false;
  cancelAnimationFrame(positionRaf);
  positionRaf = 0;
  setGameplayActive(false);
  inputManager.disable();
  resetGame();
}
