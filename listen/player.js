export function getCoverUrl(book) {
  if (!book?.identifier) return null;
  return `https://archive.org/services/img/${book.identifier}`;
}

export function formatCreator(book) {
  const c = book?.creator;
  if (!c) return 'Unknown Author';
  return Array.isArray(c) ? c.join(', ') : String(c);
}

export class Player {
  constructor(audioEl) {
    this.audio = audioEl;
    /** @type {object|null} */
    this.book = null;
    /** @type {Array<object>} */
    this.sections = [];
    this.currentIndex = 0;
    this._wakeLock = null;

    /** @type {((index: number) => void)|null} */
    this.onChapterChange = null;
    /** @type {((state: {playing: boolean, currentTime: number, duration: number}) => void)|null} */
    this.onStateChange = null;
    /** @type {(() => void)|null} */
    this.onEnded = null;

    this._setupAudioListeners();
    this._setupMediaSession();
  }

  _setupAudioListeners() {
    const emit = () => {
      this.onStateChange?.({
        playing: !this.audio.paused,
        currentTime: this.audio.currentTime,
        duration: this.audio.duration || 0,
      });
    };

    this.audio.addEventListener('timeupdate', emit);
    this.audio.addEventListener('durationchange', emit);

    this.audio.addEventListener('play', () => {
      emit();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
      this._requestWakeLock();
    });

    this.audio.addEventListener('pause', () => {
      emit();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
      this._releaseWakeLock();
    });

    this.audio.addEventListener('ended', () => {
      if (this.currentIndex < this.sections.length - 1) {
        this.nextChapter();
      } else {
        if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none';
        this._releaseWakeLock();
        this.onEnded?.();
      }
    });

    this.audio.addEventListener('error', () => {
      console.warn('Audio error on section', this.currentIndex);
    });
  }

  _setupMediaSession() {
    if (!navigator.mediaSession) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());

    navigator.mediaSession.setActionHandler('previoustrack', () => this.prevChapter());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.nextChapter());

    navigator.mediaSession.setActionHandler('seekbackward', ({ seekOffset }) => {
      this.audio.currentTime = Math.max(0, this.audio.currentTime - (seekOffset ?? 30));
    });
    navigator.mediaSession.setActionHandler('seekforward', ({ seekOffset }) => {
      const dur = this.audio.duration || 0;
      this.audio.currentTime = Math.min(dur, this.audio.currentTime + (seekOffset ?? 30));
    });

    try {
      navigator.mediaSession.setActionHandler('seekto', ({ seekTime }) => {
        if (seekTime != null) this.audio.currentTime = seekTime;
      });
    } catch {
      // seekto is not supported on all platforms
    }
  }

  _updateMediaMetadata() {
    if (!navigator.mediaSession || !this.book) return;
    const section = this.sections[this.currentIndex];
    const coverUrl = getCoverUrl(this.book);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: section?.title || this.book.title,
      artist: formatCreator(this.book),
      album: this.book.title,
      artwork: coverUrl
        ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  }

  async _requestWakeLock() {
    if (!('wakeLock' in navigator) || this._wakeLock) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener('release', () => {
        this._wakeLock = null;
      });
    } catch {
      // Wake lock not available or denied — fine
    }
  }

  _releaseWakeLock() {
    if (this._wakeLock) {
      this._wakeLock.release().catch(() => {});
      this._wakeLock = null;
    }
  }

  load(book, sections, startIndex = 0, startTime = 0) {
    this.book = book;
    this.sections = sections.filter((s) => s.listen_url);
    this.currentIndex = Math.min(startIndex, this.sections.length - 1);
    this._loadChapter(this.currentIndex, startTime);
  }

  _loadChapter(index, startTime = 0) {
    const section = this.sections[index];
    if (!section) return;
    this.currentIndex = index;
    this.audio.src = section.listen_url;
    this.audio.currentTime = startTime;
    this._updateMediaMetadata();
    this.onChapterChange?.(index);
  }

  async play() {
    try {
      await this.audio.play();
    } catch (e) {
      console.warn('play() prevented:', e);
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlayPause() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  prevChapter() {
    // If more than 5s in, restart the current chapter first
    if (this.audio.currentTime > 5) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.currentIndex > 0) {
      this._loadChapter(this.currentIndex - 1, 0);
      this.play();
    }
  }

  nextChapter() {
    if (this.currentIndex < this.sections.length - 1) {
      this._loadChapter(this.currentIndex + 1, 0);
      this.play();
    }
  }

  goToChapter(index) {
    this._loadChapter(index, 0);
    this.play();
  }

  seek(time) {
    this.audio.currentTime = time;
  }

  setSpeed(rate) {
    this.audio.playbackRate = rate;
  }

  get isPlaying() {
    return !this.audio.paused;
  }

  get currentTime() {
    return this.audio.currentTime;
  }

  get duration() {
    return this.audio.duration || 0;
  }

  get currentSection() {
    return this.sections[this.currentIndex] || null;
  }
}
