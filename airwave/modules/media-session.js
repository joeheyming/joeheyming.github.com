/**
 * Hook the current track up to `navigator.mediaSession` so OS-level
 * controls (lockscreen, headphone buttons, Bluetooth speakers, the
 * macOS Now Playing widget, etc.) drive the player.
 *
 * Pure function: pass in callbacks, get back a `dispose` for teardown.
 * Safe to call repeatedly — the new metadata replaces the old.
 *
 * If `navigator.mediaSession` is missing (Safari pre-15, Firefox on
 * some platforms) the function silently no-ops, returning an empty
 * dispose. Calling code never has to feature-detect.
 */

/**
 * @param {Object} args
 * @param {{ id:string,title:string,author:string,thumbnail:string,thumbnailHi?:string }} args.track
 * @param {Object} args.handlers
 * @param {() => void} [args.handlers.play]
 * @param {() => void} [args.handlers.pause]
 * @param {() => void} [args.handlers.previoustrack]
 * @param {() => void} [args.handlers.nexttrack]
 * @param {(seconds: number) => void} [args.handlers.seekbackward]
 * @param {(seconds: number) => void} [args.handlers.seekforward]
 * @param {(time: number) => void} [args.handlers.seekto]
 * @returns {() => void} dispose
 */
export function bindMediaSession({ track, handlers }) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return () => {};
  }

  const ms = navigator.mediaSession;
  const MediaMetadataCtor =
    typeof window !== 'undefined' && typeof window.MediaMetadata === 'function'
      ? window.MediaMetadata
      : null;

  if (track && MediaMetadataCtor) {
    const artwork = [];
    if (track.thumbnail) {
      artwork.push({ src: track.thumbnail, sizes: '480x360', type: 'image/jpeg' });
    }
    if (track.thumbnailHi && track.thumbnailHi !== track.thumbnail) {
      artwork.push({ src: track.thumbnailHi, sizes: '1280x720', type: 'image/jpeg' });
    }
    ms.metadata = new MediaMetadataCtor({
      title: track.title || 'YouTube',
      artist: track.author || '',
      album: 'Airwave',
      artwork
    });
  } else {
    ms.metadata = null;
  }

  const setHandler = (action, fn) => {
    try {
      ms.setActionHandler(action, fn || null);
    } catch {
      /* unsupported action — fine */
    }
  };

  const h = handlers || {};
  setHandler('play', h.play ? () => h.play() : null);
  setHandler('pause', h.pause ? () => h.pause() : null);
  setHandler('previoustrack', h.previoustrack ? () => h.previoustrack() : null);
  setHandler('nexttrack', h.nexttrack ? () => h.nexttrack() : null);
  setHandler(
    'seekbackward',
    h.seekbackward ? (details) => h.seekbackward(details?.seekOffset || 15) : null
  );
  setHandler(
    'seekforward',
    h.seekforward ? (details) => h.seekforward(details?.seekOffset || 15) : null
  );
  setHandler('seekto', h.seekto ? (details) => h.seekto(details?.seekTime || 0) : null);

  return function dispose() {
    setHandler('play', null);
    setHandler('pause', null);
    setHandler('previoustrack', null);
    setHandler('nexttrack', null);
    setHandler('seekbackward', null);
    setHandler('seekforward', null);
    setHandler('seekto', null);
    try {
      ms.metadata = null;
    } catch {
      /* ignore */
    }
  };
}

/**
 * Push lifecycle hints onto `mediaSession.playbackState` so the OS
 * UI shows the right play/pause icon. Cheap to call on every state
 * change.
 *
 * @param {'playing' | 'paused' | 'none'} state
 */
export function setPlaybackState(state) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}

/**
 * Update the position state (current time + duration + speed) so OS
 * scrubbers track playback. Skipped silently when not supported.
 *
 * @param {{ duration: number, position: number, playbackRate?: number }} state
 */
export function updatePosition(state) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  if (typeof navigator.mediaSession.setPositionState !== 'function') return;
  const duration = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 0;
  const position = Math.max(0, Math.min(duration || state.position, state.position || 0));
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position,
      playbackRate: Number.isFinite(state.playbackRate) ? state.playbackRate : 1
    });
  } catch {
    /* ignore — Chrome occasionally throws if duration is 0 mid-load */
  }
}
