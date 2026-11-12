// Chart-first entry for a zenius= link. This module does not import the
// play engine, so the difficulty dialog can open while that graph loads.

import { LoadingOverlay } from './loading-overlay.js';
import { extractSimfileId, fetchZeniusSimfile, parseZeniusSimfile } from './songLoader.js';
import { clearURLParams, getURLParams, updateURLParams } from './urlUtils.js';
import { hideHomeScreen, showHomeScreen } from './homeScreen.js';

/**
 * @typedef {Object} PrimedZeniusChart
 * @property {boolean} cancelled
 * @property {string} [zeniusUrl]
 * @property {string} [simfileId]
 * @property {string} [songKey]
 * @property {Object} [songData]
 * @property {Object} [parsedData]
 * @property {Object} [simfileData]
 */

/** @type {number} */
let generation = 0;
/** @type {string} */
let primedUrl = '';
/** @type {number} */
let primedGeneration = -1;
/** @type {Promise<PrimedZeniusChart> | null} */
let primed = null;

export function abandonZeniusChart() {
  generation += 1;
}

export function zeniusChartWasAbandoned() {
  return primedGeneration !== generation;
}

/**
 * Fetch and show the chart choices once per URL. Later calls share the
 * promise unless the player already left.
 * @param {string} [zeniusUrl]
 * @param {string | number | null} [difficulty]
 * @returns {Promise<PrimedZeniusChart> | null}
 */
export function primeZeniusChart(zeniusUrl, difficulty) {
  const url = zeniusUrl || getURLParams().zenius;
  if (!url) return null;
  if (primed && primedUrl === url && primedGeneration === generation) return primed;
  primedUrl = url;
  primedGeneration = generation;
  const gen = generation;
  primed = loadZeniusChart(url, difficulty, gen);
  return primed;
}

/**
 * @param {string} zeniusUrl
 * @param {string | number | null | undefined} difficulty
 * @param {number} gen
 * @returns {Promise<PrimedZeniusChart>}
 */
async function loadZeniusChart(zeniusUrl, difficulty, gen) {
  const simfileId = extractSimfileId(zeniusUrl);
  if (!simfileId) {
    window.dispatchEvent(new Event('sm-chart-ready'));
    throw new Error('Could not extract simfile ID from song URL');
  }

  try {
    const simfileDataPromise = fetchZeniusSimfile(simfileId, undefined, takeHeadStart(simfileId));
    await whenLoadingOverlay();
    if (gen !== generation) return { cancelled: true };

    hideHomeScreen();
    LoadingOverlay.showLoading('Song', 'Getting the chart');
    LoadingOverlay.setCancelHandler(() => leave(gen));

    const simfileData = await simfileDataPromise;
    if (gen !== generation) return { cancelled: true };

    const { songKey, songData, parsedData } = parseZeniusSimfile(simfileData, simfileId);
    if (gen !== generation) return { cancelled: true };

    const parsedIndex = Number(difficulty);
    const initial = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
    LoadingOverlay.showReadyToPlay({
      songTitle: parsedData.title || simfileData.title || 'Song',
      artist: parsedData.artist || simfileData.artist || '',
      charts: parsedData.charts,
      currentDifficulty: initial,
      audioReady: false,
      onPlay: () => {},
      onBrowse: () => leave(gen),
      onBack: () => leave(gen),
      onDifficultyChange: (index) => {
        updateURLParams({ difficulty: index }, false);
      }
    });

    return {
      cancelled: false,
      zeniusUrl,
      simfileId,
      songKey,
      songData,
      parsedData,
      simfileData
    };
  } finally {
    window.dispatchEvent(new Event('sm-chart-ready'));
  }
}

/**
 * The download index.html started for this simfile before any module
 * parsed, taken once so a second prime fetches fresh.
 * @param {string} simfileId
 * @returns {Promise<import('./songLoader.js').ZeniusHeadStart> | null}
 */
function takeHeadStart(simfileId) {
  const slot = window.__zeniusPagePrefetch;
  if (!slot || String(slot.id) !== String(simfileId) || !slot.promise) return null;
  window.__zeniusPagePrefetch = undefined;
  return slot.promise;
}

function whenLoadingOverlay() {
  if (document.getElementById('loading-overlay')) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (!document.getElementById('loading-overlay')) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * @param {number} gen
 */
function leave(gen) {
  if (gen !== generation) return;
  abandonZeniusChart();
  LoadingOverlay.hide();
  clearURLParams();
  showHomeScreen();
}
