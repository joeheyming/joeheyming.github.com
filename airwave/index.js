/**
 * Airwave entry — wires the player, queue, search, and MediaSession to the
 * DOM declared in `index.html`.
 *
 * Top-level shape:
 *   - `App.boot()` initializes the player and sets up event listeners.
 *   - All UI mutation happens in render functions keyed on subscriptions.
 *   - DOM `addEventListener`s call into thin command methods (`playNow`,
 *     `enqueue`, `togglePlay`, etc.) that drive both the queue and the
 *     player.
 *
 * No build step. ES module, loaded via `<script type="module">`.
 */

import { AirwavePlayer } from './modules/yt-player.js';
import { parseYouTubeId, parsePlaylistId, fetchOEmbed, pickThumbnail } from './modules/metadata.js';
import { searchYouTube } from './modules/search.js';
import { AirwaveQueue } from './modules/queue.js';
import { AirwavePlaylists, normalizeName } from './modules/playlists.js';
import { bindMediaSession, setPlaybackState, updatePosition } from './modules/media-session.js';

const POLL_MS = 500;
const VOLUME_KEY = 'heyming.airwave.volume.v1';
// Don't re-issue a "skip past ad" seek more often than this — YouTube
// occasionally chains two pre-rolls back-to-back and we want to detect
// the second one cleanly without seek-storming the iframe in the gap.
const AD_SKIP_COOLDOWN_MS = 1500;

// "Video paused. Continue watching?" — after long unattended playback
// YouTube pauses the embed and shows a confirm dialog. We can't reach
// that dialog button across origins, but a fresh `playVideo` from the
// parent typically resumes the underlying playback. We wait a short
// grace period after entering an unsolicited pause, then retry on a
// 30s cadence with a hard cap so a genuinely broken state doesn't
// loop forever.
const AUTO_RESUME_FIRST_DELAY_MS = 8000;
const AUTO_RESUME_RETRY_MS = 30 * 1000;
const AUTO_RESUME_MAX_ATTEMPTS = 5;

function $(id) {
  return document.getElementById(id);
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function trackEvent(name, params) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    try {
      window.gtag('event', name, params || {});
    } catch {
      /* analytics is best-effort */
    }
  }
}

class App {
  constructor() {
    this.player = new AirwavePlayer({ elementId: 'aw-yt-player' });
    this.queue = new AirwaveQueue();
    this.playlists = new AirwavePlaylists();

    this.dom = {
      searchInput: /** @type {HTMLInputElement} */ ($('aw-search-input')),
      searchForm: /** @type {HTMLFormElement} */ ($('aw-search-form')),
      searchStatus: $('aw-search-status'),
      searchResults: $('aw-search-results'),
      art: /** @type {HTMLImageElement} */ ($('aw-art')),
      title: $('aw-track-title'),
      author: $('aw-track-author'),
      timeCurrent: $('aw-time-current'),
      timeTotal: $('aw-time-total'),
      seek: /** @type {HTMLInputElement} */ ($('aw-seek')),
      play: $('aw-play'),
      prev: $('aw-prev'),
      next: $('aw-next'),
      back15: $('aw-back15'),
      fwd15: $('aw-fwd15'),
      shuffle: $('aw-shuffle'),
      speed: /** @type {HTMLSelectElement} */ ($('aw-speed')),
      volume: /** @type {HTMLInputElement} */ ($('aw-volume')),
      sleep: /** @type {HTMLSelectElement} */ ($('aw-sleep')),
      sleepStatus: $('aw-sleep-status'),
      queueList: $('aw-queue-list'),
      clearQueue: $('aw-clear-queue'),
      playlistsSelect: /** @type {HTMLSelectElement} */ ($('aw-playlists')),
      now: document.querySelector('.aw-now')
    };

    this.disposeMediaSession = () => {};
    this.pollTimer = null;
    this.sleepTimer = null;
    this.sleepDeadline = null;
    this.scrubbing = false;
    this.searchAbort = null;
    this.lastQuery = '';
    this.muted = false;
    this.preMuteVolume = 100;
    this._lastAdSkipAt = 0;
    // Auto-resume bookkeeping. `_userPaused` is the only signal that
    // tells us "stay paused" — set whenever the user (or sleep timer)
    // explicitly stops playback, cleared whenever something starts it.
    this._userPaused = false;
    this._lastPlayingAt = 0;
    this._pausedSinceMs = 0;
    this._lastAutoResumeAt = 0;
    this._autoResumeAttempts = 0;
  }

  async boot() {
    this.bindUiEvents();
    this.bindPlayerEvents();
    // Subscribe BEFORE the URL restore step so the very first snapshot
    // (after the URL track is added) syncs back to `?v=...`.
    this.queue.subscribe((snap) => {
      this.renderQueue(snap);
      this.renderShuffleButton(snap);
      this.syncUrlToTrack(snap.current);
    });
    this.playlists.subscribe((snap) => this.renderPlaylistsSelect(snap));
    this.restoreVolume();
    this.renderTrack(this.queue.snapshot().current);

    try {
      await this.player.preloadApi();
    } catch (err) {
      this.setSearchStatus(
        `Couldn't load YouTube player: ${err && err.message ? err.message : err}`,
        true
      );
      return;
    }

    this.startPolling();

    // If the URL has `?v=<id>`, that takes precedence over whatever was
    // restored from localStorage — the user clicked a share link and
    // expects that specific track. Adds (or jumps to) it in the queue.
    await this._restoreFromUrl();

    // Cue the current track without autoplay so a tap on Play starts
    // instantly. Browser autoplay policies block sound from loading
    // without a user gesture anyway.
    const current = this.queue.snapshot().current;
    if (current) {
      this.player.cueVideo(current.id).catch((err) => {
        console.warn('[airwave] cue restored track failed:', err);
      });
    }
  }

  /**
   * Pull `?v=<id>` from the URL and ensure that track is current. If
   * the track isn't already in the queue we resolve metadata via
   * oEmbed and add it via `playNow` (which only updates the queue —
   * actual audio playback still waits for user gesture).
   */
  async _restoreFromUrl() {
    let videoId = null;
    try {
      const params = new URLSearchParams(window.location.search);
      videoId = params.get('v');
    } catch {
      return;
    }
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;

    const snap = this.queue.snapshot();
    const existingIdx = snap.items.findIndex((t) => t.id === videoId);
    if (existingIdx >= 0) {
      if (snap.currentIndex !== existingIdx) this.queue.jumpTo(existingIdx);
      return;
    }
    try {
      const meta = await fetchOEmbed(videoId, { proxy: window.proxyService });
      this.queue.playNow({
        id: meta.id,
        title: meta.title,
        author: meta.author,
        thumbnail: meta.thumbnailHi,
        duration: null
      });
    } catch (err) {
      this.setSearchStatus(
        `Couldn't load shared video: ${err && err.message ? err.message : err}`,
        true
      );
    }
  }

  /**
   * Mirror the current track's id into the URL as `?v=<id>` so the
   * page is shareable. Uses `replaceState` to avoid polluting browser
   * history with every track change.
   */
  syncUrlToTrack(track) {
    try {
      const url = new URL(window.location.href);
      if (track && track.id) {
        if (url.searchParams.get('v') === track.id) return;
        url.searchParams.set('v', track.id);
      } else {
        if (!url.searchParams.has('v')) return;
        url.searchParams.delete('v');
      }
      window.history.replaceState({}, '', url);
    } catch {
      /* private mode / sandboxed iframe — fine to skip */
    }
  }

  /* ── Event wiring ────────────────────────────────────────────── */

  bindUiEvents() {
    this.dom.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSearchSubmit();
    });

    this.dom.play.addEventListener('click', () => this.togglePlay());
    this.dom.prev.addEventListener('click', () => this.handlePrev());
    this.dom.next.addEventListener('click', () => this.handleNext());
    this.dom.back15.addEventListener('click', () => this.player.nudge(-10));
    this.dom.fwd15.addEventListener('click', () => this.player.nudge(10));
    this.dom.shuffle.addEventListener('click', () => this.handleShuffleToggle());

    this.dom.seek.addEventListener('input', () => {
      this.scrubbing = true;
      this.dom.timeCurrent.textContent = fmtTime(Number(this.dom.seek.value));
    });
    this.dom.seek.addEventListener('change', () => {
      this.player.seekTo(Number(this.dom.seek.value), true);
      this.scrubbing = false;
    });

    this.dom.speed.addEventListener('change', () => {
      this.player.setPlaybackRate(this.dom.speed.value);
    });
    this.dom.volume.addEventListener('input', () => {
      const v = Number(this.dom.volume.value);
      this.muted = v === 0;
      if (!this.muted) this.preMuteVolume = v;
      this.player.setVolume(v);
      this.persistVolume(v);
    });
    this.dom.sleep.addEventListener('change', () => this.handleSleepChange());

    this.dom.clearQueue.addEventListener('click', () => {
      this.queue.clear();
      this.player.stop();
    });

    if (this.dom.playlistsSelect) {
      this.dom.playlistsSelect.addEventListener('change', () => this.handlePlaylistsSelect());
    }

    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  /**
   * YouTube-style shortcuts. Only fire when no form field has focus
   * and no modifier keys (Cmd/Ctrl/Alt) are held — that way we don't
   * fight standard browser shortcuts.
   */
  handleKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const isFormField =
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    if (isFormField) return;

    const key = e.key;

    // Play / pause.
    if (key === ' ' || key === 'k' || key === 'K') {
      e.preventDefault();
      this.togglePlay();
      return;
    }

    // YouTube uses J/L for ±10s.
    if (key === 'j' || key === 'J') {
      this.player.nudge(-10);
      return;
    }
    if (key === 'l' || key === 'L') {
      this.player.nudge(10);
      return;
    }

    // Arrow ±5s (audio: skip the volume-modifier behavior YouTube has on video).
    if (key === 'ArrowLeft') {
      this.player.nudge(-5);
      return;
    }
    if (key === 'ArrowRight') {
      this.player.nudge(5);
      return;
    }

    // Volume ↑/↓ in 5% steps.
    if (key === 'ArrowUp') {
      e.preventDefault();
      this.adjustVolume(5);
      return;
    }
    if (key === 'ArrowDown') {
      e.preventDefault();
      this.adjustVolume(-5);
      return;
    }

    // Mute toggle.
    if (key === 'm' || key === 'M') {
      this.toggleMute();
      return;
    }

    // Speed ±0.25 with `,` and `.` (matches YouTube's `<` / `>`).
    if (key === ',' || key === '<') {
      this.adjustSpeed(-0.25);
      return;
    }
    if (key === '.' || key === '>') {
      this.adjustSpeed(0.25);
      return;
    }

    // Track navigation.
    if (key === 'n' || key === 'N') {
      this.handleNext();
      return;
    }
    if (key === 'p' || key === 'P') {
      this.handlePrev();
      return;
    }

    // Shuffle toggle.
    if (key === 's' || key === 'S') {
      this.handleShuffleToggle();
      return;
    }

    // Digit seeks (0–9 = jump to that decile of duration).
    if (/^[0-9]$/.test(key)) {
      const pct = Number(key) / 10;
      const d = this.player.getDuration();
      if (Number.isFinite(d) && d > 0) {
        this.player.seekTo(d * pct, true);
      }
      return;
    }
  }

  bindPlayerEvents() {
    // Apply persisted volume / speed once the iframe is ready. The
    // volume slider's `input` listener handles user changes; this
    // covers the very first track-load after restore.
    this.player.on('ready', () => {
      const v = Number(this.dom.volume.value);
      if (Number.isFinite(v)) this.player.setVolume(v);
      const speed = Number(this.dom.speed.value);
      if (Number.isFinite(speed)) this.player.setPlaybackRate(speed);
    });

    this.player.on('playing', () => {
      window.heymingAchievements?.unlockForCurrentApp('first-action');
      this.dom.play.textContent = '⏸';
      this.dom.play.setAttribute('aria-label', 'Pause');
      this.dom.now.classList.add('is-playing');
      setPlaybackState('playing');
      // Reaching `playing` from any source counts as resumed — clear
      // the auto-resume retry counter so a future unsolicited pause
      // gets a fresh budget of attempts.
      this._userPaused = false;
      this._lastPlayingAt = Date.now();
      this._pausedSinceMs = 0;
      this._autoResumeAttempts = 0;
    });
    this.player.on('paused', () => {
      this.dom.play.textContent = '▶';
      this.dom.play.setAttribute('aria-label', 'Play');
      this.dom.now.classList.remove('is-playing');
      setPlaybackState('paused');
      // Stamp the moment we entered `paused`. The polling loop uses
      // this to decide whether the pause is long enough to be the
      // "still watching?" prompt.
      if (!this._pausedSinceMs) this._pausedSinceMs = Date.now();
    });
    this.player.on('ended', () => {
      this.dom.now.classList.remove('is-playing');
      setPlaybackState('paused');
      // Auto-advance if there's another track in the queue.
      if (!this.queue.next()) {
        // End of queue — leave the last track cued and don't try to
        // auto-resume back into the just-finished video.
        this.dom.play.textContent = '▶';
        this._userPaused = true;
      }
    });
    this.player.on('error', (e) => {
      const code = e?.data;
      // 100 = video not found, 101/150 = embedding disabled.
      const friendly =
        code === 101 || code === 150
          ? 'This video disabled embedding. Skipping.'
          : code === 100
          ? 'That video is unavailable. Skipping.'
          : 'YouTube reported a playback error.';
      this.setSearchStatus(friendly, true);
      // Best-effort: try the next track on hard errors so the queue keeps moving.
      if (code === 100 || code === 101 || code === 150) {
        setTimeout(() => this.queue.next(), 600);
      }
    });
  }

  /* ── Search ──────────────────────────────────────────────────── */

  async handleSearchSubmit() {
    const raw = this.dom.searchInput.value.trim();
    if (!raw) return;
    this.lastQuery = raw;

    // Direct paste path — no search needed.
    const playlistId = parsePlaylistId(raw);
    const videoId = parseYouTubeId(raw);
    if (videoId) {
      this.dom.searchInput.select();
      this.setSearchStatus('Loading metadata…');
      try {
        const meta = await fetchOEmbed(videoId, { proxy: window.proxyService });
        this.queue.playNow({
          id: meta.id,
          title: meta.title,
          author: meta.author,
          thumbnail: meta.thumbnailHi,
          duration: null
        });
        await this.player.loadVideo(meta.id);
        this.setSearchStatus('');
        trackEvent('airwave_play_url', { id: meta.id, has_playlist: !!playlistId });
      } catch (err) {
        this.setSearchStatus(err?.message || 'Could not load that video.', true);
      }
      return;
    }

    if (playlistId && !videoId) {
      // Pure playlist URL — let YouTube drive next-track itself.
      this.player.loadPlaylist(playlistId);
      this.setSearchStatus(`Playing playlist ${playlistId}…`);
      trackEvent('airwave_play_playlist', { id: playlistId });
      return;
    }

    // Search path.
    if (this.searchAbort) this.searchAbort.abort();
    this.searchAbort = new AbortController();
    this.setSearchStatus('Searching…');
    this.dom.searchResults.hidden = false;
    this.dom.searchResults.innerHTML = '<li class="aw-queue-empty">Searching YouTube…</li>';

    try {
      const results = await searchYouTube(raw, {
        proxy: window.proxyService,
        signal: this.searchAbort.signal
      });
      this.renderSearchResults(results);
      this.setSearchStatus(
        results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''
      );
      trackEvent('airwave_search', { query_length: raw.length, results: results.length });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      this.setSearchStatus(err?.message || 'Search failed.', true);
      this.dom.searchResults.hidden = true;
      this.dom.searchResults.innerHTML = '';
    }
  }

  renderSearchResults(results) {
    const list = this.dom.searchResults;
    list.innerHTML = '';
    if (!results.length) {
      list.hidden = true;
      return;
    }
    list.hidden = false;

    for (const r of results) {
      const li = document.createElement('li');

      const playBtn = document.createElement('button');
      playBtn.className = 'aw-search-result';
      playBtn.type = 'button';

      const img = document.createElement('img');
      img.className = 'aw-search-result-thumb';
      img.src = r.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';

      const meta = document.createElement('div');
      meta.className = 'aw-search-result-meta';
      const title = document.createElement('div');
      title.className = 'aw-search-result-title';
      title.textContent = r.title;
      const author = document.createElement('div');
      author.className = 'aw-search-result-author';
      author.textContent = [r.author, r.duration ? fmtTime(r.duration) : null]
        .filter(Boolean)
        .join(' · ');
      meta.appendChild(title);
      meta.appendChild(author);

      const actions = document.createElement('div');
      actions.className = 'aw-search-result-actions';
      const queueBtn = document.createElement('button');
      queueBtn.type = 'button';
      queueBtn.className = 'aw-btn aw-btn-ghost';
      queueBtn.textContent = '+ Queue';
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.enqueueResult(r);
      });
      actions.appendChild(queueBtn);

      playBtn.appendChild(img);
      playBtn.appendChild(meta);
      playBtn.appendChild(actions);

      playBtn.addEventListener('click', () => this.playResult(r));

      li.appendChild(playBtn);
      list.appendChild(li);
    }
  }

  enqueueResult(r) {
    const ok = this.queue.enqueue({
      id: r.id,
      title: r.title || `YouTube · ${r.id}`,
      author: r.author || '',
      thumbnail: r.thumbnail || pickThumbnail(r.id).fallback,
      duration: r.duration ?? null
    });
    if (ok) this.setSearchStatus('Added to queue.');
  }

  async playResult(r) {
    this.queue.playNow({
      id: r.id,
      title: r.title || `YouTube · ${r.id}`,
      author: r.author || '',
      thumbnail: r.thumbnail || pickThumbnail(r.id).fallback,
      duration: r.duration ?? null
    });
    try {
      await this.player.loadVideo(r.id);
    } catch (err) {
      this.setSearchStatus(err?.message || 'Could not start playback.', true);
    }
    trackEvent('airwave_play_search', { id: r.id });
  }

  setSearchStatus(message, isError = false) {
    this.dom.searchStatus.textContent = message || '';
    this.dom.searchStatus.classList.toggle('is-error', !!isError && !!message);
  }

  /* ── Transport ───────────────────────────────────────────────── */

  async togglePlay() {
    const state = this.player.getStateName();
    if (state === 'playing') {
      this._userPaused = true;
      this.player.pause();
      return;
    }
    this._userPaused = false;
    // If the player exists and has a video loaded, just resume.
    if (this.player.player && this.player.getDuration() > 0) {
      this.player.play();
      return;
    }
    // Otherwise load whatever's current in the queue. This is the path
    // for "session restored, user clicks Play for the first time" and
    // also "autoplay was blocked, user clicks again to start."
    const current = this.queue.snapshot().current;
    if (!current) {
      this.setSearchStatus('Nothing queued. Search or paste a URL above.');
      return;
    }
    try {
      await this.player.loadVideo(current.id);
    } catch (err) {
      this.setSearchStatus(err?.message || 'Could not start playback.', true);
    }
  }

  handleNext() {
    if (!this.queue.next()) return;
  }
  handlePrev() {
    // If we're past 3 seconds in, treat prev as restart-current.
    if (this.player.getCurrentTime() > 3) {
      this.player.seekTo(0, true);
      return;
    }
    this.queue.prev();
  }

  /* ── Sleep timer ─────────────────────────────────────────────── */

  handleSleepChange() {
    const minutes = Number(this.dom.sleep.value) || 0;
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
      this.sleepDeadline = null;
    }
    if (minutes > 0) {
      this.sleepDeadline = Date.now() + minutes * 60 * 1000;
      this.sleepTimer = setTimeout(() => {
        // Mark the pause as user-driven so auto-resume doesn't fight
        // the sleep timer.
        this._userPaused = true;
        this.player.pause();
        this.dom.sleep.value = '0';
        this.sleepDeadline = null;
        this.dom.sleepStatus.hidden = true;
      }, minutes * 60 * 1000);
      this.dom.sleepStatus.hidden = false;
      this.dom.sleepStatus.textContent = `Sleeping in ${minutes} min.`;
    } else {
      this.dom.sleepStatus.hidden = true;
    }
  }

  /* ── Shuffle ─────────────────────────────────────────────────── */

  handleShuffleToggle() {
    const next = this.queue.toggleShuffle();
    this.setSearchStatus(next ? 'Shuffle on' : 'Shuffle off');
  }

  renderShuffleButton(snapshot) {
    if (!this.dom.shuffle) return;
    const on = !!snapshot.shuffle;
    this.dom.shuffle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ── Volume / mute / speed helpers (keyboard) ──────────────── */

  restoreVolume() {
    let v = 100;
    try {
      const saved = localStorage.getItem(VOLUME_KEY);
      if (saved != null) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= 0 && n <= 100) v = Math.round(n);
      }
    } catch {
      /* private mode */
    }
    this.preMuteVolume = v > 0 ? v : 100;
    this.muted = v === 0;
    this.dom.volume.value = String(v);
    // Set on the player only if/when it exists; the volume input
    // listener handles future changes.
  }

  persistVolume(v) {
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* ignore */
    }
  }

  adjustVolume(deltaPct) {
    const cur = Number(this.dom.volume.value) || 0;
    const next = Math.max(0, Math.min(100, cur + deltaPct));
    this.dom.volume.value = String(next);
    this.muted = next === 0;
    if (next > 0) this.preMuteVolume = next;
    this.player.setVolume(next);
    this.persistVolume(next);
  }

  toggleMute() {
    if (this.muted) {
      const restore = this.preMuteVolume > 0 ? this.preMuteVolume : 100;
      this.dom.volume.value = String(restore);
      this.muted = false;
      this.player.setVolume(restore);
      this.persistVolume(restore);
    } else {
      this.preMuteVolume = Number(this.dom.volume.value) || this.preMuteVolume;
      this.dom.volume.value = '0';
      this.muted = true;
      this.player.setVolume(0);
      this.persistVolume(0);
    }
  }

  adjustSpeed(delta) {
    const options = Array.from(this.dom.speed.options).map((o) => Number(o.value));
    const cur = Number(this.dom.speed.value) || 1;
    // Snap to the nearest discrete option in the menu.
    let target = cur + delta;
    target = Math.max(options[0], Math.min(options[options.length - 1], target));
    let bestIdx = 0;
    let bestDist = Infinity;
    options.forEach((v, i) => {
      const d = Math.abs(v - target);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    this.dom.speed.value = String(options[bestIdx]);
    this.player.setPlaybackRate(options[bestIdx]);
  }

  /* ── Playlists ───────────────────────────────────────────────── */

  renderPlaylistsSelect(snapshot) {
    const sel = this.dom.playlistsSelect;
    if (!sel) return;
    const previousValue = sel.value;
    sel.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Playlists…';
    sel.appendChild(placeholder);

    const saveOpt = document.createElement('option');
    saveOpt.value = '__save__';
    saveOpt.textContent = '＋ Save current queue…';
    sel.appendChild(saveOpt);

    if (snapshot.playlists.length > 0) {
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '─────';
      sel.appendChild(sep);
    }

    for (const p of snapshot.playlists) {
      const opt = document.createElement('option');
      opt.value = `load:${p.id}`;
      opt.textContent = `${p.name} (${p.tracks.length})`;
      sel.appendChild(opt);
    }

    if (snapshot.playlists.length > 0) {
      const sep2 = document.createElement('option');
      sep2.disabled = true;
      sep2.textContent = '─────';
      sel.appendChild(sep2);
      for (const p of snapshot.playlists) {
        const opt = document.createElement('option');
        opt.value = `delete:${p.id}`;
        opt.textContent = `🗑 Delete "${p.name}"`;
        sel.appendChild(opt);
      }
    }

    // Re-select the previous value if it still exists; otherwise reset
    // to the placeholder.
    if (Array.from(sel.options).some((o) => o.value === previousValue)) {
      sel.value = previousValue;
    } else {
      sel.value = '';
    }
  }

  handlePlaylistsSelect() {
    const sel = this.dom.playlistsSelect;
    if (!sel) return;
    const value = sel.value;
    sel.value = ''; // Always reset so re-selecting the same option fires again.

    if (!value) return;

    if (value === '__save__') {
      this.savePlaylistFlow();
      return;
    }
    if (value.startsWith('load:')) {
      this.loadPlaylistFlow(value.slice('load:'.length));
      return;
    }
    if (value.startsWith('delete:')) {
      this.deletePlaylistFlow(value.slice('delete:'.length));
      return;
    }
  }

  savePlaylistFlow() {
    const items = this.queue.snapshot().items;
    if (items.length === 0) {
      this.setSearchStatus('Queue is empty — nothing to save.', true);
      return;
    }
    const raw = window.prompt('Name this playlist', '');
    const name = normalizeName(raw || '');
    if (!name) return;

    const result = this.playlists.save(name, items);
    if (!result.ok) {
      const msg =
        result.reason === 'too-many'
          ? 'Too many saved playlists. Delete one first.'
          : result.reason === 'empty-tracks'
          ? 'No valid tracks to save.'
          : 'Could not save that playlist.';
      this.setSearchStatus(msg, true);
      return;
    }
    this.setSearchStatus(result.replaced ? `Updated playlist "${name}".` : `Saved "${name}".`);
    trackEvent('airwave_playlist_save', {
      replaced: !!result.replaced,
      tracks: items.length
    });
  }

  loadPlaylistFlow(id) {
    const p = this.playlists.get(id);
    if (!p) return;
    if (this.queue.snapshot().items.length > 0) {
      const ok = window.confirm(`Replace your current queue with "${p.name}"?`);
      if (!ok) return;
    }
    this.queue.replaceAll(p.tracks, { startIndex: 0 });
    this.setSearchStatus(`Loaded "${p.name}" (${p.tracks.length} tracks).`);
    trackEvent('airwave_playlist_load', { id, tracks: p.tracks.length });
    // Cue the new current track so a Play tap starts immediately.
    const current = this.queue.snapshot().current;
    if (current) {
      this.player.cueVideo(current.id).catch(() => {});
    }
  }

  deletePlaylistFlow(id) {
    const p = this.playlists.get(id);
    if (!p) return;
    const ok = window.confirm(`Delete the playlist "${p.name}"?`);
    if (!ok) return;
    this.playlists.remove(id);
    this.setSearchStatus(`Deleted "${p.name}".`);
  }

  /* ── Polling for progress ────────────────────────────────────── */

  /**
   * Detect a YouTube ad and seek past it.
   *
   * The IFrame API's `infoDelivery.videoData.video_id` reports the
   * video the iframe is *currently rendering*. During a pre-roll or
   * mid-roll, that drifts to the ad's id while `currentVideoId`
   * stays on the track we asked it to load. When they disagree, we
   * jump to the (ad's) end so the real track resumes promptly. For
   * non-skippable ads the seek is clamped — that's fine, we just
   * land at the latest legal point and the ad finishes shortly.
   *
   * Ignored when `currentVideoId` is null (e.g. playlist-URL mode,
   * where YouTube legitimately advances the playing video itself).
   */
  _maybeSkipAd(duration) {
    const expected = this.player.currentVideoId;
    const actual = this.player.getPlayingVideoId();
    if (!expected || !actual || expected === actual) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (now - this._lastAdSkipAt < AD_SKIP_COOLDOWN_MS) return;
    this._lastAdSkipAt = now;
    this.player.seekTo(Math.max(0, duration - 0.1), true);
    this.setSearchStatus('Skipped an ad.');
  }

  /**
   * Detect a "Video paused. Continue watching?" prompt and resume.
   *
   * From inside YouTube's frame the bookmarklet can find the dialog
   * and click `#confirm-button`. We can't reach the dialog across the
   * iframe origin, but a fresh `playVideo` from the parent typically
   * dismisses it (or at minimum resumes underlying playback when
   * YouTube allows). We only fire when:
   *   - The user did NOT explicitly pause us (`_userPaused`).
   *   - We've reached `playing` at least once this session
   *     (`_lastPlayingAt > 0`) — guards against fighting an autoplay
   *     block at session start.
   *   - We're currently in the `paused` state.
   *   - Enough time has elapsed since pause / last attempt to look
   *     like a "still watching?" prompt rather than a buffer hiccup.
   *
   * Caps at MAX_ATTEMPTS so a genuinely broken state doesn't loop.
   */
  _maybeAutoResume() {
    if (this._userPaused) return;
    if (!this._lastPlayingAt) return;
    if (this.player.getStateName() !== 'paused') return;
    if (!this._pausedSinceMs) return;
    if (this._autoResumeAttempts >= AUTO_RESUME_MAX_ATTEMPTS) return;

    const now = Date.now();
    const sincePause = now - this._pausedSinceMs;
    const sinceLastAttempt = now - this._lastAutoResumeAt;
    const ready =
      this._autoResumeAttempts === 0
        ? sincePause >= AUTO_RESUME_FIRST_DELAY_MS
        : sinceLastAttempt >= AUTO_RESUME_RETRY_MS;
    if (!ready) return;

    this._lastAutoResumeAt = now;
    this._autoResumeAttempts++;
    console.log(
      '[airwave] auto-resume attempt',
      this._autoResumeAttempts,
      `after ${Math.round(sincePause / 1000)}s paused`
    );
    this.player.play();
    if (this._autoResumeAttempts >= AUTO_RESUME_MAX_ATTEMPTS) {
      this.setSearchStatus('Player paused. Tap Play to continue.');
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      const t = this.player.getCurrentTime();
      const d = this.player.getDuration();
      this._maybeSkipAd(d);
      this._maybeAutoResume();
      if (!this.scrubbing) {
        if (Number.isFinite(d) && d > 0) {
          this.dom.seek.max = String(Math.floor(d));
          this.dom.seek.value = String(Math.floor(t));
          this.dom.timeTotal.textContent = fmtTime(d);
        }
        this.dom.timeCurrent.textContent = fmtTime(t);
      }
      updatePosition({
        duration: d,
        position: t,
        playbackRate: Number(this.dom.speed.value) || 1
      });

      if (this.sleepDeadline) {
        const remainingMs = this.sleepDeadline - Date.now();
        if (remainingMs > 0) {
          const remainingMin = Math.ceil(remainingMs / 60000);
          this.dom.sleepStatus.textContent =
            remainingMin === 1 ? 'Sleeping in <1 min.' : `Sleeping in ${remainingMin} min.`;
        }
      }
    }, POLL_MS);
  }

  /* ── Render ─────────────────────────────────────────────────── */

  renderTrack(track) {
    const titleEl = this.dom.title;
    const authorEl = this.dom.author;
    const artEl = this.dom.art;

    if (!track) {
      titleEl.textContent = 'Nothing queued yet';
      authorEl.textContent = 'Search above or paste a YouTube URL.';
      artEl.removeAttribute('data-track-id');
      return;
    }

    titleEl.textContent = track.title || `YouTube · ${track.id}`;
    authorEl.textContent = track.author || '';

    if (artEl.getAttribute('data-track-id') !== track.id) {
      artEl.setAttribute('data-track-id', track.id);
      const thumbs = pickThumbnail(track.id);
      artEl.src = thumbs.best;
      artEl.onerror = () => {
        artEl.onerror = null;
        artEl.src = thumbs.fallback;
      };
    }

    this.disposeMediaSession();
    this.disposeMediaSession = bindMediaSession({
      track: { ...track, thumbnailHi: pickThumbnail(track.id).best },
      handlers: {
        // Lockscreen / headphone / Bluetooth pause counts as a user
        // gesture — respect it the same as a click on the in-app
        // play button, so auto-resume won't fight it.
        play: () => {
          this._userPaused = false;
          this.player.play();
        },
        pause: () => {
          this._userPaused = true;
          this.player.pause();
        },
        previoustrack: () => this.handlePrev(),
        nexttrack: () => this.handleNext(),
        seekbackward: (s) => this.player.nudge(-s),
        seekforward: (s) => this.player.nudge(s),
        seekto: (t) => this.player.seekTo(t, true)
      }
    });
  }

  renderQueue(snapshot) {
    const list = this.dom.queueList;
    list.innerHTML = '';

    if (snapshot.items.length === 0) {
      const li = document.createElement('li');
      li.className = 'aw-queue-empty';
      li.textContent = 'Queue is empty. Add tracks from search.';
      list.appendChild(li);
      this.renderTrack(null);
      return;
    }

    snapshot.items.forEach((track, index) => {
      const li = document.createElement('li');
      li.className = 'aw-queue-item';
      const isCurrent = index === snapshot.currentIndex;
      if (isCurrent) li.classList.add('is-current');

      // Whole row is a single button — clicking anywhere on the card
      // (thumbnail, title, author) plays that track. The remove × sits
      // outside the button so it doesn't steal the click.
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'aw-queue-item-main';
      main.setAttribute(
        'aria-label',
        isCurrent ? `Restart "${track.title}"` : `Play "${track.title}"`
      );
      if (isCurrent) main.setAttribute('aria-current', 'true');

      const thumb = document.createElement('img');
      thumb.className = 'aw-queue-item-thumb';
      thumb.src = track.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';

      const meta = document.createElement('div');
      meta.className = 'aw-queue-item-meta';
      const title = document.createElement('div');
      title.className = 'aw-queue-item-title';
      title.textContent = track.title;
      const author = document.createElement('div');
      author.className = 'aw-queue-item-author';
      author.textContent = [track.author, track.duration ? fmtTime(track.duration) : null]
        .filter(Boolean)
        .join(' · ');
      meta.appendChild(title);
      meta.appendChild(author);

      main.appendChild(thumb);
      main.appendChild(meta);

      main.addEventListener('click', async () => {
        if (isCurrent) {
          // Click the current row to restart it from the top.
          this.player.seekTo(0, true);
          this.player.play();
          return;
        }
        if (this.queue.jumpTo(index)) {
          try {
            await this.player.loadVideo(track.id);
          } catch (err) {
            this.setSearchStatus(err?.message || 'Could not start playback.', true);
          }
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'aw-queue-item-remove';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove "${track.title}" from queue`);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.queue.removeAt(index);
      });

      li.appendChild(main);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });

    const current = snapshot.current;
    this.renderTrack(current);

    // If the current index changed and the player is loaded with a
    // different video, swap. We avoid creating the player here (that
    // path is reserved for explicit user actions) — when no iframe
    // exists yet, we leave the queue rendered and wait for the next
    // click.
    if (
      current &&
      this.player.iframe &&
      this.player.currentVideoId &&
      this.player.currentVideoId !== current.id
    ) {
      this.player.loadVideo(current.id).catch((err) => {
        console.warn('[airwave] swap to current failed:', err);
      });
    }
  }
}

const app = new App();
app.boot().catch((err) => {
  console.error('[airwave] boot failed:', err);
});
