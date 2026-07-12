/**
 * Offline-save controller for the watch view.
 *
 * Owns: the Save-offline button's three-mode state machine
 * (idle / downloading / saved), the in-memory `savedKeys` mirror of
 * the IDB store, the live download `AbortController`, and the
 * `<video>` blob-URL swap for cached playback.
 *
 * The orchestrator (watch-view.js `mount()`) sets the network
 * `video.src` itself and then hands the controller the new episode
 * via `setEpisode(ep, { autoplay })`. If the episode is cached,
 * the controller asynchronously swaps `video.src` to a Blob URL.
 *
 * Why a controller and not free functions on `mount()`:
 * the trickiest UI state in the view is "click while downloading
 * cancels the AbortController, click while saved deletes the cache
 * and falls back to the network URL atomically, click while idle
 * starts a streamed fetch with progress." Bundling that state
 * machine into one object keeps the orchestrator from knowing
 * about IDB, abort signals, or blob URL hygiene.
 */

import {
  getSaved as getOfflineSaved,
  saveEpisode as saveOfflineEpisode,
  deleteSavedEpisode as deleteOfflineEpisode,
  ensurePersistent as ensureOfflinePersistent,
  listSaved as listOfflineSaved,
  makeKey as offlineKey
} from '../offline.js';
import { mediaLabel, trackWatch, trackWatchConversion } from '../track.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../movies.js').MovieConfig} MovieConfig */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} OfflineSaveControllerDeps
 * @property {HTMLVideoElement} video Target for the blob-URL swap.
 * @property {ShowConfig | MovieConfig} show
 *   Read: `id`, plus the fields the underlying `saveEpisode()` call
 *   stamps onto the IDB record (`name`, `emoji`, `accent`). Both
 *   ShowConfig and MovieConfig carry all of those.
 * @property {HTMLButtonElement} saveBtn Three-mode toggle button.
 * @property {(msg: string) => void} flash Marquee toast helper.
 */

/**
 * @param {OfflineSaveControllerDeps} deps
 * @returns {{
 *   hydrate: () => Promise<void>,
 *   setEpisode: (ep: Episode | null, opts?: { autoplay?: boolean }) => void,
 *   dispose: () => void,
 *   isSavedSync: (ep: Episode) => boolean,
 * }}
 */
export function createOfflineSaveController(deps) {
  const { video, show, saveBtn, flash } = deps;

  /** @type {Episode | null} */
  let current = null;
  /** @type {Set<string>} */
  const savedKeys = new Set();
  /** @type {string | null} */
  let savedBlobUrl = null;
  /** @type {AbortController | null} */
  let saveAbort = null;

  /**
   * Swap `<video>` src to a Blob URL backed by the cached MP4 in IDB.
   * Idempotent and race-safe: by the time the IDB read resolves the
   * user may have stepped to a different episode, in which case we
   * bail without touching `<video>` or leaking the URL.
   *
   * @param {Episode} ep
   * @param {{ autoplay?: boolean }} [opts]
   */
  async function applyOfflineSrc(ep, opts = {}) {
    const autoplay = opts.autoplay === true;
    const saved = await getOfflineSaved(show.id, ep.season, ep.episode);
    if (current !== ep) return;
    if (!saved?.blob) return;
    const url = URL.createObjectURL(saved.blob);
    savedBlobUrl = url;
    video.src = url;
    video.load();
    if (autoplay) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /**
   * Repaint the Save-offline button. Three states encoded on classes
   * + textContent (single button slot rather than three separate
   * widgets — users expect one stable spot in the controls row that
   * toggles between save and remove).
   *
   * @param {Episode | null} ep
   */
  function refreshSaveButton(ep) {
    if (saveAbort) return;
    if (!ep) {
      saveBtn.disabled = true;
      saveBtn.textContent = '💾 Save offline';
      return;
    }
    const isCached = savedKeys.has(offlineKey(show.id, ep.season, ep.episode));
    saveBtn.classList.toggle('is-saved', isCached);
    saveBtn.classList.remove('is-downloading');
    saveBtn.textContent = isCached ? '✓ Saved · Remove' : '💾 Save offline';
    saveBtn.title = isCached
      ? 'Stored offline — click to delete the cached copy'
      : 'Download this episode for offline playback';
    saveBtn.disabled = false;
  }

  /**
   * Click handler routes by current state:
   *   1. download in progress → cancel the AbortController
   *   2. episode already saved → drop it from IDB
   *   3. neither → start a fresh streamed download with progress
   */
  async function handleSaveClick() {
    const ep = current;
    if (!ep) return;

    if (saveAbort) {
      saveAbort.abort();
      saveAbort = null;
      return;
    }

    const key = offlineKey(show.id, ep.season, ep.episode);
    if (savedKeys.has(key)) {
      const ok = await deleteOfflineEpisode(show.id, ep.season, ep.episode);
      if (ok) {
        savedKeys.delete(key);
        // Drop the in-use blob URL — the cached file is gone; fall
        // back to the network URL so seeks still work.
        if (savedBlobUrl) {
          URL.revokeObjectURL(savedBlobUrl);
          savedBlobUrl = null;
          if (current === ep) {
            video.src = ep.url;
            video.load();
          }
        }
        flash('REMOVED');
        trackWatch(
          'watch_offline_delete',
          mediaLabel(/** @type {any} */ (show).kind === 'movie' ? 'movie' : 'show', show.id, ep)
        );
      } else {
        flash('REMOVE FAILED');
      }
      refreshSaveButton(ep);
      return;
    }

    saveAbort = new AbortController();
    saveBtn.classList.add('is-downloading');
    saveBtn.classList.remove('is-saved');
    saveBtn.textContent = '⏬ Starting…';
    saveBtn.title = 'Click to cancel the download';
    void ensureOfflinePersistent();
    try {
      await saveOfflineEpisode(show, ep, {
        signal: saveAbort.signal,
        onProgress: ({ ratio, total }) => {
          const pct = total > 0 ? Math.round(ratio * 100) : null;
          saveBtn.textContent = pct == null ? '⏬ Downloading…' : `⏬ ${pct}% · cancel`;
        }
      });
      savedKeys.add(key);
      trackWatch(
        'watch_offline_save',
        mediaLabel(/** @type {any} */ (show).kind === 'movie' ? 'movie' : 'show', show.id, ep)
      );
      trackWatchConversion('offline_episode_saved', 1);
      if (current === ep) {
        flash('SAVED OFFLINE');
        void applyOfflineSrc(ep);
      }
    } catch (err) {
      const isAbort = err && /** @type {DOMException} */ (err).name === 'AbortError';
      flash(isAbort ? 'SAVE CANCELLED' : 'SAVE FAILED');
    } finally {
      saveAbort = null;
      if (current === ep) refreshSaveButton(ep);
    }
  }

  function onClick() {
    void handleSaveClick();
  }

  saveBtn.addEventListener('click', onClick);

  return {
    /** Hydrate the in-memory mirror from IDB before the first setEpisode. */
    async hydrate() {
      try {
        for (const meta of await listOfflineSaved()) {
          savedKeys.add(offlineKey(meta.showId, meta.season, meta.episode));
        }
      } catch {
        /* IDB unavailable — listOfflineSaved already returns [] */
      }
    },

    /**
     * Episode-change hook. Revokes any prior blob URL, optionally
     * applies the cached blob for the new episode, repaints the
     * button. Mount sets the network video.src before calling this.
     */
    setEpisode(ep, opts = {}) {
      current = ep;
      if (savedBlobUrl) {
        URL.revokeObjectURL(savedBlobUrl);
        savedBlobUrl = null;
      }
      if (ep && savedKeys.has(offlineKey(show.id, ep.season, ep.episode))) {
        void applyOfflineSrc(ep, opts);
      }
      refreshSaveButton(ep);
    },

    dispose() {
      saveBtn.removeEventListener('click', onClick);
      if (savedBlobUrl) {
        URL.revokeObjectURL(savedBlobUrl);
        savedBlobUrl = null;
      }
      if (saveAbort) {
        try {
          saveAbort.abort();
        } catch {
          /* ignore */
        }
        saveAbort = null;
      }
    },

    /** Used by tests + future callers that need a sync check. */
    isSavedSync(ep) {
      return savedKeys.has(offlineKey(show.id, ep.season, ep.episode));
    }
  };
}
