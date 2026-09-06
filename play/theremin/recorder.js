/**
 * Capture a short video (audio + on-the-fly visualizer) of the user's
 * playing for sharing on social media.
 *
 * Static-site friendly — everything is client-side:
 *   - AnalyserNode + MediaStreamAudioDestinationNode tap the master
 *     gain *non-destructively* (parallel branches; the regular speaker
 *     output is unaffected).
 *   - A hidden 720×720 <canvas> renders a frequency-bar visualizer +
 *     current note label + branding strip; `canvas.captureStream(fps)`
 *     turns it into a video MediaStream.
 *   - The video and audio MediaStreams are combined and passed to
 *     `MediaRecorder`. Output mime is probed (webm/vp9, webm/vp8,
 *     mp4/h264) so the same code works on Chrome/Android (webm) and
 *     iOS Safari 14.5+ (mp4).
 *   - The result Blob is shown in a preview modal with three actions:
 *     Share (Web Share API with files), Download (anchor click),
 *     Discard. Share falls back to Download when canShare(files) is
 *     false (e.g. desktop browsers).
 *
 * Audio path:
 *   master  ──► destination (speaker)            (existing)
 *           ──► analyser (visualizer)            (parallel tap)
 *           ──► mediaStreamDestination (recorder) (parallel tap)
 *   mic     ──► micGain ──► mediaStreamDestination
 *     (only while recording with Voice toggle on; mic stream is
 *      acquired on each Record click and released on stop so the OS
 *      mic indicator only stays lit during the actual capture.)
 *
 * The mic is intentionally NOT routed to master/speakers — playing
 * it back through the same speakers that the mic is hearing would
 * loop into instant feedback. It's also not routed to the analyser:
 * the on-screen frequency-bar visualizer stays a clean view of the
 * theremin signal even when voice is mixed into the recording.
 *
 * Volume slider affects the recording (master is post-volume). That's
 * a deliberate simplification — recording at the heard mix is what
 * users intuitively expect, and avoids needing a separate "rec level"
 * control.
 */
import {
  beginAudioCapture,
  endAudioCapture,
  getCtx,
  getMaster,
  midiToName
} from '../shared/audio.js';
import { onMidi } from './voice.js';
import { getMidiRange } from './scale.js';

const RECORDING_W = 720;
const RECORDING_H = 720;
const RECORDING_FPS = 30;
const FREQ_BAR_COUNT = 48;

// Mime-type candidates in preference order.
//   - vp9 → vp8 → generic webm: covers Chromium / Firefox / Android.
//   - mp4/h264: only path that works on iOS Safari 14.5+.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4'
];

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4'
];
const POSTS_AUDIO_BITS_PER_SECOND = 8000;
// About 240k base64 characters; Posts splits this across Form responses.
const POSTS_AUDIO_MAX_BYTES = 180000;

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
};

const pickAudioMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
};

const extensionForMime = (mime) => {
  if (!mime) return 'webm';
  if (mime.startsWith('video/mp4')) return 'mp4';
  return 'webm';
};

/**
 * Strip codec parameters from a MIME type — e.g.
 *   'video/webm;codecs="vp9,opus"' → 'video/webm'
 *
 * The Web Share API's `canShare({ files })` allowlists generally
 * match on the *base* MIME type. Passing the codec-suffixed version
 * (which is what `Blob.type` reports back from MediaRecorder) makes
 * `canShare` return false on enough Android Chrome / iOS Safari
 * builds that the silent fallback to Download is the most common bug
 * report. The fix is just to feed `share()` a File whose .type is
 * the base MIME — the browser reads bytes from the underlying Blob
 * regardless of the .type string.
 */
const baseMime = (mime) => {
  if (!mime) return mime;
  const semi = mime.indexOf(';');
  return semi === -1 ? mime : mime.slice(0, semi).trim();
};

/**
 * @param {object} opts
 * @param {Array<{el: HTMLButtonElement, durationSec: number}>} opts.recordButtons
 * @param {HTMLElement} opts.modalEl
 * @param {HTMLVideoElement} opts.videoPreviewEl
 * @param {HTMLButtonElement} opts.shareBtn
 * @param {HTMLButtonElement} [opts.postBtn]
 * @param {HTMLButtonElement} opts.downloadBtn
 * @param {HTMLButtonElement} opts.discardBtn
 * @param {HTMLElement|null} opts.backdropEl
 * @param {HTMLVideoElement} opts.videoEl - air-mode webcam <video>
 * @param {HTMLCanvasElement} opts.overlayEl - air-mode hand-landmark canvas
 * @param {HTMLCanvasElement} [opts.paintEl] - paint-trail canvas; if
 *   present, its current contents are composited into every recorded
 *   frame (between the webcam and the hand skeleton in air mode, or
 *   over the gradient background in touch mode) so the recording
 *   captures whatever the user has been "drawing" with their fingertip.
 * @param {HTMLInputElement} [opts.micEl] - "Voice" checkbox. When
 *   checked, each Record click calls getUserMedia({audio:true}) and
 *   mixes the mic into the recorded audio track. On a denied
 *   permission we uncheck the box and add `.is-blocked` to its label
 *   so the UI honestly reflects the failure; the recording still
 *   completes (theremin-only) instead of aborting.
 * @param {HTMLElement} [opts.shareStatusEl] - inline `<p role=status>`
 *   inside the preview modal. The recorder writes "Sharing isn't
 *   supported here…" / "Share failed…" / "" into it so the user can
 *   see why a Share click might have just downloaded the file.
 * @param {() => {scale: string, root: number, range: number, glideMs: number}} opts.getCfg
 * @param {(open: boolean) => void} [opts.onPreviewToggle] - called with
 *   true when the preview modal opens, false when it closes. The
 *   coordinator uses this to suspend the live theremin so the
 *   recording-preview audio doesn't double up with the live voice.
 */
export const initRecorder = ({
  recordButtons,
  modalEl,
  videoPreviewEl,
  shareBtn,
  postBtn,
  downloadBtn,
  discardBtn,
  backdropEl,
  videoEl,
  overlayEl,
  paintEl,
  micEl,
  shareStatusEl,
  getCfg,
  onPreviewToggle
}) => {
  const mimeType = pickMimeType();
  const audioMimeType = pickAudioMimeType();
  if (!mimeType) {
    // No recorder support — disable the buttons with a hover hint
    // rather than hiding them, so it's discoverable that the feature
    // exists but isn't available in this browser.
    for (const b of recordButtons) {
      b.el.disabled = true;
      b.el.title = 'Recording is not supported in this browser.';
    }
    return;
  }

  // ---- Lazy audio taps -------------------------------------------------
  //
  // Created on first record click so we don't allocate AnalyserNode +
  // MediaStreamDestination for users who never record. Both connect
  // in parallel to master; neither affects the existing speaker path.

  let analyser = null;
  let analyserData = null;
  let recordDest = null;

  const ensureAudioTaps = () => {
    if (analyser) return;
    const ctx = getCtx();
    const master = getMaster();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; // 512 freq bins
    analyser.smoothingTimeConstant = 0.7;
    analyserData = new Uint8Array(analyser.frequencyBinCount);
    master.connect(analyser);

    recordDest = ctx.createMediaStreamDestination();
    master.connect(recordDest);
  };

  // ---- Optional mic input ---------------------------------------------
  //
  // Acquired per-recording so the OS mic indicator only stays on while
  // we're actually capturing. Routed through `micGain` (currently fixed
  // at 1.0; reserved as a future "mic level" control) into the same
  // recordDest the theremin master is tapped into — MediaRecorder only
  // encodes one audio track per stream, so we have to mix in Web Audio
  // *before* the destination node rather than passing two audio tracks.
  //
  // On a denied permission we add `.is-blocked` to the toggle's label
  // and uncheck the box. The class purely surfaces state — the
  // recorder doesn't gate on it; the next Record click will simply
  // re-attempt getUserMedia and either succeed (clearing the class)
  // or re-mark blocked.

  let micStream = null;
  let micSource = null;
  let micGain = null;
  // Balances the beginAudioCapture() claim so stopMicTap() releases it once,
  // including on the failure path (the catch below calls stopMicTap).
  let captureHeld = false;

  const micWrap = () => micEl?.closest('label') ?? null;

  const markMicBlocked = () => {
    if (!micEl) return;
    micEl.checked = false;
    const wrap = micWrap();
    if (wrap) {
      wrap.classList.add('is-blocked');
      wrap.title =
        "Mic is blocked in your browser's site settings — allow it there and re-tick Voice to retry.";
    }
    // Fire change so prefs persist the new (off) state, matching how
    // the user toggling it manually behaves.
    micEl.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clearMicBlocked = () => {
    const wrap = micWrap();
    if (!wrap) return;
    wrap.classList.remove('is-blocked');
    wrap.title = 'Include voice / mic in recordings';
  };

  const ensureMicTap = async () => {
    if (micStream) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      // Release the `playback` audio session before asking: iOS rejects mic
      // capture while the page holds it, and the rejection looks exactly
      // like a denied permission. Released here rather than after the await
      // because the await is what fails.
      beginAudioCapture();
      captureHeld = true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = getCtx();
      micStream = stream;
      micSource = ctx.createMediaStreamSource(stream);
      micGain = ctx.createGain();
      micGain.gain.value = 1.0;
      micSource.connect(micGain);
      micGain.connect(recordDest);
      clearMicBlocked();
      return true;
    } catch (err) {
      console.warn('Mic permission denied or unavailable', err);
      // Clean up partial state if any of the chain managed to attach
      // before the failure (defensive — getUserMedia rejecting before
      // resolve means there's no source node yet, but stay safe).
      stopMicTap();
      markMicBlocked();
      return false;
    }
  };

  const stopMicTap = () => {
    if (micSource) {
      try {
        micSource.disconnect();
      } catch (_) {
        /* ignore */
      }
      micSource = null;
    }
    if (micGain) {
      try {
        micGain.disconnect();
      } catch (_) {
        /* ignore */
      }
      micGain = null;
    }
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
    if (captureHeld) {
      captureHeld = false;
      endAudioCapture();
    }
  };

  const lockMicToggle = (locked) => {
    if (!micEl) return;
    micEl.disabled = locked;
    micEl.closest('label')?.classList.toggle('is-locked', locked);
  };

  // ---- Current note tracking ------------------------------------------
  //
  // voice.onMidi fires whenever the primary voice plays a note. We
  // store the most recent name and a timestamp so the visualizer can
  // show a big note label only while sound is actively being made.

  let currentNoteLabel = '';
  let lastNoteAt = 0;
  onMidi((midi) => {
    currentNoteLabel = midiToName(Math.round(midi));
    lastNoteAt = performance.now();
  });

  // ---- Hidden visualizer canvas ---------------------------------------

  const canvas = document.createElement('canvas');
  canvas.width = RECORDING_W;
  canvas.height = RECORDING_H;
  // Not appended to the DOM — captureStream still works. Keeps the
  // page free of an offscreen-but-rendered element.
  const ctx2d = canvas.getContext('2d');

  let drawRafId = null;
  let recordingStart = 0;
  let recordingTotalMs = 0;

  // ---- Scene helpers --------------------------------------------------

  /**
   * cover-fit: returns source-rectangle args for `drawImage` so the
   * source fills (dw, dh) without distortion, cropping the longer
   * axis equally on both sides.
   */
  const fitCover = (sw, sh, dw, dh) => {
    const scale = Math.max(dw / sw, dh / sh);
    const cropW = dw / scale;
    const cropH = dh / scale;
    return {
      sx: (sw - cropW) / 2,
      sy: (sh - cropH) / 2,
      sw: cropW,
      sh: cropH
    };
  };

  /**
   * Paints the live theremin pad's gradient stack (dark base + soft
   * indigo/pink radial accents) into the given canvas rectangle.
   * Mirrors what `.theremin-pad`'s CSS produces on screen.
   */
  const drawPadBackground = (ctx, x, y, w, h) => {
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, '#1e293b');
    bg.addColorStop(1, '#0b1224');
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);

    const top = ctx.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, w * 0.6);
    top.addColorStop(0, 'rgba(129, 140, 248, 0.28)');
    top.addColorStop(1, 'transparent');
    ctx.fillStyle = top;
    ctx.fillRect(x, y, w, h);

    const bot = ctx.createRadialGradient(x + w / 2, y + h, 0, x + w / 2, y + h, w * 0.6);
    bot.addColorStop(0, 'rgba(244, 114, 182, 0.28)');
    bot.addColorStop(1, 'transparent');
    ctx.fillStyle = bot;
    ctx.fillRect(x, y, w, h);
  };

  /**
   * Re-creates the pad's chromatic-step grid (vertical lines at every
   * semitone, root + C highlighted, plus volume thirds) directly on
   * the recording canvas. Uses the same scale config the audio voice
   * is reading from so it's always in sync with what's being played.
   */
  const drawGridOnCanvas = (ctx, x, y, w, h, scaleCfg) => {
    const { startMidi, endMidi } = getMidiRange(scaleCfg);
    const span = endMidi - startMidi;
    const root = scaleCfg.root;

    for (let m = startMidi; m <= endMidi; m++) {
      const xn = (m - startMidi) / span;
      const lineX = x + xn * w;
      let color = 'rgba(148, 163, 184, 0.10)';
      let lw = 1;
      if (m % 12 === root) {
        color = 'rgba(244, 114, 182, 0.45)';
        lw = 1.5;
      } else if (m % 12 === 0) {
        color = 'rgba(129, 140, 248, 0.35)';
        lw = 1.5;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(lineX, y);
      ctx.lineTo(lineX, y + h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const ly = y + (i * h) / 4;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
    }
  };

  /**
   * Composite the paint-trail canvas, if present and non-empty, into
   * the recording. Mirrors the live z-stack: paint goes between the
   * webcam (or freq bars) and the hand-skeleton overlay so the
   * skeleton stays on top, exactly like on screen.
   */
  const drawPaintLayer = (ctx, x, y, w, h) => {
    if (!paintEl) return;
    if (!paintEl.width || !paintEl.height) return;
    ctx.drawImage(paintEl, x, y, w, h);
  };

  /**
   * Air-mode pad scene: webcam frame (mirrored, cover-fit, slightly
   * faded so the hand skeleton overlay reads on top of it) + paint
   * trail (if any) + the live overlay canvas (already mirror-correct,
   * drawn unflipped) + grid lines on top.
   */
  const drawAirPadContent = (ctx, x, y, w, h) => {
    if (videoEl?.videoWidth) {
      const fc = fitCover(videoEl.videoWidth, videoEl.videoHeight, w, h);
      ctx.save();
      // Match the live `.theremin-video { opacity: 0.45 }` plus a
      // little extra brightness so the recording reads better when
      // someone scrubs through it on a small phone screen.
      ctx.globalAlpha = 0.6;
      // Horizontal mirror to match the live `transform: scaleX(-1)`
      // — drawImage from a video element pulls the un-mirrored
      // frame, so we flip the canvas locally.
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, fc.sx, fc.sy, fc.sw, fc.sh, 0, 0, w, h);
      ctx.restore();
    }
    drawPaintLayer(ctx, x, y, w, h);
    if (overlayEl?.width > 0 && overlayEl?.height > 0) {
      // Overlay is already painted in mirrored pad-coords (drawHands
      // uses (1 - x) * padW), so draw it directly without flipping.
      ctx.drawImage(overlayEl, x, y, w, h);
    }
  };

  /**
   * Touch-mode pad scene: pad gradient (drawn by caller) + a centred
   * frequency-bar audio visualizer in the lower half so there's
   * something reactive on screen even though there's no camera feed,
   * + paint trail on top so finger-drawn streaks are visible in the
   * recording.
   */
  const drawTouchPadContent = (ctx, x, y, w, h) => {
    analyser.getByteFrequencyData(analyserData);
    const bars = FREQ_BAR_COUNT;
    const totalBins = analyserData.length;
    // Use only the lower 75% of bins — anything above ~16kHz is
    // mostly empty for theremin/sine sources and would just waste
    // visualizer width.
    const usableBins = Math.floor(totalBins * 0.75);
    const binsPerBar = Math.max(1, Math.floor(usableBins / bars));
    const barAreaH = h * 0.45;
    const barAreaTop = y + h * 0.45;
    const barW = w / bars;
    const barInner = barW * 0.7;
    const barX0 = x + barW * 0.15;
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < binsPerBar; j++) {
        sum += analyserData[i * binsPerBar + j];
      }
      const avg = sum / binsPerBar / 255;
      const bh = avg * barAreaH;
      const bx = i * barW + barX0;
      const by = barAreaTop + barAreaH - bh;

      const grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, 'rgba(244, 114, 182, 0.95)');
      grad.addColorStop(1, 'rgba(129, 140, 248, 0.85)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(129, 140, 248, 0.6)';
      ctx.shadowBlur = 18;
      ctx.fillRect(bx, by, barInner, Math.max(2, bh));
    }
    ctx.shadowBlur = 0;

    drawPaintLayer(ctx, x, y, w, h);
  };

  // ---- Main draw loop -------------------------------------------------

  const drawFrame = () => {
    if (!analyser) return;
    const W = RECORDING_W;
    const H = RECORDING_H;
    const elapsed = performance.now() - recordingStart;
    const progress = Math.max(0, Math.min(1, elapsed / recordingTotalMs));

    // Pad area fills almost the whole canvas; a thin strip at the
    // bottom is reserved for branding so neither obscures the other.
    const PAD_BOTTOM_STRIP = 60;
    const padX = 0;
    const padY = 0;
    const padW = W;
    const padH = H - PAD_BOTTOM_STRIP;

    drawPadBackground(ctx2d, padX, padY, padW, padH);

    // Air mode = webcam present + decoded. videoWidth flips to a real
    // value once the first frame is decoded (post-permission-grant).
    const isAir = !!(videoEl && videoEl.videoWidth);
    if (isAir) {
      drawAirPadContent(ctx2d, padX, padY, padW, padH);
    } else {
      drawTouchPadContent(ctx2d, padX, padY, padW, padH);
    }

    // Grid is rendered on top of the pad content in both modes —
    // keeps the note-position reference visible whether the user
    // is in air or touch mode.
    drawGridOnCanvas(ctx2d, padX, padY, padW, padH, getCfg());

    // ---- Note label (small, top-center) ----
    // 700 ms fade after the last applyPrimary fired so the label
    // disappears on note release rather than ghosting on screen.
    if (currentNoteLabel && performance.now() - lastNoteAt < 700) {
      ctx2d.save();
      ctx2d.font = 'bold 48px system-ui, -apple-system, sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillStyle = 'rgba(252, 211, 230, 0.95)';
      ctx2d.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx2d.shadowBlur = 8;
      ctx2d.fillText(currentNoteLabel, W / 2, 50);
      ctx2d.restore();
    }

    // ---- Progress arc (top-right corner) ----
    const cx = W - 40;
    const cy = 40;
    const r = 18;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx2d.strokeStyle = 'rgba(244, 114, 182, 0.95)';
    ctx2d.lineWidth = 4;
    ctx2d.lineCap = 'round';
    ctx2d.stroke();

    // ---- Branding strip (bottom) ----
    // Subtle dark band so the text reads regardless of the pad
    // content above. Two lines: title + URL.
    const stripY = padH;
    ctx2d.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx2d.fillRect(0, stripY, W, PAD_BOTTOM_STRIP);
    ctx2d.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillStyle = 'rgba(226, 232, 240, 0.92)';
    ctx2d.fillText('Theremin', W / 2, stripY + 22);
    ctx2d.font = '13px system-ui, -apple-system, sans-serif';
    ctx2d.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx2d.fillText('joeheyming.github.io/play/theremin', W / 2, stripY + 44);

    drawRafId = requestAnimationFrame(drawFrame);
  };

  // ---- Recorder state -------------------------------------------------

  let recorder = null;
  let chunks = [];
  let audioRecorder = null;
  let audioChunks = [];
  let activeBtn = null;
  let countdownTimer = null;
  let stopTimer = null;
  let lastRecording = null; // Blob
  let lastAudioRecording = null; // low-bitrate Blob for Posts
  /** @type {(text: string, opts?: {level?: string, sticky?: boolean}) => void} */
  let setShareStatus = () => {};

  // Cooperative cancel: while ensureMicTap is awaiting the
  // permission prompt, the user may click the active button to
  // bail out. We can't actually abort getUserMedia, but once it
  // resolves we check this flag and skip starting the recorder.
  let startupAborted = false;

  const setPostButtonState = (state, detail = '') => {
    if (!postBtn) return;
    if (state === 'ready') {
      postBtn.disabled = false;
      postBtn.title = 'Create a post with this recording’s audio';
      return;
    }
    postBtn.disabled = true;
    if (state === 'preparing') {
      postBtn.title = 'Preparing the audio-only copy…';
    } else if (state === 'unsupported') {
      postBtn.title = 'Audio posting is not supported in this browser';
    } else if (state === 'too-large') {
      postBtn.title = detail || 'This audio is too large for Posts';
      setShareStatus(detail || 'Audio is too large for Posts — try stopping sooner.', {
        level: 'error',
        sticky: true
      });
    } else if (state === 'empty') {
      postBtn.title = 'Could not capture audio for posting';
      setShareStatus('Could not capture audio for posting.', { level: 'error', sticky: true });
    }
  };

  /**
   * Keep the complete audio capture. Posts chunks its data URL across
   * multiple Form responses rather than silently trimming the clip.
   * @param {Blob} blob
   */
  const finalizePostsAudio = (blob) => {
    if (!postBtn) return;
    if (!(blob instanceof Blob) || blob.size === 0) {
      setPostButtonState('empty');
      return;
    }
    if (blob.size <= POSTS_AUDIO_MAX_BYTES) {
      lastAudioRecording = blob;
      setPostButtonState('ready');
      setShareStatus(`Ready to post the full ${Math.round(blob.size / 1024)} KB audio clip.`);
      return;
    }
    lastAudioRecording = null;
    setPostButtonState(
      'too-large',
      'This complete recording is too large for Posts. Use the 10-second recorder or stop sooner.'
    );
  };

  const resetButtonsToIdle = () => {
    for (const b of recordButtons) {
      b.el.classList.remove('is-recording', 'is-disabled');
      b.el.disabled = false;
      b.el.textContent = `Rec ${b.durationSec}s`;
    }
    activeBtn = null;
    lockMicToggle(false);
  };

  const stopRecording = () => {
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {
        /* ignore */
      }
    } else if (activeBtn) {
      // Pre-recording state — the user clicked stop before the mic
      // prompt resolved (or before MediaRecorder was constructed).
      // Reset directly here since recorder.onstop won't fire.
      startupAborted = true;
      stopMicTap();
      resetButtonsToIdle();
    }
    if (audioRecorder && audioRecorder.state !== 'inactive') {
      try {
        audioRecorder.requestData?.();
        audioRecorder.stop();
      } catch (_) {
        /* ignore */
      }
    }
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (drawRafId !== null) {
      cancelAnimationFrame(drawRafId);
      drawRafId = null;
    }
  };

  const startRecording = async (durationSec) => {
    ensureAudioTaps();

    startupAborted = false;
    lockMicToggle(true);

    // Acquire mic *before* MediaRecorder construction so the mixed
    // audio track is the one that gets encoded from frame zero.
    // Awaiting the permission prompt here means the first record-with-
    // voice click in a session will visibly pause until the user
    // grants/denies; the Rec button stays in its "Stop (Ns)" state
    // during that window so they can cancel.
    if (micEl?.checked) {
      const ok = await ensureMicTap();
      if (!ok) {
        // Permission denied / unavailable — markMicBlocked already
        // unchecked the box and added the (blocked) hint. Fall through
        // and record without mic; users still get a usable clip.
      }
    }

    if (startupAborted) {
      stopMicTap();
      return;
    }

    // Combine the canvas video and master audio into one stream. Two
    // independent track sets get fed to MediaRecorder as a single
    // MediaStream — the recorder muxes them into the chosen container.
    const videoStream = canvas.captureStream(RECORDING_FPS);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...recordDest.stream.getAudioTracks()
    ]);

    chunks = [];
    audioChunks = [];
    lastAudioRecording = null;
    let audioTrackClones = [];
    setPostButtonState(audioMimeType ? 'preparing' : 'unsupported');
    try {
      recorder = new MediaRecorder(combined, { mimeType });
    } catch (err) {
      console.warn('MediaRecorder construction failed', err);
      stopMicTap();
      resetButtonsToIdle();
      return;
    }

    if (audioMimeType) {
      try {
        // Clone tracks so the audio-only recorder doesn't fight the
        // video MediaRecorder over the same MediaStreamTrack.
        audioTrackClones = recordDest.stream.getAudioTracks().map((t) => t.clone());
        const audioOnlyStream = new MediaStream(audioTrackClones);
        audioRecorder = new MediaRecorder(audioOnlyStream, {
          mimeType: audioMimeType,
          audioBitsPerSecond: POSTS_AUDIO_BITS_PER_SECOND
        });
        audioRecorder.ondataavailable = (event) => {
          if (event.data?.size) audioChunks.push(event.data);
        };
        audioRecorder.onstop = () => {
          for (const track of audioTrackClones) {
            try {
              track.stop();
            } catch (_) {
              /* ignore */
            }
          }
          audioTrackClones = [];
          void finalizePostsAudio(new Blob(audioChunks, { type: audioMimeType }));
        };
      } catch (err) {
        console.warn('Audio-only MediaRecorder construction failed', err);
        audioRecorder = null;
        for (const track of audioTrackClones) {
          try {
            track.stop();
          } catch (_) {
            /* ignore */
          }
        }
        audioTrackClones = [];
        setPostButtonState('unsupported');
      }
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      lastRecording = blob;
      // Release the mic now that we're done — keeps the OS indicator
      // off while the user reviews the preview, and matches the
      // "mic only on while recording" mental model.
      stopMicTap();
      resetButtonsToIdle();
      showPreview(blob);
    };

    recordingStart = performance.now();
    recordingTotalMs = durationSec * 1000;

    // Draw at least one frame *before* starting MediaRecorder — some
    // browsers stall captureStream until the canvas has had a paint.
    drawFrame();
    recorder.start();
    try {
      // timeslice keeps chunks flowing; some browsers buffer until stop otherwise.
      audioRecorder?.start(1000);
    } catch (err) {
      console.warn('Audio-only recording failed to start', err);
      audioRecorder = null;
      setPostButtonState('unsupported');
    }

    // Auto-stop after the chosen duration. The exact-length cap is
    // important: shareable clips have known durations.
    stopTimer = setTimeout(() => stopRecording(), recordingTotalMs);

    // Live countdown on the active button so the user can see how
    // much time is left without watching a separate timer.
    countdownTimer = setInterval(() => {
      if (!activeBtn) return;
      const remain = Math.max(
        0,
        Math.ceil((recordingTotalMs - (performance.now() - recordingStart)) / 1000)
      );
      activeBtn.el.textContent = `Stop (${remain}s)`;
    }, 100);
  };

  const onRecordButtonClick = (btnDef) => {
    if (activeBtn) {
      // Re-clicking the active button stops early. Other buttons are
      // disabled while recording, so this is the only way to land here.
      if (activeBtn === btnDef) stopRecording();
      return;
    }
    activeBtn = btnDef;
    for (const b of recordButtons) {
      b.el.classList.toggle('is-recording', b === btnDef);
      b.el.classList.toggle('is-disabled', b !== btnDef);
      b.el.disabled = b !== btnDef;
    }
    btnDef.el.textContent = `Stop (${btnDef.durationSec}s)`;
    startRecording(btnDef.durationSec);
  };

  for (const b of recordButtons) {
    b.el.addEventListener('click', () => onRecordButtonClick(b));
  }

  // Re-checking Voice after a previous denial clears the (blocked)
  // hint optimistically so the toggle looks fresh; the next Record
  // press will re-attempt getUserMedia and either succeed (and keep
  // it clear) or re-mark blocked.
  if (micEl) {
    micEl.addEventListener('change', () => {
      if (micEl.checked) clearMicBlocked();
    });
  }

  // ---- Preview / share modal -----------------------------------------

  let previewObjectUrl = null;
  let shareStatusTimer = null;

  /**
   * Set the inline status line below the action buttons. `''` clears
   * it. Auto-clears after a few seconds for transient messages so
   * the modal doesn't keep stale text around.
   *
   *   level:  'info' | 'error' — purely cosmetic (controls colour).
   *   sticky: true to leave the message until manually cleared.
   */
  setShareStatus = (text, { level = 'info', sticky = false } = {}) => {
    if (!shareStatusEl) return;
    if (shareStatusTimer) {
      clearTimeout(shareStatusTimer);
      shareStatusTimer = null;
    }
    shareStatusEl.textContent = text;
    shareStatusEl.classList.toggle('is-error', level === 'error');
    shareStatusEl.hidden = !text;
    if (text && !sticky) {
      shareStatusTimer = setTimeout(() => {
        shareStatusEl.hidden = true;
        shareStatusEl.textContent = '';
        shareStatusEl.classList.remove('is-error');
        shareStatusTimer = null;
      }, 4000);
    }
  };

  /**
   * Build the File we'll hand to Web Share. Always uses the *base*
   * MIME type from `Blob.type` so the browser's canShare allowlist
   * accepts it — the codec-suffixed version (e.g. video/webm;codecs=
   * "vp9,opus") fails the canShare check on enough Android / iOS
   * builds that we'd silently fall through to download instead of
   * opening the share sheet.
   */
  const buildShareFile = (blob, filename) =>
    new File([blob], filename, { type: baseMime(blob.type) || blob.type });

  /**
   * Probe whether the platform claims it can share *this exact* file.
   * Used both to decide if Share button should be visible and as the
   * gate before we actually call `share()`. Centralised so both call
   * sites are guaranteed to agree.
   */
  const canShareFile = (file) => {
    if (!(navigator.canShare && typeof navigator.share === 'function')) return false;
    try {
      return navigator.canShare({ files: [file] });
    } catch (_) {
      return false;
    }
  };

  const closePreview = () => {
    modalEl.hidden = true;
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    videoPreviewEl.pause?.();
    videoPreviewEl.removeAttribute('src');
    videoPreviewEl.load?.();
    setShareStatus('');
    onPreviewToggle?.(false);
  };

  const showPreview = (blob) => {
    previewObjectUrl = URL.createObjectURL(blob);
    videoPreviewEl.src = previewObjectUrl;
    videoPreviewEl.load?.();
    modalEl.hidden = false;
    // Don't wipe a "shrinking audio…" / ready message from finalizePostsAudio.
    if (!lastAudioRecording && postBtn?.disabled) {
      setShareStatus(postBtn.title || 'Preparing the audio-only copy…', { sticky: true });
    } else {
      setShareStatus('');
    }
    onPreviewToggle?.(true);
    // Try autoplay (muted off — user explicitly hit record, so they
    // expect to hear the result). If the browser blocks autoplay,
    // they can hit play in the controls.
    videoPreviewEl.play?.().catch(() => {
      /* autoplay blocked — user can press play */
    });

    // Hide Share only if the platform genuinely can't share files at
    // all. Desktop Chrome/Firefox return false; iOS Safari + Android
    // Chrome return true.
    const ext = extensionForMime(mimeType);
    const filename = `theremin-${Date.now()}.${ext}`;
    const probeFile = buildShareFile(blob, filename);
    shareBtn.hidden = !canShareFile(probeFile);
    shareBtn.dataset.filename = filename;

    if (lastAudioRecording) setPostButtonState('ready');
  };

  const downloadCurrent = () => {
    if (!lastRecording) return;
    const ext = extensionForMime(mimeType);
    const filename = `theremin-${Date.now()}.${ext}`;
    const url = URL.createObjectURL(lastRecording);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a bit so the download has time to start on slower
    // browsers; the URL is only used for the click() above.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /**
   * Open the system share sheet with the recorded clip.
   *
   * NOT async on purpose — `navigator.share()` consumes the click's
   * "transient activation" gesture, and on some Android Chrome
   * builds wrapping the call in an async function (or putting any
   * `await` before it) is enough to make the browser treat it as
   * non-user-initiated and silently reject. Calling it from the
   * synchronous body of the click handler and chaining `.catch()`
   * keeps activation intact.
   */
  const shareCurrent = () => {
    if (!lastRecording) return;
    const ext = extensionForMime(mimeType);
    const filename = shareBtn.dataset.filename || `theremin-${Date.now()}.${ext}`;
    const file = buildShareFile(lastRecording, filename);

    if (!canShareFile(file)) {
      // Either the API is missing entirely (desktop Firefox, older
      // browsers) or the platform won't share a video/* file. Fall
      // through to a download and tell the user why so the click
      // doesn't feel broken.
      setShareStatus("Your browser can't open the system share sheet here — downloading instead.");
      downloadCurrent();
      return;
    }

    const sharePromise = navigator.share({
      files: [file],
      title: 'Theremin',
      text: 'Made with the browser theremin → joeheyming.github.io/play/theremin'
    });

    // `share()` always returns a Promise; we don't await it (see
    // doc comment above) but we still need .catch for error
    // reporting + .then to clear the status on success.
    sharePromise
      .then(() => {
        setShareStatus('Shared.');
      })
      .catch((err) => {
        // AbortError = user dismissed the share sheet — not a
        // failure, just cancellation. Don't fall back to download
        // for that.
        if (err && err.name === 'AbortError') {
          setShareStatus('');
          return;
        }
        console.warn('Share failed, falling back to download', err);
        setShareStatus(`Share didn't work (${err?.name || 'error'}) — downloaded instead.`, {
          level: 'error'
        });
        downloadCurrent();
      });
  };

  const postAudioCurrent = async () => {
    if (!lastAudioRecording) {
      setShareStatus('Audio isn’t ready to post yet. Wait a moment, or record again.', {
        level: 'error'
      });
      return;
    }
    try {
      postBtn.disabled = true;
      setShareStatus('Opening Posts with the audio…', { sticky: true });
      const { share } = await import('/posts/share-client.js');
      await share({
        text: '🎵 Theremin recording\n\nMade with [Theremin](/play/theremin/)',
        attachments: [lastAudioRecording]
      });
    } catch (err) {
      console.warn('Posting Theremin audio failed', err);
      postBtn.disabled = false;
      setShareStatus('Could not prepare the audio post.', { level: 'error' });
    }
  };

  shareBtn.addEventListener('click', shareCurrent);
  postBtn?.addEventListener('click', postAudioCurrent);
  downloadBtn.addEventListener('click', downloadCurrent);
  discardBtn.addEventListener('click', closePreview);
  if (backdropEl) backdropEl.addEventListener('click', closePreview);
};
