'use strict';

const CHARSETS = {
  classic: '@#S%?*+;:,. ',
  dense: '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ',
  block: '█▓▒░· ',
  braille: '⣿⣾⣼⣸⣰⣠⣀⢀⠀'
};

// Predator IR palette — cold → hot (1987 film look: no white peak, green mid-band)
const THERMAL_STOPS = [
  [0, 0, 0],
  [0, 24, 64],
  [0, 200, 255],
  [0, 255, 96],
  [255, 255, 0],
  [255, 102, 0],
  [204, 0, 0]
];

function predatorHeat(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const warmth = Math.max(0, r - b);
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const chroma = maxC - minC;
  // Neutral bright pixels (lamps, windows) read cooler than warm skin
  const neutral = lum > 120 ? Math.max(0, 1 - chroma / 80) * (lum - 120) * 0.55 : 0;
  let heat = lum * 0.5 + r * 0.3 + warmth * 0.35 - neutral;
  return Math.max(0, Math.min(255, heat));
}

function thermalRgb(heat) {
  const bands = 10;
  const t = Math.floor((Math.max(0, Math.min(255, heat)) / 255) * (bands - 1)) / (bands - 1);
  const idx = t * (THERMAL_STOPS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, THERMAL_STOPS.length - 1);
  const f = idx - lo;
  const a = THERMAL_STOPS[lo];
  const b = THERMAL_STOPS[hi];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}

function remapPredatorHeat(heat) {
  if (heat <= 90) return heat * (145 / 90);
  return 145 + (heat - 90) * (110 / 165);
}

function blurHeat3x3(heat, cols, rows) {
  const out = new Float32Array(heat.length);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nr = row + dy;
          const nc = col + dx;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            sum += heat[nr * cols + nc];
            count++;
          }
        }
      }
      out[row * cols + col] = sum / count;
    }
  }
  return out;
}

function cyanGlowStrength(heat, cols, rows, row, col) {
  const idx = row * cols + col;
  const h = heat[idx];
  let maxN = h;
  let minN = h;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nr = row + dy;
      const nc = col + dx;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nh = heat[nr * cols + nc];
      if (nh > maxN) maxN = nh;
      if (nh < minN) minN = nh;
    }
  }
  const grad = maxN - minN;
  if (h < 115 && maxN > h + 22 && grad > 18) {
    return Math.min(1, grad / 70) * Math.min(1, (maxN - h) / 50);
  }
  return 0;
}

function predatorColor(heat, glow) {
  const rgb = thermalRgb(heat);
  if (glow <= 0) return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  const t = glow * 0.9;
  const r = Math.round(rgb[0] * (1 - t));
  const g = Math.round(rgb[1] * (1 - t) + 200 * t);
  const b = Math.round(rgb[2] * (1 - t) + 255 * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function buildPredatorHeatMap(px, cols, rows) {
  const heat = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 4;
      let h = predatorHeat(px[i], px[i + 1], px[i + 2]);
      h = (h - 128) * cfg.contrast + 128 + cfg.brightness;
      h = Math.max(0, Math.min(255, h));
      h += (Math.random() - 0.5) * 12;
      h = remapPredatorHeat(Math.max(0, Math.min(255, h)));
      heat[row * cols + col] = h;
    }
  }
  return blurHeat3x3(heat, cols, rows);
}

const state = {
  mode: 'image',
  sourceImg: null,
  webcamStream: null,
  webcamRunning: false,
  frozen: false,
  rafId: null,
  lastFrameTime: 0,
  currentText: ''
};

const cfg = {
  charset: 'classic',
  customChars: '',
  cols: 80,
  colorMode: 'mono',
  fontSize: 10,
  contrast: 1.0,
  brightness: 0,
  facingMode: 'user'
};

function $id(id) {
  return document.getElementById(id);
}

const tabImage = $id('tab-image');
const tabWebcam = $id('tab-webcam');
const canvasWrap = $id('canvas-wrap');
const asciiCanvas = $id('ascii-canvas');
const videoEl = $id('video-feed');
const overlayMsg = $id('overlay-msg');
const fileInput = $id('file-input');
const webcamControls = $id('webcam-controls');
const btnStartCam = $id('btn-start-cam');
const btnStopCam = $id('btn-stop-cam');
const btnSnapshot = $id('btn-snapshot');
const camError = $id('cam-error');
const ctrlCharset = $id('ctrl-charset');
const ctrlCustom = $id('ctrl-custom');
const ctrlCustomWrap = $id('ctrl-custom-wrap');
const ctrlCols = $id('ctrl-cols');
const ctrlColsVal = $id('ctrl-cols-val');
const ctrlColor = $id('ctrl-color');
const ctrlFont = $id('ctrl-font');
const ctrlFontVal = $id('ctrl-font-val');
const ctrlContrast = $id('ctrl-contrast');
const ctrlContrastVal = $id('ctrl-contrast-val');
const ctrlBright = $id('ctrl-bright');
const ctrlBrightVal = $id('ctrl-bright-val');
const btnCopy = $id('btn-copy');
const btnPng = $id('btn-png');
const btnTxt = $id('btn-txt');
const btnFlipCam = $id('btn-flip-cam');

const offscreen = document.createElement('canvas');
const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
const ctx = asciiCanvas.getContext('2d');

// ── Renderer ──────────────────────────────────────────────────

function getChars() {
  if (cfg.charset === 'custom') {
    return cfg.customChars.length > 0 ? cfg.customChars : '@#:. ';
  }
  return CHARSETS[cfg.charset];
}

function sampleAndRender(source) {
  const chars = getChars();
  const cols = cfg.cols;
  const srcW = source.videoWidth || source.naturalWidth || source.width || 0;
  const srcH = source.videoHeight || source.naturalHeight || source.height || 0;
  if (srcW < 1 || srcH < 1) return;

  ctx.font = cfg.fontSize + 'px monospace';
  const charW = Math.max(1, ctx.measureText('M').width);
  const charH = cfg.fontSize;
  const rows = Math.max(1, Math.round((cols * (srcH / srcW) * charW) / charH));

  offscreen.width = cols;
  offscreen.height = rows;
  offCtx.drawImage(source, 0, 0, cols, rows);
  const px = offCtx.getImageData(0, 0, cols, rows).data;

  asciiCanvas.width = Math.round(cols * charW);
  asciiCanvas.height = rows * charH;

  const isPredator = cfg.colorMode === 'predator';
  const predatorHeatMap = isPredator ? buildPredatorHeatMap(px, cols, rows) : null;

  ctx.fillStyle = isPredator ? '#001830' : cfg.colorMode === 'inverted' ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, asciiCanvas.width, asciiCanvas.height);
  ctx.font = cfg.fontSize + 'px monospace';

  const lines = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];

      let gray;
      if (isPredator) {
        gray = predatorHeatMap[row * cols + col];
      } else {
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        gray = (lum - 128) * cfg.contrast + 128 + cfg.brightness;
        gray = Math.max(0, Math.min(255, gray));
        if (cfg.colorMode === 'inverted') gray = 255 - gray;
      }

      const ci = Math.min(chars.length - 1, Math.floor(((255 - gray) / 255) * chars.length));
      const ch = chars[ci];
      line += ch;

      let color;
      switch (cfg.colorMode) {
        case 'green':
          color = '#00ff41';
          break;
        case 'amber':
          color = '#ffb000';
          break;
        case 'color':
          color = 'rgb(' + r + ',' + g + ',' + b + ')';
          break;
        case 'inverted':
          color = '#000000';
          break;
        case 'predator':
          color = predatorColor(gray, cyanGlowStrength(predatorHeatMap, cols, rows, row, col));
          break;
        default:
          color = '#cccccc';
          break;
      }

      ctx.fillStyle = color;
      ctx.fillText(ch, Math.round(col * charW), (row + 1) * charH);
    }
    lines.push(line);
  }
  state.currentText = lines.join('\n');
}

// ── Image mode ────────────────────────────────────────────────

let debounceTimer = null;

function renderImage() {
  if (state.sourceImg) sampleAndRender(state.sourceImg);
}

function scheduleRender() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderImage, 100);
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      state.sourceImg = img;
      overlayMsg.style.display = 'none';
      renderImage();
      window.heymingAchievements?.unlockForCurrentApp('first-action');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Webcam mode ───────────────────────────────────────────────

const FRAME_MS = 1000 / 15;

function webcamLoop(ts) {
  if (!state.webcamRunning || state.frozen) return;
  state.rafId = requestAnimationFrame(webcamLoop);
  if (ts - state.lastFrameTime < FRAME_MS) return;
  state.lastFrameTime = ts;
  if (videoEl.readyState >= 2) sampleAndRender(videoEl);
}

function cameraUnavailableMsg() {
  if (window.isSecureContext) {
    return "This browser doesn't allow camera access. Try Chrome on Android or Safari on iOS.";
  }
  const isLocal = /^(localhost|127\.|::1$|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(
    location.hostname
  );
  if (isLocal) {
    return (
      "Your phone hasn't trusted this dev server's certificate yet. " +
      '<a href="/dev-ca.pem" download="dev-ca.pem">Tap here to download the dev CA</a>, ' +
      'install it under Settings \u2192 Security \u2192 Install certificate \u2192 CA certificate, then reload.'
    );
  }
  return 'Camera requires HTTPS. Open this page over a secure connection and try again.';
}

async function startCamera() {
  camError.style.display = 'none';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camError.innerHTML = cameraUnavailableMsg();
    camError.style.display = '';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: cfg.facingMode }
    });
    state.webcamStream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    state.webcamRunning = true;
    state.frozen = false;
    overlayMsg.style.display = 'none';
    btnStartCam.style.display = 'none';
    btnStopCam.style.display = '';
    btnSnapshot.style.display = '';
    btnFlipCam.style.display = '';
    btnTom.style.display = '';
    asciiCanvas.classList.toggle('mirrored', cfg.facingMode === 'user');
    state.rafId = requestAnimationFrame(webcamLoop);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  } catch (err) {
    let msg;
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = 'Camera access was denied. Allow camera permissions and try again.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = 'No camera found on this device.';
    } else if (err.name === 'NotReadableError') {
      msg = 'Camera is in use by another app. Close it and try again.';
    } else {
      msg = 'Camera error: ' + err.message;
    }
    camError.textContent = msg;
    camError.style.display = '';
  }
}

function stopCamera() {
  state.webcamRunning = false;
  cancelAnimationFrame(state.rafId);
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach(function (t) {
      t.stop();
    });
    state.webcamStream = null;
  }
  videoEl.srcObject = null;
  state.frozen = false;
  btnStartCam.style.display = '';
  btnStopCam.style.display = 'none';
  btnSnapshot.style.display = 'none';
  btnFlipCam.style.display = 'none';
  btnTom.style.display = 'none';
  btnSnapshot.textContent = '📷 Snapshot';
  showOverlay('webcam');
}

async function flipCamera() {
  cfg.facingMode = cfg.facingMode === 'user' ? 'environment' : 'user';
  if (state.webcamStream) {
    state.webcamStream.getTracks().forEach(function (t) {
      t.stop();
    });
    state.webcamStream = null;
  }
  cancelAnimationFrame(state.rafId);
  state.webcamRunning = false;
  await startCamera();
}

function snapshot() {
  state.frozen = !state.frozen;
  btnSnapshot.textContent = state.frozen ? '▶ Resume' : '📷 Snapshot';
  if (!state.frozen && state.webcamRunning) {
    state.rafId = requestAnimationFrame(webcamLoop);
  }
}

// ── Overlays & tabs ───────────────────────────────────────────

function showOverlay(type) {
  if (type === 'image') {
    overlayMsg.innerHTML =
      '<div class="drop-hint">' +
      '<div class="drop-icon">🖼️</div>' +
      '<p>Drag &amp; drop an image here</p>' +
      '<p class="drop-sub">or</p>' +
      '<button class="btn-primary" id="pick-btn">Choose Image</button>' +
      '</div>';
    $id('pick-btn').addEventListener('click', function () {
      fileInput.click();
    });
  } else {
    overlayMsg.innerHTML =
      '<div class="drop-hint">' +
      '<div class="drop-icon">📷</div>' +
      '<p>Live ASCII from your camera</p>' +
      '<button class="btn-primary" id="overlay-start-btn">Start Camera</button>' +
      '</div>';
    $id('overlay-start-btn').addEventListener('click', startCamera);
  }
  overlayMsg.style.display = 'flex';
}

function switchMode(newMode) {
  state.mode = newMode;
  tabImage.classList.toggle('active', newMode === 'image');
  tabWebcam.classList.toggle('active', newMode === 'webcam');
  tabImage.setAttribute('aria-pressed', newMode === 'image' ? 'true' : 'false');
  tabWebcam.setAttribute('aria-pressed', newMode === 'webcam' ? 'true' : 'false');
  webcamControls.style.display = newMode === 'webcam' ? '' : 'none';
  asciiCanvas.classList.toggle('mirrored', newMode === 'webcam' && cfg.facingMode === 'user');

  if (newMode === 'webcam') {
    if (!state.webcamStream) showOverlay('webcam');
    else overlayMsg.style.display = 'none';
  } else {
    if (state.webcamRunning) stopCamera();
    if (!state.sourceImg) showOverlay('image');
    else overlayMsg.style.display = 'none';
  }
}

// ── Export ────────────────────────────────────────────────────

function copyText() {
  if (!state.currentText) return;
  navigator.clipboard
    .writeText(state.currentText)
    .then(function () {
      const orig = btnCopy.textContent;
      btnCopy.textContent = '✓ Copied!';
      setTimeout(function () {
        btnCopy.textContent = orig;
      }, 1600);
    })
    .catch(function () {});
}

function downloadPng() {
  if (!asciiCanvas.width || !asciiCanvas.height) return;
  const a = document.createElement('a');
  a.href = asciiCanvas.toDataURL('image/png');
  a.download = 'ascii-art.png';
  a.click();
}

function downloadTxt() {
  if (!state.currentText) return;
  const blob = new Blob([state.currentText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ascii-art.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Controls wiring ───────────────────────────────────────────

tabImage.addEventListener('click', function () {
  switchMode('image');
});
tabWebcam.addEventListener('click', function () {
  switchMode('webcam');
});

canvasWrap.addEventListener('dragover', function (e) {
  if (state.mode !== 'image') return;
  e.preventDefault();
  canvasWrap.classList.add('drag-over');
});
canvasWrap.addEventListener('dragleave', function () {
  canvasWrap.classList.remove('drag-over');
});
canvasWrap.addEventListener('drop', function (e) {
  e.preventDefault();
  canvasWrap.classList.remove('drag-over');
  if (state.mode === 'image') loadFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', function () {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});

ctrlCharset.addEventListener('change', function () {
  cfg.charset = ctrlCharset.value;
  ctrlCustomWrap.style.display = cfg.charset === 'custom' ? '' : 'none';
  if (state.mode === 'image') scheduleRender();
});

ctrlCustom.addEventListener('input', function () {
  cfg.customChars = ctrlCustom.value;
  if (state.mode === 'image') scheduleRender();
});

ctrlCols.addEventListener('input', function () {
  cfg.cols = parseInt(ctrlCols.value, 10);
  ctrlColsVal.textContent = cfg.cols;
  if (state.mode === 'image') scheduleRender();
});

ctrlColor.addEventListener('change', function () {
  cfg.colorMode = ctrlColor.value;
  if (state.mode === 'image') scheduleRender();
});

ctrlFont.addEventListener('input', function () {
  cfg.fontSize = parseInt(ctrlFont.value, 10);
  ctrlFontVal.textContent = cfg.fontSize;
  if (state.mode === 'image') scheduleRender();
});

ctrlContrast.addEventListener('input', function () {
  cfg.contrast = parseFloat(ctrlContrast.value);
  ctrlContrastVal.textContent = cfg.contrast.toFixed(1);
  if (state.mode === 'image') scheduleRender();
});

ctrlBright.addEventListener('input', function () {
  cfg.brightness = parseInt(ctrlBright.value, 10);
  ctrlBrightVal.textContent = cfg.brightness;
  if (state.mode === 'image') scheduleRender();
});

// ── Fullscreen ────────────────────────────────────────────────

const btnFullscreen = $id('btn-fullscreen');

function toggleFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = canvasWrap;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

function updateFsBtn() {
  const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btnFullscreen.textContent = inFs ? '✕' : '⛶';
  btnFullscreen.setAttribute('aria-label', inFs ? 'Exit fullscreen' : 'Toggle fullscreen');
}

btnFullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFsBtn);
document.addEventListener('webkitfullscreenchange', updateFsBtn);

btnStartCam.addEventListener('click', startCamera);
btnStopCam.addEventListener('click', stopCamera);
btnSnapshot.addEventListener('click', snapshot);
btnFlipCam.addEventListener('click', flipCamera);
btnCopy.addEventListener('click', copyText);
btnPng.addEventListener('click', downloadPng);
btnTxt.addEventListener('click', downloadTxt);

const btnPost = $id('btn-post');
btnPost.addEventListener('click', shareAsPost);

async function shareAsPost() {
  if (!asciiCanvas.width || !asciiCanvas.height) return;
  const blob = await new Promise((resolve) => {
    asciiCanvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob) return;
  const { share } = await import('/posts/share-client.js');
  await share({
    text: 'ASCII Art\n\nMade with [ASCII Art](https://joeheyming.github.io/ascii/).',
    attachments: [blob]
  });
}

// ── Take On Me mode ───────────────────────────────────────────
// Oscillates ASCII settings while the a-ha music video plays in PiP.

const btnTom = $id('btn-tom');
const tomPip = $id('tom-pip');
const tomIframeSlot = $id('tom-iframe-slot');
const TOM_VIDEO_ID = 'djV11Xbc914'; // a-ha — Take On Me (official)

// Iframe permissions match countdown/components/youtube-player.js — the
// short `allow="autoplay; encrypted-media"` list is what previously got
// the embed blocked / sandboxed by extensions + COEP-strict browsers.
const TOM_IFRAME_ALLOW = [
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'gyroscope',
  'picture-in-picture',
  'web-share'
].join('; ');

function mountTomIframe() {
  tomIframeSlot.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.id = 'tom-iframe';
  // youtube.com/embed/ (not youtube-nocookie) — better extension compat.
  iframe.src = `https://www.youtube.com/embed/${TOM_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  iframe.title = 'Take On Me by a-ha';
  iframe.allow = TOM_IFRAME_ALLOW;
  iframe.allowFullscreen = true;
  // `credentialless` lets the embed render even on pages served with
  // Cross-Origin-Embedder-Policy: require-corp (no-op elsewhere).
  iframe.setAttribute('credentialless', '');
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  tomIframeSlot.appendChild(iframe);
}

function unmountTomIframe() {
  tomIframeSlot.innerHTML = '';
}

const BPM = 169;
const BEAT = 60 / BPM;
const PHRASE = [
  [1108.73, 0.5],
  [987.77, 0.5],
  [880.0, 0.5],
  [739.99, 0.5],
  [659.25, 1.0],
  [739.99, 0.5],
  [880.0, 0.5],
  [1108.73, 0.5],
  [987.77, 0.5],
  [880.0, 0.5],
  [739.99, 1.5],
  [659.25, 0.5],
  [739.99, 0.5],
  [880.0, 0.5],
  [739.99, 0.5],
  [659.25, 1.0]
];
const PHRASE_DURATION = PHRASE.reduce(function (s, n) {
  return s + n[1] * BEAT;
}, 0);

let tomActive = false;
let tomAudioCtx = null;
let tomRafId = null;
let tomStartTime = 0;
let tomBaseSettings = null;

function scheduleMelody(audioCtx, gainNode, startTime) {
  let t = startTime;
  const loop = 8;
  for (let l = 0; l < loop; l++) {
    for (const [freq, dur] of PHRASE) {
      const osc = audioCtx.createOscillator();
      const env = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      env.gain.setValueAtTime(0.001, t);
      env.gain.linearRampToValueAtTime(0.28, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur * BEAT - 0.02);
      osc.connect(env);
      env.connect(gainNode);
      osc.start(t);
      osc.stop(t + dur * BEAT);
      t += dur * BEAT;
    }
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Reflected random walk — drifts within [min,max], bounces off edges
function randStep(val, min, max, speed) {
  const delta = (Math.random() - 0.5) * speed;
  let next = val + delta;
  if (next < min) next = min + (min - next);
  if (next > max) next = max - (next - max);
  return Math.max(min, Math.min(max, next));
}

const tomTarget = { contrast: 1.0, brightness: 0, cols: 80 };
const tomSmooth = { contrast: 1.0, brightness: 0, cols: 80 };
let tomLastColorChange = 0;
let tomNextColorDelay = 4;
const COLOR_MODES = ['mono', 'inverted', 'green', 'amber', 'mono', 'mono'];

function tomTick() {
  if (!tomActive) return;
  tomRafId = requestAnimationFrame(tomTick);

  const elapsed = tomAudioCtx.currentTime - tomStartTime;

  tomTarget.contrast = randStep(tomTarget.contrast, 0.4, 2.6, 0.04);
  tomTarget.brightness = randStep(tomTarget.brightness, -55, 55, 1.2);
  tomTarget.cols = randStep(tomTarget.cols, 40, 130, 0.6);

  tomSmooth.contrast = lerp(tomSmooth.contrast, tomTarget.contrast, 0.03);
  tomSmooth.brightness = lerp(tomSmooth.brightness, tomTarget.brightness, 0.025);
  tomSmooth.cols = lerp(tomSmooth.cols, tomTarget.cols, 0.015);

  cfg.contrast = Math.max(0.1, Math.min(3.0, tomSmooth.contrast));
  cfg.brightness = Math.round(tomSmooth.brightness);
  cfg.cols = Math.max(20, Math.min(200, Math.round(tomSmooth.cols)));

  ctrlContrast.value = cfg.contrast.toFixed(1);
  ctrlContrastVal.textContent = cfg.contrast.toFixed(1);
  ctrlBright.value = cfg.brightness;
  ctrlBrightVal.textContent = cfg.brightness;
  ctrlCols.value = cfg.cols;
  ctrlColsVal.textContent = cfg.cols;

  if (elapsed - tomLastColorChange > tomNextColorDelay) {
    tomLastColorChange = elapsed;
    tomNextColorDelay = 4 + Math.random() * 8;
    cfg.colorMode = COLOR_MODES[Math.floor(Math.random() * COLOR_MODES.length)];
    ctrlColor.value = cfg.colorMode;
  }
}

function startTom() {
  tomBaseSettings = {
    contrast: cfg.contrast,
    brightness: cfg.brightness,
    colorMode: cfg.colorMode,
    cols: cfg.cols,
    charset: cfg.charset
  };
  tomAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = tomAudioCtx.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(tomAudioCtx.destination);
  tomStartTime = tomAudioCtx.currentTime + 0.05;
  scheduleMelody(tomAudioCtx, masterGain, tomStartTime);
  cfg.charset = 'classic';
  ctrlCharset.value = 'classic';
  tomTarget.contrast = tomSmooth.contrast = cfg.contrast;
  tomTarget.brightness = tomSmooth.brightness = cfg.brightness;
  tomTarget.cols = tomSmooth.cols = cfg.cols;
  tomLastColorChange = 0;
  tomNextColorDelay = 4 + Math.random() * 8;
  tomActive = true;
  tomRafId = requestAnimationFrame(tomTick);
  btnTom.classList.add('active');
  btnTom.setAttribute('aria-pressed', 'true');
  mountTomIframe();
  tomPip.style.display = 'block';
  tomAudioCtx.suspend();
}

function stopTom() {
  tomActive = false;
  cancelAnimationFrame(tomRafId);
  if (tomAudioCtx) {
    tomAudioCtx.close();
    tomAudioCtx = null;
  }
  unmountTomIframe();
  tomPip.style.display = 'none';
  if (tomBaseSettings) {
    Object.assign(cfg, tomBaseSettings);
    ctrlContrast.value = cfg.contrast;
    ctrlContrastVal.textContent = cfg.contrast.toFixed(1);
    ctrlBright.value = cfg.brightness;
    ctrlBrightVal.textContent = cfg.brightness;
    ctrlColor.value = cfg.colorMode;
    ctrlCols.value = cfg.cols;
    ctrlColsVal.textContent = cfg.cols;
    ctrlCharset.value = cfg.charset;
  }
  btnTom.classList.remove('active');
  btnTom.setAttribute('aria-pressed', 'false');
}

btnTom.addEventListener('click', function () {
  if (tomActive) stopTom();
  else startTom();
});

btnStopCam.addEventListener(
  'click',
  function () {
    stopTom();
  },
  true
);

switchMode('image');
