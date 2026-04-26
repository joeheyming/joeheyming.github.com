var worker;
var dropZone,
  imageUpload,
  sampleImage,
  loading,
  results,
  imgPreview,
  parsedContent,
  playButton,
  playIcon,
  playText;

// Mode switching elements
var canvasModeBtn, uploadModeBtn, canvasContainer, uploadContainer;

// Canvas drawing elements
var drawingCanvas,
  canvasCtx,
  eraserHoverOverlay,
  eraserOverlayCtx,
  clearCanvasBtn,
  penSizeSlider,
  readDrawingBtn,
  canvasStatus;
var penToolBtn, eraserToolBtn;
var undoCanvasBtn, redoCanvasBtn;

// Drawing state
var isDrawing = false;
var currentPenSize = 15; // 75% thickness for better OCR
var currentTool = 'pen'; // 'pen' or 'eraser'
var autoSaveTimeout;

// Undo/redo: one full-canvas snapshot per completed stroke (pointer up / touch end)
var canvasHistoryStates = [];
var canvasHistoryIndex = 0;
var MAX_CANVAS_HISTORY = 25;

// Eraser: hover highlights connected ink (flood fill); click removes that blob to white
var eraserHoverRaf = 0;
var eraserHoverPendingEvent = null;
var eraserHoverCell = -1;
var eraserOverlayImageData = null;
var INK_LUMA_SUM_MAX = 735;

var sayitAppMessageEl = null;
var sayitAppMessageTimer = null;

/** Eraser touch: avoid deleting on a stale lift after a long pause away from the canvas. */
var eraserTouchStartX = 0;
var eraserTouchStartY = 0;
var eraserTouchMaxDistSq = 0;
var lastEraserTouchMoveAt = 0;

function showAppMessage(message, isError) {
  if (!sayitAppMessageEl) {
    sayitAppMessageEl = document.getElementById('sayitAppMessage');
  }
  if (!sayitAppMessageEl) return;
  if (sayitAppMessageTimer) {
    clearTimeout(sayitAppMessageTimer);
    sayitAppMessageTimer = null;
  }
  sayitAppMessageEl.textContent = message;
  sayitAppMessageEl.classList.remove('hidden');
  if (isError) {
    sayitAppMessageEl.classList.add('sayit-app-message--error');
  } else {
    sayitAppMessageEl.classList.remove('sayit-app-message--error');
  }
  sayitAppMessageTimer = setTimeout(function () {
    sayitAppMessageEl.classList.add('hidden');
    sayitAppMessageEl.textContent = '';
    sayitAppMessageTimer = null;
  }, 6500);
}

async function initializeTesseract() {
  try {
    worker = await Tesseract.createWorker('eng');

    // Set parameters for better OCR performance
    await worker.setParameters({
      tessedit_pageseg_mode: '6', // Assume a single uniform block of text
      tessedit_char_whitelist: '' // Allow all characters
    });

    console.log('Tesseract initialized successfully');
  } catch (error) {
    console.log('Tesseract initialization error:', error);
  }
}

function showResults() {
  results.style.display = 'flex';
}

function hideResults() {
  results.style.display = 'none';
}

function displayImage(src) {
  imgPreview.src = src;
}

function showLoading() {
  loading.classList.remove('hidden');
  parsedContent.textContent = 'Processing image...';
}

function hideLoading() {
  loading.classList.add('hidden');
}

function setupDragAndDrop() {
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop zone when item is dragged over it
  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  dropZone.addEventListener('drop', handleDrop, false);

  // Handle click to select file
  dropZone.addEventListener('click', () => {
    imageUpload.click();
  });
}

function setupFileInput() {
  imageUpload.addEventListener('change', function (e) {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });
}

function setupSampleImageDrag() {
  sampleImage.addEventListener('dragstart', function (e) {
    // Store the image source for when it's dropped
    e.dataTransfer.setData('text/plain', sampleImage.src);
    e.dataTransfer.setData('image-source', 'sample');
  });
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight(e) {
  dropZone.classList.add('dragover');
}

function unhighlight(e) {
  dropZone.classList.remove('dragover');
}

function handleDrop(e) {
  var dt = e.dataTransfer;

  // Check if it's the sample image being dragged
  var imageSource = dt.getData('image-source');
  if (imageSource === 'sample') {
    // Handle sample image drag
    handleSampleImageDrop();
    return;
  }

  // Handle file drop
  var files = dt.files;
  if (files.length > 0) {
    handleFiles(files);
  }
}

function handleSampleImageDrop() {
  // Process the sample image
  showResults();
  displayImage(sampleImage.src);
  recognize(sampleImage.src, false); // Don't auto-play for uploaded images
}

function handleFiles(files) {
  if (files.length > 0) {
    var file = files[0];

    // Check if it's an image file
    if (!file.type.startsWith('image/')) {
      showAppMessage('Please select an image file (JPG, PNG, GIF, BMP).', true);
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      showResults();
      displayImage(e.target.result);
      recognize(e.target.result, false); // Don't auto-play for uploaded images
    };
    reader.readAsDataURL(file);
  }
}

function setupPlayButton() {
  playButton.addEventListener('click', function () {
    var text = parsedContent.textContent;

    if (
      !text ||
      text === 'Processing...' ||
      text.includes('Error') ||
      text.includes('No text could be extracted')
    ) {
      return;
    }

    // Check if we're currently speaking
    if (window.speechSynthesis.speaking) {
      // Stop current speech
      window.speechSynthesis.cancel();
      resetPlayButton();
    } else {
      // Start speech
      speakText(text);
    }
  });
}

function speakText(text) {
  if (!window.speechSynthesis) {
    showAppMessage('Speech synthesis is not supported in this browser.', true);
    return;
  }

  var trimmed = (text || '').trim();
  if (!trimmed) {
    return;
  }

  // Update button to show playing state
  playButton.classList.add('playing');
  playIcon.textContent = '⏸️';
  playText.textContent = 'Stop';

  var utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = 0.8; // Slightly slower for clarity

  utterance.onend = function () {
    resetPlayButton();
  };

  utterance.onerror = function (ev) {
    resetPlayButton();
    var code = ev && ev.error ? ev.error : '';
    // Expected when we replace or stop speech (e.g. new OCR run calls cancel, or user hits Stop).
    if (code === 'canceled' || code === 'interrupted') {
      return;
    }
    if (code) {
      console.warn('Speech synthesis:', code);
    } else {
      console.warn('Speech synthesis error', ev);
    }
  };

  // Cancel any prior utterance; defer speak so the browser can finish teardown (avoids flaky errors in Chrome).
  window.speechSynthesis.cancel();
  try {
    window.speechSynthesis.getVoices();
  } catch (e) {
    /* ignore */
  }
  setTimeout(function () {
    window.speechSynthesis.speak(utterance);
  }, 0);
}

function resetPlayButton() {
  playButton.classList.remove('playing');
  playIcon.textContent = '🔊';
  playText.textContent = 'Play Text';
}

function showPlayButton() {
  playButton.classList.remove('hidden');
}

function hidePlayButton() {
  playButton.classList.add('hidden');
  // Stop any ongoing speech when hiding the button
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  resetPlayButton();
}

async function recognize(imageSource, autoPlay) {
  showLoading();
  hidePlayButton(); // Hide play button while processing

  try {
    const result = await worker.recognize(imageSource);
    hideLoading();
    var extractedText = result.data.text.trim();

    if (extractedText) {
      // Clean up the text a bit
      var cleanText = extractedText.replace(/[()|/\\]/g, '');
      parsedContent.textContent = cleanText;
      showPlayButton(); // Show play button when text is available

      // Auto-play if requested (for canvas drawings)
      if (autoPlay) {
        speakText(cleanText);
      }
    } else {
      parsedContent.textContent =
        'No text could be extracted from this image. Please try with a clearer image containing readable text.';
      hidePlayButton();
    }
  } catch (error) {
    hideLoading();
    console.error('OCR Error:', error);
    parsedContent.textContent = 'Error processing image. Please try again with a different image.';
    hidePlayButton();
  }
}

// Mode switching functions
function showCanvasMode() {
  canvasContainer.classList.remove('hidden');
  uploadContainer.classList.add('hidden');
  canvasModeBtn.classList.add('active');
  uploadModeBtn.classList.remove('active');
}

function showUploadMode() {
  canvasContainer.classList.add('hidden');
  uploadContainer.classList.remove('hidden');
  canvasModeBtn.classList.remove('active');
  uploadModeBtn.classList.add('active');
}

function setupModeButtons() {
  canvasModeBtn.addEventListener('click', showCanvasMode);
  uploadModeBtn.addEventListener('click', showUploadMode);
}

// Canvas drawing functions
function setupCanvas() {
  // Undo/redo snapshots use getImageData often; this avoids the perf warning and opts into a faster readback path.
  canvasCtx = drawingCanvas.getContext('2d', { willReadFrequently: true });
  if (!canvasCtx) {
    canvasCtx = drawingCanvas.getContext('2d');
  }

  // Set up high DPI support
  setupHighDPICanvas();

  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  canvasCtx.strokeStyle = '#000000';
  canvasCtx.lineWidth = currentPenSize; // Use the thicker default for better OCR
  canvasCtx.globalCompositeOperation = 'source-over'; // Start with pen mode

  // Set canvas background to white for better OCR
  canvasCtx.fillStyle = 'white';
  canvasCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

  // Ensure pen tool is selected by default
  selectPenTool();

  initCanvasHistoryFromCurrent();

  setupEraserHoverOverlay();
}

function setupEraserHoverOverlay() {
  if (!drawingCanvas || !eraserHoverOverlay) return;
  eraserHoverOverlay.width = drawingCanvas.width;
  eraserHoverOverlay.height = drawingCanvas.height;
  eraserOverlayCtx = eraserHoverOverlay.getContext('2d', { alpha: true });
  eraserOverlayCtx.clearRect(0, 0, eraserHoverOverlay.width, eraserHoverOverlay.height);
  eraserOverlayImageData = null;
}

function isInkPixelAt(data, p) {
  return data[p] + data[p + 1] + data[p + 2] < INK_LUMA_SUM_MAX;
}

/** 4-connected ink blob from seed; returns Uint8Array mask (1 = ink) or null if seed not ink. */
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
  if (!eraserOverlayCtx || !mask) return;
  if (
    !eraserOverlayImageData ||
    eraserOverlayImageData.width !== w ||
    eraserOverlayImageData.height !== h
  ) {
    eraserOverlayImageData = eraserOverlayCtx.createImageData(w, h);
  }
  var od = eraserOverlayImageData.data;
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
  eraserOverlayCtx.putImageData(eraserOverlayImageData, 0, 0);
}

function clearEraserHover() {
  eraserHoverCell = -1;
  eraserHoverPendingEvent = null;
  if (eraserHoverRaf) {
    cancelAnimationFrame(eraserHoverRaf);
    eraserHoverRaf = 0;
  }
  if (eraserOverlayCtx && eraserHoverOverlay) {
    eraserOverlayCtx.clearRect(0, 0, eraserHoverOverlay.width, eraserHoverOverlay.height);
  }
}

function updateEraserHoverPreview(e) {
  if (!eraserOverlayCtx || !drawingCanvas || currentTool !== 'eraser') return;
  var w = drawingCanvas.width;
  var h = drawingCanvas.height;
  var c = getCanvasCoordinates(e);
  var ix = Math.floor(c.x);
  var iy = Math.floor(c.y);
  eraserHoverCell = iy * w + ix;

  var imageData = canvasCtx.getImageData(0, 0, w, h);
  var mask = floodFillInkMask(imageData, c.x, c.y);
  eraserOverlayCtx.clearRect(0, 0, w, h);
  if (!mask) return;
  drawMaskOnOverlay(mask, w, h);
}

function scheduleEraserHoverUpdate(e) {
  if (currentTool !== 'eraser') return;
  eraserHoverPendingEvent = e;
  if (eraserHoverRaf) return;
  eraserHoverRaf = requestAnimationFrame(function () {
    eraserHoverRaf = 0;
    if (currentTool !== 'eraser') return;
    var ev = eraserHoverPendingEvent;
    eraserHoverPendingEvent = null;
    if (ev) updateEraserHoverPreview(ev);
  });
}

function eraserApplyAtPointer(e) {
  if (!canvasCtx || !drawingCanvas) return;
  var w = drawingCanvas.width;
  var h = drawingCanvas.height;
  var c = getCanvasCoordinates(e);
  var imageData = canvasCtx.getImageData(0, 0, w, h);
  var mask = floodFillInkMask(imageData, c.x, c.y);
  if (!mask) {
    clearEraserHover();
    return;
  }
  applyWhiteFromMask(imageData, mask);
  canvasCtx.putImageData(imageData, 0, 0);
  clearEraserHover();
  pushCanvasHistoryAfterStroke();
}

function snapshotCanvasImageData() {
  return canvasCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
}

function restoreCanvasFromImageData(imageData) {
  canvasCtx.putImageData(imageData, 0, 0);
}

function initCanvasHistoryFromCurrent() {
  canvasHistoryStates = [snapshotCanvasImageData()];
  canvasHistoryIndex = 0;
  updateUndoRedoButtons();
}

function pushCanvasHistoryAfterStroke() {
  var snap = snapshotCanvasImageData();
  canvasHistoryStates = canvasHistoryStates.slice(0, canvasHistoryIndex + 1);
  canvasHistoryStates.push(snap);
  canvasHistoryIndex = canvasHistoryStates.length - 1;
  while (canvasHistoryStates.length > MAX_CANVAS_HISTORY) {
    canvasHistoryStates.shift();
    canvasHistoryIndex--;
  }
  updateUndoRedoButtons();
  autoSaveCanvas();
}

function undoCanvas() {
  if (canvasHistoryIndex <= 0) return;
  canvasHistoryIndex--;
  restoreCanvasFromImageData(canvasHistoryStates[canvasHistoryIndex]);
  updateUndoRedoButtons();
  autoSaveCanvas();
}

function redoCanvas() {
  if (canvasHistoryIndex >= canvasHistoryStates.length - 1) return;
  canvasHistoryIndex++;
  restoreCanvasFromImageData(canvasHistoryStates[canvasHistoryIndex]);
  updateUndoRedoButtons();
  autoSaveCanvas();
}

function updateUndoRedoButtons() {
  if (!undoCanvasBtn || !redoCanvasBtn) return;
  undoCanvasBtn.disabled = canvasHistoryIndex <= 0;
  redoCanvasBtn.disabled = canvasHistoryIndex >= canvasHistoryStates.length - 1;
}

function setupHighDPICanvas() {
  // Temporarily disable high DPI scaling to fix coordinate issues
  // Keep canvas at standard resolution for consistent mouse/touch alignment

  // The canvas coordinate system should remain simple:
  // - Canvas element: 800x400 pixels
  // - Display size: matches CSS or scales proportionally
  // - No internal scaling transformations

  return; // Skip DPI scaling for now
}

function startDrawing(e) {
  canvasStatus.classList.add('hidden');

  if (currentTool === 'eraser') {
    eraserApplyAtPointer(e);
    return;
  }

  isDrawing = true;
  draw(e);
}

function draw(e) {
  if (currentTool === 'eraser') {
    scheduleEraserHoverUpdate(e);
    return;
  }

  if (!isDrawing) return;

  var coords = getCanvasCoordinates(e);
  var x = coords.x;
  var y = coords.y;

  canvasCtx.lineWidth = currentPenSize;
  canvasCtx.globalCompositeOperation = 'source-over';

  canvasCtx.lineTo(x, y);
  canvasCtx.stroke();
  canvasCtx.beginPath();
  canvasCtx.moveTo(x, y);
}

function getCanvasCoordinates(e) {
  var rect = drawingCanvas.getBoundingClientRect();
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

  // Calculate coordinates relative to canvas display size
  var x = clientX - rect.left;
  var y = clientY - rect.top;

  // Scale to canvas coordinate system if canvas is scaled via CSS
  var canvasDisplayWidth = rect.width;
  var canvasDisplayHeight = rect.height;
  var canvasActualWidth = drawingCanvas.width;
  var canvasActualHeight = drawingCanvas.height;

  // Only apply scaling if there's a difference between display and actual size
  if (canvasDisplayWidth !== canvasActualWidth || canvasDisplayHeight !== canvasActualHeight) {
    x = (x * canvasActualWidth) / canvasDisplayWidth;
    y = (y * canvasActualHeight) / canvasDisplayHeight;
  }

  // Clamp coordinates to canvas bounds
  x = Math.max(0, Math.min(x, canvasActualWidth));
  y = Math.max(0, Math.min(y, canvasActualHeight));

  return { x: x, y: y };
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  canvasCtx.beginPath();

  pushCanvasHistoryAfterStroke();
}

function handleCanvasMouseOut() {
  if (currentTool === 'eraser') {
    clearEraserHover();
    return;
  }
  stopDrawing();
}

function clearCanvas() {
  clearEraserHover();
  canvasCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  canvasCtx.fillStyle = 'white';
  canvasCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  hideResults();

  // Clear saved drawing from localStorage
  clearCanvasStorage();

  // Hide status message
  canvasStatus.classList.add('hidden');

  // Reset to pen tool
  selectPenTool();

  // Push blank canvas onto history so Clear is undoable (like any other edit)
  pushCanvasHistoryAfterStroke();
}

function updatePenSize() {
  currentPenSize = penSizeSlider.value;
  penSizeSlider.setAttribute('aria-valuenow', String(currentPenSize));
}

// Tool switching functions
function selectPenTool() {
  clearEraserHover();
  currentTool = 'pen';
  penToolBtn.classList.add('active');
  eraserToolBtn.classList.remove('active');
  penToolBtn.setAttribute('aria-pressed', 'true');
  eraserToolBtn.setAttribute('aria-pressed', 'false');
  drawingCanvas.classList.remove('eraser-mode');

  // Reset canvas context for drawing
  canvasCtx.globalCompositeOperation = 'source-over';
}

function selectEraserTool() {
  clearEraserHover();
  currentTool = 'eraser';
  penToolBtn.classList.remove('active');
  eraserToolBtn.classList.add('active');
  penToolBtn.setAttribute('aria-pressed', 'false');
  eraserToolBtn.setAttribute('aria-pressed', 'true');
  drawingCanvas.classList.add('eraser-mode');

  canvasCtx.globalCompositeOperation = 'source-over';
}

/** True when focus is in a control where Ctrl+Enter should not run OCR (typing, selects, etc.). */
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

function setupToolButtons() {
  penToolBtn.addEventListener('click', selectPenTool);
  eraserToolBtn.addEventListener('click', selectEraserTool);

  // Add keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (canvasContainer.classList.contains('hidden')) return;

    // Read & say: Ctrl+Enter or ⌘+Enter (still works when focus is on pen size slider or a button)
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') {
      if (isLikelyTextEditingTarget(e.target)) return;
      e.preventDefault();
      readCanvasDrawing();
      return;
    }

    // Pen, eraser, undo, redo: skip when typing in text fields (range slider excluded here)
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

function setupCanvasEvents() {
  // Mouse events
  drawingCanvas.addEventListener('mousedown', startDrawing);
  drawingCanvas.addEventListener('mousemove', draw);
  drawingCanvas.addEventListener('mouseup', stopDrawing);
  drawingCanvas.addEventListener('mouseout', handleCanvasMouseOut);

  // Touch events for mobile - enhanced for better mobile experience
  drawingCanvas.addEventListener(
    'touchstart',
    function (e) {
      e.preventDefault();
      if (currentTool === 'eraser') {
        var c0 = getCanvasCoordinates(e);
        eraserTouchStartX = c0.x;
        eraserTouchStartY = c0.y;
        eraserTouchMaxDistSq = 0;
        lastEraserTouchMoveAt = Date.now();
        scheduleEraserHoverUpdate(e);
        return;
      }
      startDrawing(e);
    },
    { passive: false }
  );

  drawingCanvas.addEventListener(
    'touchmove',
    function (e) {
      e.preventDefault();
      if (currentTool === 'eraser') {
        var c1 = getCanvasCoordinates(e);
        var dx = c1.x - eraserTouchStartX;
        var dy = c1.y - eraserTouchStartY;
        var d2 = dx * dx + dy * dy;
        if (d2 > eraserTouchMaxDistSq) {
          eraserTouchMaxDistSq = d2;
        }
        lastEraserTouchMoveAt = Date.now();
      }
      draw(e);
    },
    { passive: false }
  );

  drawingCanvas.addEventListener(
    'touchend',
    function (e) {
      e.preventDefault();
      if (currentTool === 'eraser') {
        var idleMs = Date.now() - lastEraserTouchMoveAt;
        var tapLike = eraserTouchMaxDistSq < 26 * 26;
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

  drawingCanvas.addEventListener(
    'touchcancel',
    function (e) {
      e.preventDefault();
      if (currentTool === 'eraser') {
        clearEraserHover();
      } else {
        stopDrawing();
      }
    },
    { passive: false }
  );

  // Control events
  clearCanvasBtn.addEventListener('click', clearCanvas);
  penSizeSlider.addEventListener('input', updatePenSize);
  readDrawingBtn.addEventListener('click', readCanvasDrawing);
  undoCanvasBtn.addEventListener('click', undoCanvas);
  redoCanvasBtn.addEventListener('click', redoCanvas);
}

function readCanvasDrawing() {
  // Convert canvas to image data
  var imageData = drawingCanvas.toDataURL('image/png');

  // Save drawing to localStorage after submission
  saveCanvasToStorage();

  // Show results and process with OCR (with auto-play)
  showResults();
  displayImage(imageData);
  recognize(imageData, true); // Auto-play the extracted text
}

// Canvas persistence functions
function saveCanvasToStorage() {
  try {
    var imageData = drawingCanvas.toDataURL('image/png');
    localStorage.setItem('sayit-canvas-drawing', imageData);
    console.log('Canvas saved to localStorage');
  } catch (error) {
    console.error('Failed to save canvas to localStorage:', error);
  }
}

function loadCanvasFromStorage() {
  try {
    var savedImageData = localStorage.getItem('sayit-canvas-drawing');
    if (savedImageData) {
      var img = new Image();
      img.onload = function () {
        // Clear canvas first
        canvasCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        canvasCtx.fillStyle = 'white';
        canvasCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

        // Draw the saved image
        canvasCtx.drawImage(img, 0, 0);
        console.log('Canvas restored from localStorage');

        initCanvasHistoryFromCurrent();
        clearEraserHover();
        setupEraserHoverOverlay();

        // Show status message
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
  canvasStatus.classList.remove('hidden');
  // Hide the status message after 3 seconds
  setTimeout(function () {
    canvasStatus.classList.add('hidden');
  }, 3000);
}

function clearCanvasStorage() {
  try {
    localStorage.removeItem('sayit-canvas-drawing');
    console.log('Canvas storage cleared');
  } catch (error) {
    console.error('Failed to clear canvas storage:', error);
  }
}

function autoSaveCanvas() {
  // Debounce auto-save to avoid constant localStorage writes
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(function () {
    saveCanvasToStorage();
  }, 1000); // Save 1 second after user stops drawing
}

window.onload = function () {
  // Get DOM elements
  dropZone = document.getElementById('dropZone');
  imageUpload = document.getElementById('imageUpload');
  sampleImage = document.getElementById('sampleImage');
  loading = document.getElementById('loading');
  results = document.getElementById('results');
  imgPreview = document.getElementById('imgPreview');
  parsedContent = document.getElementById('parsedContent');
  playButton = document.getElementById('playButton');
  playIcon = document.getElementById('playIcon');
  playText = document.getElementById('playText');

  // Get mode switching elements
  canvasModeBtn = document.getElementById('canvasMode');
  uploadModeBtn = document.getElementById('uploadMode');
  canvasContainer = document.getElementById('canvasContainer');
  uploadContainer = document.getElementById('uploadContainer');

  // Get canvas elements
  drawingCanvas = document.getElementById('drawingCanvas');
  eraserHoverOverlay = document.getElementById('eraserHoverOverlay');
  clearCanvasBtn = document.getElementById('clearCanvas');
  penSizeSlider = document.getElementById('penSize');
  readDrawingBtn = document.getElementById('readDrawing');
  canvasStatus = document.getElementById('canvasStatus');
  penToolBtn = document.getElementById('penTool');
  eraserToolBtn = document.getElementById('eraserTool');
  undoCanvasBtn = document.getElementById('undoCanvas');
  redoCanvasBtn = document.getElementById('redoCanvas');

  // Initialize Tesseract worker
  initializeTesseract();

  // Setup mode switching
  setupModeButtons();

  // Setup canvas drawing
  setupCanvas();
  setupCanvasEvents();
  setupToolButtons();

  // Restore saved drawing from localStorage
  loadCanvasFromStorage();

  // Setup drag and drop functionality (for upload mode)
  setupDragAndDrop();

  // Setup file input (for upload mode)
  setupFileInput();

  // Setup sample image dragging (for upload mode)
  setupSampleImageDrag();

  // Setup play button
  setupPlayButton();

  // Set canvas mode as default
  showCanvasMode();
};
