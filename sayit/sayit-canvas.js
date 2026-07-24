import { S, MAX_CANVAS_HISTORY, INK_LUMA_SUM_MAX } from './sayit-state.js';
import { displayImage, hideResults, showAppMessage, showLoading, showResults } from './sayit-ui.js';
import { recognize } from './sayit-tesseract.js';

function setupEraserHoverOverlay() {
  if (!S.drawingCanvas || !S.eraserHoverOverlay) return;
  S.eraserHoverOverlay.width = S.drawingCanvas.width;
  S.eraserHoverOverlay.height = S.drawingCanvas.height;
  S.eraserOverlayCtx = S.eraserHoverOverlay.getContext('2d', { alpha: true });
  S.eraserOverlayCtx.clearRect(0, 0, S.eraserHoverOverlay.width, S.eraserHoverOverlay.height);
  S.eraserOverlayImageData = null;
}

function isInkPixelAt(data, p) {
  return data[p] + data[p + 1] + data[p + 2] < INK_LUMA_SUM_MAX;
}

function floodFillInkMask(imageData, startX, startY) {
  var w = imageData.width;
  var h = imageData.height;
  var data = imageData.data;
  var ix = Math.floor(startX);
  var iy = Math.floor(startY);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return null;
  var si = iy * w + ix;
  var sp = si * 4;
  if (!isInkPixelAt(data, sp)) return null;

  var mask = new Uint8Array(w * h);
  var visited = new Uint8Array(w * h);
  var qx = new Int32Array(w * h);
  var qy = new Int32Array(w * h);
  var qt = 1;
  var qh = 0;
  qx[0] = ix;
  qy[0] = iy;
  visited[si] = 1;

  function tryEnqueue(nx, ny) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    var nidx = ny * w + nx;
    if (visited[nidx]) return;
    var np = nidx * 4;
    if (!isInkPixelAt(data, np)) return;
    visited[nidx] = 1;
    qx[qt] = nx;
    qy[qt] = ny;
    qt++;
  }

  while (qh < qt) {
    var x = qx[qh];
    var y = qy[qh];
    qh++;
    var idx = y * w + x;
    mask[idx] = 1;
    tryEnqueue(x - 1, y);
    tryEnqueue(x + 1, y);
    tryEnqueue(x, y - 1);
    tryEnqueue(x, y + 1);
  }

  return mask;
}

function applyWhiteFromMask(imageData, mask) {
  var d = imageData.data;
  for (var i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    var p = i * 4;
    d[p] = 255;
    d[p + 1] = 255;
    d[p + 2] = 255;
    d[p + 3] = 255;
  }
}

function drawMaskOnOverlay(mask, w, h) {
  if (!S.eraserOverlayCtx || !mask) return;
  if (
    !S.eraserOverlayImageData ||
    S.eraserOverlayImageData.width !== w ||
    S.eraserOverlayImageData.height !== h
  ) {
    S.eraserOverlayImageData = S.eraserOverlayCtx.createImageData(w, h);
  }
  var od = S.eraserOverlayImageData.data;
  for (var i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i]) {
      od[p] = 33;
      od[p + 1] = 150;
      od[p + 2] = 243;
      od[p + 3] = 115;
    } else {
      od[p] = 0;
      od[p + 1] = 0;
      od[p + 2] = 0;
      od[p + 3] = 0;
    }
  }
  S.eraserOverlayCtx.putImageData(S.eraserOverlayImageData, 0, 0);
}

function clearEraserHover() {
  S.eraserHoverCell = -1;
  S.eraserHoverPendingEvent = null;
  if (S.eraserHoverRaf) {
    cancelAnimationFrame(S.eraserHoverRaf);
    S.eraserHoverRaf = 0;
  }
  if (S.eraserOverlayCtx && S.eraserHoverOverlay) {
    S.eraserOverlayCtx.clearRect(0, 0, S.eraserHoverOverlay.width, S.eraserHoverOverlay.height);
  }
}

function getCanvasCoordinates(e) {
  var rect = S.drawingCanvas.getBoundingClientRect();
  var clientX, clientY;

  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else if (e.changedTouches && e.changedTouches.length > 0) {
    clientX = e.changedTouches[0].clientX;
    clientY = e.changedTouches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  var x = clientX - rect.left;
  var y = clientY - rect.top;

  var canvasDisplayWidth = rect.width;
  var canvasDisplayHeight = rect.height;
  var canvasActualWidth = S.drawingCanvas.width;
  var canvasActualHeight = S.drawingCanvas.height;

  if (canvasDisplayWidth !== canvasActualWidth || canvasDisplayHeight !== canvasActualHeight) {
    x = (x * canvasActualWidth) / canvasDisplayWidth;
    y = (y * canvasActualHeight) / canvasDisplayHeight;
  }

  x = Math.max(0, Math.min(x, canvasActualWidth));
  y = Math.max(0, Math.min(y, canvasActualHeight));

  return { x: x, y: y };
}

function updateEraserHoverPreview(e) {
  if (!S.eraserOverlayCtx || !S.drawingCanvas || S.currentTool !== 'eraser') return;
  var w = S.drawingCanvas.width;
  var h = S.drawingCanvas.height;
  var c = getCanvasCoordinates(e);
  var ix = Math.floor(c.x);
  var iy = Math.floor(c.y);
  S.eraserHoverCell = iy * w + ix;

  var imageData = S.canvasCtx.getImageData(0, 0, w, h);
  var mask = floodFillInkMask(imageData, c.x, c.y);
  S.eraserOverlayCtx.clearRect(0, 0, w, h);
  if (!mask) return;
  drawMaskOnOverlay(mask, w, h);
}

function scheduleEraserHoverUpdate(e) {
  if (S.currentTool !== 'eraser') return;
  S.eraserHoverPendingEvent = e;
  if (S.eraserHoverRaf) return;
  S.eraserHoverRaf = requestAnimationFrame(function () {
    S.eraserHoverRaf = 0;
    if (S.currentTool !== 'eraser') return;
    var ev = S.eraserHoverPendingEvent;
    S.eraserHoverPendingEvent = null;
    if (ev) updateEraserHoverPreview(ev);
  });
}

function eraserApplyAtPointer(e) {
  if (!S.canvasCtx || !S.drawingCanvas) return;
  var w = S.drawingCanvas.width;
  var h = S.drawingCanvas.height;
  var c = getCanvasCoordinates(e);
  var imageData = S.canvasCtx.getImageData(0, 0, w, h);
  var mask = floodFillInkMask(imageData, c.x, c.y);
  if (!mask) {
    clearEraserHover();
    return;
  }
  applyWhiteFromMask(imageData, mask);
  S.canvasCtx.putImageData(imageData, 0, 0);
  clearEraserHover();
  pushCanvasHistoryAfterStroke();
}

function snapshotCanvasImageData() {
  return S.canvasCtx.getImageData(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);
}

function restoreCanvasFromImageData(imageData) {
  S.canvasCtx.putImageData(imageData, 0, 0);
}

function updateUndoRedoButtons() {
  if (!S.undoCanvasBtn || !S.redoCanvasBtn) return;
  S.undoCanvasBtn.disabled = S.canvasHistoryIndex <= 0;
  S.redoCanvasBtn.disabled = S.canvasHistoryIndex >= S.canvasHistoryStates.length - 1;
}

function initCanvasHistoryFromCurrent() {
  S.canvasHistoryStates = [snapshotCanvasImageData()];
  S.canvasHistoryIndex = 0;
  updateUndoRedoButtons();
}

function pushCanvasHistoryAfterStroke() {
  var snap = snapshotCanvasImageData();
  S.canvasHistoryStates = S.canvasHistoryStates.slice(0, S.canvasHistoryIndex + 1);
  S.canvasHistoryStates.push(snap);
  S.canvasHistoryIndex = S.canvasHistoryStates.length - 1;
  while (S.canvasHistoryStates.length > MAX_CANVAS_HISTORY) {
    S.canvasHistoryStates.shift();
    S.canvasHistoryIndex--;
  }
  updateUndoRedoButtons();
  autoSaveCanvas();
}

function setupHighDPICanvas() {
  return;
}

export function setupCanvas() {
  S.canvasCtx = S.drawingCanvas.getContext('2d', { willReadFrequently: true });
  if (!S.canvasCtx) {
    S.canvasCtx = S.drawingCanvas.getContext('2d');
  }

  setupHighDPICanvas();

  S.canvasCtx.lineCap = 'round';
  S.canvasCtx.lineJoin = 'round';
  S.canvasCtx.strokeStyle = '#000000';
  S.canvasCtx.lineWidth = S.currentPenSize;
  S.canvasCtx.globalCompositeOperation = 'source-over';

  S.canvasCtx.fillStyle = 'white';
  S.canvasCtx.fillRect(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);

  selectPenTool();

  initCanvasHistoryFromCurrent();

  setupEraserHoverOverlay();
}

function startDrawing(e) {
  S.canvasStatus.classList.add('hidden');

  if (S.currentTool === 'eraser') {
    eraserApplyAtPointer(e);
    return;
  }

  S.isDrawing = true;
  draw(e);
}

function draw(e) {
  if (S.currentTool === 'eraser') {
    scheduleEraserHoverUpdate(e);
    return;
  }

  if (!S.isDrawing) return;

  var coords = getCanvasCoordinates(e);
  var x = coords.x;
  var y = coords.y;

  S.canvasCtx.lineWidth = S.currentPenSize;
  S.canvasCtx.globalCompositeOperation = 'source-over';

  S.canvasCtx.lineTo(x, y);
  S.canvasCtx.stroke();
  S.canvasCtx.beginPath();
  S.canvasCtx.moveTo(x, y);
}

function stopDrawing() {
  if (!S.isDrawing) return;
  S.isDrawing = false;
  S.canvasCtx.beginPath();

  pushCanvasHistoryAfterStroke();
}

function handleCanvasMouseOut() {
  if (S.currentTool === 'eraser') {
    clearEraserHover();
    return;
  }
  stopDrawing();
}

export function clearCanvas() {
  clearEraserHover();
  S.canvasCtx.clearRect(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);
  S.canvasCtx.fillStyle = 'white';
  S.canvasCtx.fillRect(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);
  hideResults();

  clearCanvasStorage();

  S.canvasStatus.classList.add('hidden');

  selectPenTool();

  pushCanvasHistoryAfterStroke();
}

export function updatePenSize() {
  S.currentPenSize = S.penSizeSlider.value;
  S.penSizeSlider.setAttribute('aria-valuenow', String(S.currentPenSize));
}

export function selectPenTool() {
  clearEraserHover();
  S.currentTool = 'pen';
  S.penToolBtn.classList.add('active');
  S.eraserToolBtn.classList.remove('active');
  S.penToolBtn.setAttribute('aria-pressed', 'true');
  S.eraserToolBtn.setAttribute('aria-pressed', 'false');
  S.drawingCanvas.classList.remove('eraser-mode');

  S.canvasCtx.globalCompositeOperation = 'source-over';
}

export function selectEraserTool() {
  clearEraserHover();
  S.currentTool = 'eraser';
  S.penToolBtn.classList.remove('active');
  S.eraserToolBtn.classList.add('active');
  S.penToolBtn.setAttribute('aria-pressed', 'false');
  S.eraserToolBtn.setAttribute('aria-pressed', 'true');
  S.drawingCanvas.classList.add('eraser-mode');

  S.canvasCtx.globalCompositeOperation = 'source-over';
}

function isLikelyTextEditingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable) return true;
  var tag = el.tagName;
  if (!tag) return false;
  tag = tag.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    var type = (el.type || 'text').toLowerCase();
    if (
      type === 'range' ||
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'color' ||
      type === 'file' ||
      type === 'hidden'
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function setupToolButtons() {
  S.penToolBtn.addEventListener('click', selectPenTool);
  S.eraserToolBtn.addEventListener('click', selectEraserTool);

  document.addEventListener('keydown', function (e) {
    if (S.canvasContainer.classList.contains('hidden')) return;

    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') {
      if (isLikelyTextEditingTarget(e.target)) return;
      e.preventDefault();
      readCanvasDrawing();
      return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      selectPenTool();
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      selectEraserTool();
    }

    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) {
        redoCanvas();
      } else {
        undoCanvas();
      }
    } else if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoCanvas();
    }
  });
}

export function setupCanvasEvents() {
  S.drawingCanvas.addEventListener('mousedown', startDrawing);
  S.drawingCanvas.addEventListener('mousemove', draw);
  S.drawingCanvas.addEventListener('mouseup', stopDrawing);
  S.drawingCanvas.addEventListener('mouseout', handleCanvasMouseOut);

  S.drawingCanvas.addEventListener(
    'touchstart',
    function (e) {
      e.preventDefault();
      if (S.currentTool === 'eraser') {
        var c0 = getCanvasCoordinates(e);
        S.eraserTouchStartX = c0.x;
        S.eraserTouchStartY = c0.y;
        S.eraserTouchMaxDistSq = 0;
        S.lastEraserTouchMoveAt = Date.now();
        scheduleEraserHoverUpdate(e);
        return;
      }
      startDrawing(e);
    },
    { passive: false }
  );

  S.drawingCanvas.addEventListener(
    'touchmove',
    function (e) {
      e.preventDefault();
      if (S.currentTool === 'eraser') {
        var c1 = getCanvasCoordinates(e);
        var dx = c1.x - S.eraserTouchStartX;
        var dy = c1.y - S.eraserTouchStartY;
        var d2 = dx * dx + dy * dy;
        if (d2 > S.eraserTouchMaxDistSq) {
          S.eraserTouchMaxDistSq = d2;
        }
        S.lastEraserTouchMoveAt = Date.now();
      }
      draw(e);
    },
    { passive: false }
  );

  S.drawingCanvas.addEventListener(
    'touchend',
    function (e) {
      e.preventDefault();
      if (S.currentTool === 'eraser') {
        var idleMs = Date.now() - S.lastEraserTouchMoveAt;
        var tapLike = S.eraserTouchMaxDistSq < 26 * 26;
        var recentMove = idleMs < 550;
        if (!tapLike && !recentMove) {
          clearEraserHover();
          return;
        }
        eraserApplyAtPointer(e);
        return;
      }
      stopDrawing();
    },
    { passive: false }
  );

  S.drawingCanvas.addEventListener(
    'touchcancel',
    function (e) {
      e.preventDefault();
      if (S.currentTool === 'eraser') {
        clearEraserHover();
      } else {
        stopDrawing();
      }
    },
    { passive: false }
  );

  S.clearCanvasBtn.addEventListener('click', clearCanvas);
  S.penSizeSlider.addEventListener('input', updatePenSize);
  S.readDrawingBtn.addEventListener('click', readCanvasDrawing);
  S.postDrawingBtn?.addEventListener('click', postCanvasDrawing);
  S.undoCanvasBtn.addEventListener('click', undoCanvas);
  S.redoCanvasBtn.addEventListener('click', redoCanvas);
}

function canvasHasInk() {
  if (!S.canvasCtx || !S.drawingCanvas) return false;
  var pixels = S.canvasCtx.getImageData(0, 0, S.drawingCanvas.width, S.drawingCanvas.height).data;
  for (var i = 0; i < pixels.length; i += 4) {
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] < INK_LUMA_SUM_MAX) return true;
  }
  return false;
}

function canvasToBlob() {
  return new Promise(function (resolve, reject) {
    S.drawingCanvas.toBlob(function (blob) {
      if (blob) resolve(blob);
      else reject(new Error('Could not capture the whiteboard'));
    }, 'image/png');
  });
}

function recognizedTextForPost() {
  if (!S.parsedContent) return '';
  var text = S.parsedContent.textContent.trim();
  if (
    !text ||
    text === 'Processing...' ||
    text === 'Processing image...' ||
    text.includes('Error') ||
    text.includes('No text could be extracted')
  ) {
    return '';
  }
  return text;
}

async function postCanvasDrawing() {
  if (!canvasHasInk()) {
    showAppMessage('Write something on the whiteboard before posting it.', true);
    return;
  }

  if (S.postDrawingBtn) S.postDrawingBtn.disabled = true;
  showAppMessage('Preparing your whiteboard note…', false);
  try {
    var blob = await canvasToBlob();
    var posts = await import('/posts/share-client.js');
    var recognizedText = recognizedTextForPost();
    await posts.share({
      text: recognizedText
        ? recognizedText + '\n\n— Whiteboard message from [Say It](/sayit/)'
        : 'Whiteboard message from [Say It](/sayit/)',
      attachments: [blob]
    });
  } catch (error) {
    console.error('Failed to post Say It drawing:', error);
    showAppMessage('Could not prepare the whiteboard post. Please try again.', true);
    if (S.postDrawingBtn) S.postDrawingBtn.disabled = false;
  }
}

// The "Read aloud" click used to run two full toDataURL('image/png')
// encodes back-to-back on an 800×400 canvas (once for OCR, once for
// localStorage) — the encode is synchronous and can be 30-80ms on mid-
// range mobile, so INP for this button routinely blew past the 200ms
// "good" threshold. Now we encode once, paint a "Processing…" state,
// yield to the browser, and only then do the heavy work.
async function readCanvasDrawing() {
  var yieldFn =
    typeof window.yieldToMain === 'function'
      ? window.yieldToMain
      : function () {
          return new Promise(function (r) {
            setTimeout(r, 0);
          });
        };

  showResults();
  showLoading();
  await yieldFn();

  var imageData = S.drawingCanvas.toDataURL('image/png');
  saveCanvasToStorage(imageData);
  displayImage(imageData);
  recognize(imageData, true);
}

function saveCanvasToStorage(preEncoded) {
  try {
    var imageData = preEncoded || S.drawingCanvas.toDataURL('image/png');
    localStorage.setItem('sayit-canvas-drawing', imageData);
    console.log('Canvas saved to localStorage');
  } catch (error) {
    console.error('Failed to save canvas to localStorage:', error);
  }
}

export function loadCanvasFromStorage() {
  try {
    var savedImageData = localStorage.getItem('sayit-canvas-drawing');
    if (savedImageData) {
      var img = new Image();
      img.onload = function () {
        S.canvasCtx.clearRect(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);
        S.canvasCtx.fillStyle = 'white';
        S.canvasCtx.fillRect(0, 0, S.drawingCanvas.width, S.drawingCanvas.height);

        S.canvasCtx.drawImage(img, 0, 0);
        console.log('Canvas restored from localStorage');

        initCanvasHistoryFromCurrent();
        clearEraserHover();
        setupEraserHoverOverlay();

        showCanvasRestoreStatus();
      };
      img.src = savedImageData;
      return true;
    }
  } catch (error) {
    console.error('Failed to load canvas from localStorage:', error);
  }
  return false;
}

function showCanvasRestoreStatus() {
  S.canvasStatus.classList.remove('hidden');
  setTimeout(function () {
    S.canvasStatus.classList.add('hidden');
  }, 3000);
}

function clearCanvasStorage() {
  try {
    localStorage.removeItem('sayit-canvas-drawing');
    console.log('Canvas storage cleared');
  } catch (error) {
    console.error('Failed to clear canvas from localStorage:', error);
  }
}

function autoSaveCanvas() {
  clearTimeout(S.autoSaveTimeout);
  S.autoSaveTimeout = setTimeout(function () {
    saveCanvasToStorage();
  }, 1000);
}

function undoCanvas() {
  if (S.canvasHistoryIndex <= 0) return;
  S.canvasHistoryIndex--;
  restoreCanvasFromImageData(S.canvasHistoryStates[S.canvasHistoryIndex]);
  updateUndoRedoButtons();
  autoSaveCanvas();
}

function redoCanvas() {
  if (S.canvasHistoryIndex >= S.canvasHistoryStates.length - 1) return;
  S.canvasHistoryIndex++;
  restoreCanvasFromImageData(S.canvasHistoryStates[S.canvasHistoryIndex]);
  updateUndoRedoButtons();
  autoSaveCanvas();
}
