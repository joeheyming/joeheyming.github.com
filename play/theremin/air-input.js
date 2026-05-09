/**
 * Air mode: front-camera + MediaPipe Hands. Loads MediaPipe lazily on
 * first use (touch-mode users never download the ~7 MB WASM + model).
 *
 * Once running, a `requestAnimationFrame` loop feeds the live <video>
 * to `HandLandmarker.detectForVideo`. Detected hand(s) drive the same
 * audio voice as touch mode via voice.applyPrimary / voice.applyVibrato,
 * so scale snapping, glide, and volume curves carry over for free.
 *
 * Coordinate convention:
 *   - MediaPipe returns landmarks with x ∈ [0..1] left→right of the raw
 *     (un-mirrored) frame, y ∈ [0..1] top→bottom.
 *   - We display the video mirrored horizontally (CSS scaleX(-1)) so
 *     the user feels like they're looking in a mirror — that means
 *     the user's right hand appears on the right side of the screen.
 *   - To map to pad-style "X = pitch (left=low, right=high)", we
 *     compute padX = 1 - landmark.x.
 *   - Volume in air mode is *depth* (hand-to-camera distance), not
 *     screen-Y — that's how a real theremin's volume antenna works
 *     (and matches what users intuitively try). landmark.z from
 *     MediaPipe is too noisy to use directly, so we approximate
 *     depth from the apparent size of the hand in the frame: the
 *     wrist↔middle-MCP distance, normalized against the running
 *     min/max observed this session (`handDepth` below).
 *   - MediaPipe's handedness output assumes a *mirrored* input frame.
 *     We feed it un-mirrored, so its "Right" label corresponds to the
 *     user's left hand and vice versa — we flip the labels on read.
 *
 * State machine:
 *   idle        → mode is 'touch' (or first paint)
 *   prompt      → air mode requested, awaiting "Allow camera" tap
 *   loading     → tapped Allow; downloading MediaPipe + opening camera
 *   running     → detection loop active, audio bound to hands
 *   denied      → permission refused; retry button offered
 *   error       → MediaPipe / camera failed; retry button offered
 *   unavailable → camera API missing for this origin (insecure / WebView)
 */
import { xToMidi } from './scale.js';
import {
  ensureVoice,
  applyPrimary,
  applyVibrato,
  clearVibrato,
  fadeInVoice,
  fadeOutVoice
} from './voice.js';

// MediaPipe Hand-landmark connection list (21 landmarks per hand).
// Source: github.com/google-ai-edge/mediapipe spec.
const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4], // thumb
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8], // index
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12], // middle
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16], // ring
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20], // pinky
  [0, 17] // palm closure
];
const TIP_LANDMARK = 8; // index fingertip — drives pitch/volume

// Depth (volume) calibration seeds. See handDepth() inside
// initAirInput for the running-min/max self-calibration logic.
// Initial seeds picked so the very first detected frame doesn't
// immediately clip to 0 or 1 — they get widened on the first big
// movement.
const RAW_DEPTH_INITIAL_MIN = 0.1;
const RAW_DEPTH_INITIAL_MAX = 0.3;

// ~6 frames at 30 fps ≈ 200 ms grace before fading out the voice if
// no hand is visible — single dropped detections shouldn't kill it.
const NO_HAND_GRACE_FRAMES = 6;

/**
 * Lazy-loaded MediaPipe HandLandmarker. Module-level so subsequent
 * enters into air mode reuse the same detector.
 */
let handLandmarker = null;

const ensureHandLandmarker = async () => {
  if (handLandmarker) return handLandmarker;
  // Dynamic ESM import from jsdelivr's automatic ESM build. Pinning
  // to 0.10.20 — newer versions (0.10.22, 0.10.30) have intermittently
  // failed to publish to jsdelivr; 0.10.34/0.10.35 work but are too
  // recent to trust without integration testing. 0.10.20 has been
  // stable in the wild since 2024.
  const visionModule = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm'
  );
  const { HandLandmarker, FilesetResolver } = visionModule;
  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm'
  );
  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2
  });
  return handLandmarker;
};

/**
 * Wire air-mode handlers around the supplied DOM nodes. Returns
 * `{ enter, exit }` so the coordinator can imperatively flip in/out
 * of air mode when the mode <select> changes.
 *
 *   getCfg()             → { scale, root, range, glideMs } (per-frame live)
 *   getInputsSuspended() → true while a modal/dialog is up; we keep the
 *                          camera running but pause audio + draw work
 *                          so the recording-preview modal doesn't have
 *                          a live theremin playing behind it.
 *   setTip()             → optional callback; called with { xNorm, yNorm }
 *                          on every detect frame that has a primary
 *                          hand and `null` when no hand is visible.
 *                          Drives the paint trail (and any future
 *                          tip-following effect).
 */
export const initAirInput = ({
  padEl,
  videoEl,
  overlayEl,
  airCardEl,
  airCardTitleEl,
  airCardMessageEl,
  airStartBtn,
  getCfg,
  getInputsSuspended,
  setTip
}) => {
  const overlayCtx = overlayEl.getContext('2d');

  let airState = 'idle';
  let mediaStream = null;
  let rafId = null;
  let lastDetectMs = 0;
  // `airVoiceOn` is set false when no hand has been visible for a few
  // frames so the voice can fade out cleanly; flipped back true on
  // the next detection.
  let airVoiceOn = false;
  let noHandFrames = 0;

  // ---- Depth (volume) calibration ----
  //
  // Different cameras (FOV) and different users (hand size) produce
  // wildly different raw values, so we self-calibrate: keep a running
  // min/max over this session and stretch to fit. Reset every time
  // we (re)start air mode.
  let depthMin = RAW_DEPTH_INITIAL_MIN;
  let depthMax = RAW_DEPTH_INITIAL_MAX;

  const resetDepthCalibration = () => {
    depthMin = RAW_DEPTH_INITIAL_MIN;
    depthMax = RAW_DEPTH_INITIAL_MAX;
  };

  /**
   * Returns 0..1 where 0 = hand far from camera and 1 = hand close.
   * Side-effect: expands the running [depthMin, depthMax] window
   * monotonically so the very first session settles into a useful
   * range within a few seconds of normal play.
   */
  const handDepth = (landmarks) => {
    const a = landmarks[0]; // wrist
    const b = landmarks[9]; // middle MCP
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const raw = Math.hypot(dx, dy);
    if (raw < depthMin) depthMin = raw;
    if (raw > depthMax) depthMax = raw;
    const span = Math.max(0.001, depthMax - depthMin);
    return Math.max(0, Math.min(1, (raw - depthMin) / span));
  };

  /**
   * Render the air-mode status card. `messageHTML` is *trusted markup*
   * built only from string literals in this file — never user input —
   * so writing it via innerHTML is safe and lets us include clickable
   * help links (e.g. the dev-CA install URL).
   */
  const showAirCard = ({ title, message, messageHTML, buttonLabel, busy = false }) => {
    airCardTitleEl.textContent = title;
    if (messageHTML) {
      airCardMessageEl.innerHTML = messageHTML;
    } else {
      airCardMessageEl.textContent = message ?? '';
    }
    if (buttonLabel) {
      airStartBtn.textContent = buttonLabel;
      airStartBtn.disabled = busy;
      airStartBtn.hidden = false;
    } else {
      airStartBtn.hidden = true;
    }
    airCardEl.hidden = false;
  };

  const hideAirCard = () => {
    airCardEl.hidden = true;
  };

  /**
   * Diagnostic card content for "camera API not available" — the most
   * common reason air mode fails on a phone. Detects the two cases
   * we can usefully steer the user out of:
   *
   *   1. The page is on the local mkcert dev server (port 8443, LAN
   *      IP) AND the phone hasn't installed the mkcert root CA. The
   *      dev origin therefore looks insecure to Android Chrome,
   *      which blanks `navigator.mediaDevices`. We surface a one-tap
   *      link to `/dev-ca.pem` (served by `scripts/dev-server.py`).
   *   2. The page is on a regular insecure origin (http://, file://,
   *      etc.). We just say "needs HTTPS".
   *
   * If `isSecureContext` is true but the API is still missing, the
   * browser itself doesn't expose camera access (rare on modern
   * phones; in-app webviews are the usual offender).
   */
  const buildCameraUnavailableCard = () => {
    const isLocalHostLike =
      /^(localhost|127\.|::1$|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(
        location.hostname
      );
    const insecure = !window.isSecureContext;

    if (insecure && isLocalHostLike) {
      return {
        title: 'Air mode needs a trusted dev cert',
        messageHTML:
          "Your phone doesn't yet trust this dev server's certificate, so " +
          'Chrome blocks camera access. ' +
          '<a href="/dev-ca.pem" download="dev-ca.pem" style="color:#a5b4fc;">' +
          'Tap here to download the dev CA</a>, ' +
          'then install it under <em>Settings → Security → Encryption ' +
          '&amp; credentials → Install a certificate → CA certificate</em>. ' +
          'Reload this page after installing.'
      };
    }
    if (insecure) {
      return {
        title: 'Air mode needs HTTPS',
        message:
          'Camera access is only allowed from a secure (https://) origin. Open this page over HTTPS and try again.'
      };
    }
    return {
      title: "Camera API isn't available here",
      message:
        'This browser blocks the camera API. Try Chrome on Android, Safari on iOS, or a desktop Chrome / Firefox.'
    };
  };

  const setAirState = (next) => {
    airState = next;
    switch (next) {
      case 'prompt':
        showAirCard({
          title: 'Air mode',
          message:
            'Wave your hand in front of the camera to play — left ↔ right for pitch, ' +
            "lean in or out for volume. We'll need camera access; hand tracking runs " +
            'on your device and video never leaves this page.',
          buttonLabel: 'Allow camera'
        });
        break;
      case 'loading':
        showAirCard({
          title: 'Starting camera…',
          message: 'Loading hand-tracking model.',
          buttonLabel: 'Loading…',
          busy: true
        });
        break;
      case 'running':
        hideAirCard();
        break;
      case 'denied':
        showAirCard({
          title: 'Camera blocked',
          message:
            "Air mode needs camera access. Allow it in your browser's site settings, then tap Retry.",
          buttonLabel: 'Retry'
        });
        break;
      case 'error':
        showAirCard({
          title: "Couldn't start air mode",
          message: 'Hand-tracking failed to load. Check your connection and tap Retry.',
          buttonLabel: 'Retry'
        });
        break;
      case 'unavailable': {
        const card = buildCameraUnavailableCard();
        showAirCard({ ...card });
        break;
      }
      default:
        hideAirCard();
    }
  };

  const stopAirMode = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
      mediaStream = null;
    }
    videoEl.srcObject = null;
    overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (airVoiceOn) {
      fadeOutVoice();
      clearVibrato();
      airVoiceOn = false;
    }
    // Always drop the tip on mode exit, regardless of whether the
    // voice was active — otherwise a paint trail can linger at the
    // last hand position after switching to touch.
    setTip?.(null);
    airState = 'idle';
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API not available in this browser.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    videoEl.srcObject = stream;
    mediaStream = stream;
    // iOS Safari refuses to autoplay an inline <video> until play()
    // is called explicitly; this resolves once the first frame is
    // decoded.
    await videoEl.play();
    if (!videoEl.videoWidth) {
      await new Promise((res) => {
        const onMeta = () => {
          videoEl.removeEventListener('loadedmetadata', onMeta);
          res();
        };
        videoEl.addEventListener('loadedmetadata', onMeta);
      });
    }
    return stream;
  };

  const sizeOverlayCanvas = () => {
    const rect = padEl.getBoundingClientRect();
    // Render at device pixel density for crisp landmark dots; cap at
    // 2 to keep the canvas affordable on retina phones.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlayEl.width = Math.max(1, Math.round(rect.width * dpr));
    overlayEl.height = Math.max(1, Math.round(rect.height * dpr));
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return rect;
  };

  const drawHands = (hands, padW, padH) => {
    overlayCtx.clearRect(0, 0, padW, padH);
    for (const hand of hands) {
      const isPrimary = hand.userHand === 'Right';
      const color = isPrimary ? 'rgba(129, 140, 248, 1)' : 'rgba(244, 114, 182, 1)';
      overlayCtx.save();
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 3;
      overlayCtx.lineCap = 'round';
      overlayCtx.shadowColor = color;
      overlayCtx.shadowBlur = 12;

      overlayCtx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const A = hand.landmarks[a];
        const B = hand.landmarks[b];
        // (1 - x) handles the horizontal mirror so the skeleton aligns
        // with the mirrored video underneath.
        overlayCtx.moveTo((1 - A.x) * padW, A.y * padH);
        overlayCtx.lineTo((1 - B.x) * padW, B.y * padH);
      }
      overlayCtx.stroke();

      overlayCtx.fillStyle = color;
      for (const lm of hand.landmarks) {
        overlayCtx.beginPath();
        overlayCtx.arc((1 - lm.x) * padW, lm.y * padH, 3, 0, Math.PI * 2);
        overlayCtx.fill();
      }

      // Highlight the index fingertip — the active "pointer" landmark.
      // Scale the tip dot with depth so the user can *see* their volume
      // changing as they push their hand toward / away from the camera.
      // 6..22 px feels punchy without dominating the frame.
      const tip = hand.landmarks[TIP_LANDMARK];
      const depth = typeof hand.depth === 'number' ? hand.depth : 0.5;
      const tipR = 6 + depth * 16;
      overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      overlayCtx.shadowBlur = 18 + depth * 12;
      overlayCtx.beginPath();
      overlayCtx.arc((1 - tip.x) * padW, tip.y * padH, tipR, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.restore();
    }
  };

  const detectLoop = () => {
    if (airState !== 'running') return;
    rafId = requestAnimationFrame(detectLoop);
    if (!handLandmarker || !videoEl.videoWidth) return;

    // Modal/dialog up → silence the voice and skip processing this
    // frame. The camera and rAF loop keep running so we can resume
    // instantly when the modal closes; only audio + hand processing
    // are paused.
    if (getInputsSuspended?.()) {
      if (airVoiceOn) {
        fadeOutVoice();
        clearVibrato();
        airVoiceOn = false;
      }
      // Drop the tip too so the paint trail doesn't keep drawing
      // ghost dots at the last visible hand position behind the modal.
      setTip?.(null);
      return;
    }

    // detectForVideo wants a strictly increasing timestamp in ms.
    const now = performance.now();
    if (now <= lastDetectMs) return;
    lastDetectMs = now;

    let result;
    try {
      result = handLandmarker.detectForVideo(videoEl, now);
    } catch (err) {
      console.warn('Hand detection failed', err);
      return;
    }

    const rect = sizeOverlayCanvas();
    const padW = rect.width;
    const padH = rect.height;

    const rawLandmarks = result?.landmarks || [];
    if (rawLandmarks.length === 0) {
      noHandFrames += 1;
      if (noHandFrames > NO_HAND_GRACE_FRAMES && airVoiceOn) {
        fadeOutVoice();
        clearVibrato();
        airVoiceOn = false;
      }
      // Clear the tip after the grace window so brief detection drops
      // don't sever the paint trail mid-stroke. Once we've decided the
      // hand is really gone, stop emitting tip updates.
      if (noHandFrames > NO_HAND_GRACE_FRAMES) setTip?.(null);
      drawHands([], padW, padH);
      return;
    }
    noHandFrames = 0;

    // Tag each detected hand with the user's actual handedness
    // (flipped because we feed un-mirrored frames; see top-of-file
    // comment) and a 0..1 depth value (close-to-camera = 1).
    const hands = rawLandmarks.map((landmarks, i) => {
      const raw = result.handedness?.[i]?.[0]?.categoryName;
      const userHand = raw === 'Right' ? 'Left' : 'Right';
      return { landmarks, userHand, depth: handDepth(landmarks) };
    });

    // Pick primary = user's right hand if present, otherwise the first
    // detected hand. Secondary (vibrato) = the other hand if any.
    const right = hands.find((h) => h.userHand === 'Right');
    const left = hands.find((h) => h.userHand === 'Left');
    const primary = right || hands[0];
    const secondary = right ? left : hands[1] || null;

    // Volume in air mode is driven by depth, not screen-Y. applyPrimary
    // expects yNorm in the touch-pad convention (0 = top = loud, 1 =
    // bottom = silent), so we invert depth: depth=1 (close) → yNorm=0
    // (loud). Matches a real theremin's volume antenna where leaning
    // in toward the loop gates the signal — except inverted for
    // intuition, since "lean in to play louder" feels more natural to
    // first-time players than the antenna's actual physics.
    const volumeY = 1 - primary.depth;

    const cfg = getCfg();
    ensureVoice(xToMidi(0, cfg));
    if (!airVoiceOn) {
      // Fade in to the depth-derived amplitude rather than always max,
      // so a hand that arrives close-but-not-touching doesn't slam to
      // full volume mid-fade.
      fadeInVoice(volumeY);
      airVoiceOn = true;
    }

    const tip = primary.landmarks[TIP_LANDMARK];
    applyPrimary(1 - tip.x, volumeY, cfg);
    setTip?.({ xNorm: 1 - tip.x, yNorm: tip.y });

    if (secondary) {
      // Vibrato hand keeps its XY mapping — rate and depth are two
      // genuinely independent controls and pinch-style depth-on-the-
      // same-hand vibrato is a future option, not a v1 requirement.
      const tip2 = secondary.landmarks[TIP_LANDMARK];
      applyVibrato(1 - tip2.x, tip2.y);
    } else {
      clearVibrato();
    }

    drawHands(hands, padW, padH);
  };

  const startRunning = async () => {
    setAirState('loading');
    try {
      await ensureHandLandmarker();
      await startCamera();
      sizeOverlayCanvas();
      noHandFrames = 0;
      airVoiceOn = false;
      lastDetectMs = 0;
      resetDepthCalibration();
      setAirState('running');
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(detectLoop);
    } catch (err) {
      console.warn('Air mode start failed', err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setAirState('denied');
      } else {
        setAirState('error');
      }
    }
  };

  const enter = () => {
    padEl.classList.add('is-air-mode');
    // If the camera API is missing for this origin, show the
    // diagnostic card (with a dev-CA install hint when applicable)
    // instead of the generic "Allow camera" prompt — tapping the
    // button there would throw a confusing error.
    if (!navigator.mediaDevices?.getUserMedia) {
      setAirState('unavailable');
      return;
    }
    setAirState('prompt');
  };

  const exit = () => {
    padEl.classList.remove('is-air-mode');
    stopAirMode();
  };

  airStartBtn.addEventListener('click', () => {
    if (airState === 'loading') return;
    startRunning();
  });

  // Keep the overlay canvas sized when the pad reflows.
  window.addEventListener('resize', () => {
    if (airState === 'running') sizeOverlayCanvas();
  });

  return { enter, exit };
};
