/**
 * Subtitle controller for the watch view.
 *
 * Owns: the CC button, the language picker menu, the sync slider,
 * the `<track>` element attached to `<video>`, and the cross-episode
 * `subtitleOffset` value. The data layer (Stremio search + SRT→VTT
 * conversion) lives in `../subtitles.js` and is unit-tested there.
 *
 * The orchestrator (watch-view.js `mount()`) drives episode changes
 * via `setEpisode(ep)`. Everything else — outside-click dismissal,
 * menu lazy-loading, optimistic CC button state, offset slider — is
 * the controller's business and is wired on construction.
 *
 * Why a controller and not free functions on `mount()`:
 * the subtitle feature has its own lifecycle (auto-load on episode
 * change, language persistence, offset persistence within session,
 * blob URL hygiene on teardown). Bundling all that into one object
 * with `setEpisode` / `dispose` keeps the orchestrator from having
 * to know about menus, offsets, or `<track>` plumbing.
 */

import {
  searchSubtitles,
  groupByLanguage,
  sortLanguageGroups,
  languageLabel,
  loadVttUrl,
  applyCueOffset
} from '../subtitles.js';

/** @typedef {import('../shows.js').ShowConfig} ShowConfig */
/** @typedef {import('../movies.js').MovieConfig} MovieConfig */
/** @typedef {import('../catalog.js').Episode} Episode */

/**
 * @typedef {Object} SubtitleControllerDom
 * @property {HTMLButtonElement} subsBtn CC trigger.
 * @property {HTMLElement} subsMenu Lazy language menu container.
 * @property {HTMLElement} subsWrap Wrapper used for outside-click dismissal.
 * @property {HTMLElement} subsSyncWrap Sync slider section (hidden until a track is active).
 * @property {HTMLInputElement} subsSyncSlider Range input driving the offset.
 * @property {HTMLButtonElement} subsSyncReadout Doubles as "reset to zero".
 */

/**
 * @typedef {Object} SubtitleControllerDeps
 * @property {HTMLVideoElement} video Target for `<track>` attachment.
 * @property {ShowConfig | MovieConfig} show Read: `imdbId`.
 *   For a standalone movie the auto-attach branch is gated off
 *   (`ep.season > 0`); a follow-up could special-case movie subtitle
 *   lookup against the OpenSubtitles addon's no-S/E path. Today,
 *   movies that need CC should omit `imdbId` so the CC button never
 *   appears at all.
 * @property {{ subtitleLang: string | null }} prefs Mutable prefs reference.
 * @property {(prefs: any) => void} savePrefs Persist the prefs blob.
 * @property {(msg: string) => void} flash Marquee toast helper.
 * @property {SubtitleControllerDom} dom DOM nodes built by mount().
 */

/**
 * @param {SubtitleControllerDeps} deps
 * @returns {{
 *   setEpisode: (ep: Episode | null) => void,
 *   dispose: () => void,
 *   getActiveLang: () => string | null,
 *   getOffset: () => number,
 *   toggleCaptions: () => void,
 * }}
 */
export function createSubtitleController(deps) {
  const { video, show, prefs, savePrefs, flash, dom } = deps;
  const { subsBtn, subsMenu, subsWrap, subsSyncWrap, subsSyncSlider, subsSyncReadout } = dom;

  /** @type {Episode | null} */
  let current = null;
  /** @type {HTMLTrackElement | null} */
  let activeTrack = null;
  /** @type {string | null} */
  let activeTrackUrl = null;
  /** @type {string | null} */
  let activeLang = null;
  /** @type {string | null} */
  let menuCacheKey = null;
  // Manual sync offset in seconds. Persists across episode changes within
  // a session because most OpenSubtitles uploads for a given show come
  // from the same source release — once the user has dialled in the
  // right delay, it usually carries over.
  let subtitleOffset = 0;

  function setSubtitleOffset(offsetSec) {
    const clamped = Math.max(-30, Math.min(30, offsetSec));
    subtitleOffset = Math.round(clamped * 10) / 10;
    applyOffsetToActiveTrack();
    updateSyncReadout();
  }

  function applyOffsetToActiveTrack() {
    if (!activeTrack || !activeTrack.track) return;
    applyCueOffset(activeTrack.track.cues, subtitleOffset);
  }

  function updateSyncReadout() {
    const sign = subtitleOffset > 0 ? '+' : subtitleOffset < 0 ? '−' : '';
    const abs = Math.abs(subtitleOffset).toFixed(1);
    subsSyncReadout.textContent = `${sign}${abs}s`;
    if (subtitleOffset !== 0) {
      subsSyncReadout.classList.add('is-shifted');
    } else {
      subsSyncReadout.classList.remove('is-shifted');
    }
    if (subsSyncSlider.value !== String(subtitleOffset)) {
      subsSyncSlider.value = String(subtitleOffset);
    }
    if (activeLang) {
      subsBtn.textContent =
        subtitleOffset === 0
          ? `CC ${activeLang.toUpperCase()}`
          : `CC ${activeLang.toUpperCase()} ${sign}${abs}s`;
    }
  }

  /**
   * Tear down any active track. Safe to call when nothing is attached.
   * Keeps `subtitleOffset` in place so the value carries over when the
   * user re-enables subs on the next episode — the offset is only
   * reset when the user explicitly picks "Off" in the menu.
   */
  function clearSubtitles() {
    if (activeTrack && activeTrack.parentNode) {
      activeTrack.remove();
    }
    if (activeTrackUrl) {
      try {
        URL.revokeObjectURL(activeTrackUrl);
      } catch {
        /* ignore */
      }
    }
    activeTrack = null;
    activeTrackUrl = null;
    activeLang = null;
    subsBtn.textContent = 'CC';
    subsBtn.classList.remove('is-active');
    subsBtn.setAttribute('aria-expanded', 'false');
    subsSyncWrap.classList.add('hidden');
  }

  function closeSubsMenu() {
    subsMenu.classList.add('hidden');
    subsBtn.setAttribute('aria-expanded', 'false');
  }

  /**
   * Background fetch + attach for the user's saved preferred language.
   * Bails silently when the user navigates to a different episode
   * before the search resolves.
   *
   * @param {Episode} ep
   * @param {string} lang
   */
  async function maybeAutoLoadSubtitles(ep, lang) {
    const stamp = `${ep.season}:${ep.episode}`;
    const candidates = await searchSubtitles(show.imdbId || '', ep.season, ep.episode);
    if (!current || `${current.season}:${current.episode}` !== stamp) return;
    const groups = groupByLanguage(candidates);
    const group = groups.find((g) => g.lang === lang);
    if (!group) return;
    const url = await loadVttUrl(group.candidates);
    if (!url) return;
    if (!current || `${current.season}:${current.episode}` !== stamp) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      return;
    }
    attachSubtitleTrack(url, lang);
  }

  /**
   * Open the language picker, populating lazily on first open per
   * episode. Subsequent opens for the same episode reuse the rendered
   * list so the UI doesn't flash a "Loading…" state needlessly.
   */
  async function openSubsMenu() {
    if (!show.imdbId || !current) return;
    subsMenu.classList.remove('hidden');
    subsBtn.setAttribute('aria-expanded', 'true');

    const epKey = `${current.season}:${current.episode}`;
    if (menuCacheKey === epKey && subsMenu.childElementCount > 0) {
      return;
    }
    menuCacheKey = epKey;

    subsMenu.replaceChildren();
    if (current.season === 0) {
      subsMenu.appendChild(menuMessage('Subtitles for specials / movies are not supported yet.'));
      return;
    }

    subsMenu.appendChild(menuMessage('Loading…'));

    const candidates = await searchSubtitles(show.imdbId, current.season, current.episode);
    if (menuCacheKey !== epKey) return;

    subsMenu.replaceChildren();

    subsMenu.appendChild(
      makeMenuItem('Off', null, () => {
        clearSubtitles();
        // Explicit "Off" also forgets the offset — the user is starting
        // fresh next time they turn captions on.
        setSubtitleOffset(0);
        prefs.subtitleLang = null;
        savePrefs(prefs);
        closeSubsMenu();
      })
    );

    const groups = sortLanguageGroups(groupByLanguage(candidates));
    if (groups.length === 0) {
      subsMenu.appendChild(menuMessage('No subtitles found for this episode.'));
      return;
    }
    for (const g of groups) {
      const label = `${languageLabel(g.lang)} · ${g.candidates.length}`;
      subsMenu.appendChild(
        makeMenuItem(label, g.lang, async () => {
          prefs.subtitleLang = g.lang;
          savePrefs(prefs);
          // Optimistic UI: switch the button immediately so the user
          // sees feedback while the SRT downloads.
          subsBtn.textContent = `CC ${g.lang.toUpperCase()}`;
          subsBtn.classList.add('is-active');
          closeSubsMenu();
          const url = await loadVttUrl(g.candidates);
          if (!url) {
            clearSubtitles();
            flash('SUBS UNAVAILABLE');
            return;
          }
          if (menuCacheKey !== epKey || !current) {
            try {
              URL.revokeObjectURL(url);
            } catch {
              /* ignore */
            }
            return;
          }
          attachSubtitleTrack(url, g.lang);
        })
      );
    }
  }

  /** @param {string} text */
  function menuMessage(text) {
    const p = document.createElement('p');
    p.className = 'tv-subs-empty';
    p.textContent = text;
    return p;
  }

  /**
   * @param {string} label
   * @param {string | null} lang Currently-active lang gets a check; null = "Off" row.
   * @param {() => void} onClick
   */
  function makeMenuItem(label, lang, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tv-subs-item';
    b.setAttribute('role', 'menuitem');
    if (lang === activeLang || (lang === null && !activeLang)) {
      b.classList.add('is-current');
    }
    b.textContent = label;
    b.addEventListener('click', () => onClick());
    return b;
  }

  /**
   * Attach a `<track>` element pointing at the converted blob URL.
   * Removes any prior track first; the player is single-track by design.
   *
   * @param {string} blobUrl
   * @param {string} lang ISO 639-2 code.
   */
  function attachSubtitleTrack(blobUrl, lang) {
    if (activeTrack && activeTrack.parentNode) activeTrack.remove();
    if (activeTrackUrl) {
      try {
        URL.revokeObjectURL(activeTrackUrl);
      } catch {
        /* ignore */
      }
    }
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.srclang = lang;
    track.label = languageLabel(lang);
    track.src = blobUrl;
    track.default = true;
    // The `load` event fires once the browser has parsed the WebVTT,
    // which is when `track.track.cues` becomes non-empty. That's the
    // earliest we can apply the user's manual offset.
    track.addEventListener('load', () => {
      if (subtitleOffset !== 0) applyCueOffset(track.track?.cues, subtitleOffset);
    });
    video.appendChild(track);
    // `<track>.mode = 'showing'` is what actually flips captions on;
    // setting `default` only matters when the element is added *before*
    // the video starts playing. Set both for safety.
    if (track.track) track.track.mode = 'showing';
    activeTrack = track;
    activeTrackUrl = blobUrl;
    activeLang = lang;
    subsBtn.classList.add('is-active');
    subsSyncWrap.classList.remove('hidden');
    updateSyncReadout();
  }

  // ---- Event wiring ---------------------------------------------------

  function onSubsBtnClick(e) {
    e.stopPropagation();
    if (subsMenu.classList.contains('hidden')) {
      void openSubsMenu();
    } else {
      closeSubsMenu();
    }
  }

  function onSliderInput() {
    const v = parseFloat(subsSyncSlider.value);
    if (Number.isFinite(v)) setSubtitleOffset(v);
  }

  function onReadoutClick() {
    setSubtitleOffset(0);
  }

  function onOutsideClick(e) {
    if (!subsWrap.contains(e.target instanceof Node ? e.target : null)) {
      closeSubsMenu();
    }
  }

  subsBtn.addEventListener('click', onSubsBtnClick);
  subsSyncSlider.addEventListener('input', onSliderInput);
  subsSyncReadout.addEventListener('click', onReadoutClick);
  document.addEventListener('click', onOutsideClick);

  return {
    setEpisode(ep) {
      current = ep;
      clearSubtitles();
      closeSubsMenu();
      if (ep && prefs.subtitleLang && show.imdbId && ep.season > 0) {
        void maybeAutoLoadSubtitles(ep, prefs.subtitleLang);
      }
    },
    dispose() {
      subsBtn.removeEventListener('click', onSubsBtnClick);
      subsSyncSlider.removeEventListener('input', onSliderInput);
      subsSyncReadout.removeEventListener('click', onReadoutClick);
      document.removeEventListener('click', onOutsideClick);
      clearSubtitles();
    },
    getActiveLang() {
      return activeLang;
    },
    getOffset() {
      return subtitleOffset;
    },
    /**
     * YouTube-style `C` shortcut. Three behaviours, in priority order:
     *
     *  1. A `<track>` is already attached → flip its `mode` between
     *     `showing` and `disabled`. No network round-trip; the user
     *     gets instant on/off.
     *  2. No track, but the show has an imdbId AND a saved language
     *     for this session → kick off the same auto-load path the
     *     episode-change flow uses, with a "LOADING…" toast.
     *  3. Otherwise → pop the language menu so the user can pick.
     *
     * For shows without an imdbId (no subtitle source), flash a short
     * "UNAVAILABLE" toast so the keypress doesn't feel inert.
     */
    toggleCaptions() {
      if (activeTrack && activeTrack.track) {
        if (activeTrack.track.mode === 'showing') {
          activeTrack.track.mode = 'disabled';
          subsBtn.classList.remove('is-active');
          flash('CAPTIONS OFF');
        } else {
          activeTrack.track.mode = 'showing';
          subsBtn.classList.add('is-active');
          flash('CAPTIONS ON');
        }
        return;
      }
      if (!show.imdbId || !current) {
        flash('CAPTIONS UNAVAILABLE');
        return;
      }
      if (prefs.subtitleLang && current.season > 0) {
        flash('LOADING CAPTIONS…');
        void maybeAutoLoadSubtitles(current, prefs.subtitleLang);
        return;
      }
      void openSubsMenu();
    }
  };
}
