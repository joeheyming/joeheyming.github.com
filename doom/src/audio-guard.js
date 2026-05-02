// Audio guard for the Doom WASM runtime.
//
// Loaded BEFORE doom.js. Monkey-patches AudioContext.prototype.decodeAudioData
// so that the Emscripten-generated bundle's calls (which pass only a success
// callback) don't leak decoding failures as unhandled promise rejections.
//
// Production analytics showed floods of:
//   unhandled_promise_rejection: EncodingError: Unable to decode audio data
//   unhandled_promise_rejection: EncodingError: Decoding failed
//   unhandled_promise_rejection: EncodingError: The buffer passed to
//     decodeAudioData contains an unknown ...
// affecting ~150 distinct users. Those all originate in the generated bundle
// calling `context.decodeAudioData(audio, successCb)` with no error callback.
// When decoding fails for non-PCM music (MIDI/MUS) or on Safari's stricter
// decoder, the returned Promise rejects with nothing catching it.
//
// Behavior parity note: upstream wasm-doom *also* never triggered the MIDI
// fallback on decode failures - its outer .catch() only ran for fetch
// errors, so a failed decode silently left the current track with no
// music and the game continued. We preserve that behavior here; the only
// change is that the rejection is now caught instead of escaping to
// `window.onunhandledrejection`.
//
// By hardening the prototype here (instead of patching the generated JS)
// the fix survives any rebuild of doom.js from upstream wasm-doom.
(function installDoomAudioGuard() {
  if (typeof window === 'undefined') return;

  /** @type {typeof AudioContext | undefined} */
  const Ctor =
    typeof window.AudioContext !== 'undefined'
      ? window.AudioContext
      : typeof window.webkitAudioContext !== 'undefined'
      ? window.webkitAudioContext
      : undefined;

  if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.decodeAudioData !== 'function') {
    return;
  }

  const proto = Ctor.prototype;
  const HARDENED_FLAG = '__doomAudioGuardApplied';
  if (proto[HARDENED_FLAG]) return;

  const originalDecode = proto.decodeAudioData;

  proto.decodeAudioData = function patchedDecodeAudioData(buffer, onSuccess, onError) {
    const safeError = (err) => {
      if (typeof onError === 'function') {
        try {
          onError(err);
        } catch (_) {
          // swallow caller's error handler throwing
        }
      }
      // intentionally no fallback dispatch: see top-of-file note
    };

    let result;
    try {
      result = originalDecode.call(this, buffer, onSuccess, safeError);
    } catch (err) {
      safeError(err);
      return Promise.reject(err);
    }

    if (result && typeof result.catch === 'function') {
      // Attach a catch so the Promise form (spec behavior when no error
      // callback is provided) doesn't become an unhandled rejection.
      result.catch(safeError);
    }

    return result;
  };

  Object.defineProperty(proto, HARDENED_FLAG, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
})();
