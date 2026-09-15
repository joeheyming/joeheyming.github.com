import { S } from './sayit-state.js';
import {
  setupCanvas,
  setupCanvasEvents,
  setupToolButtons,
  loadCanvasFromStorage
} from './sayit-canvas.js';
import { initializeTesseract } from './sayit-tesseract.js';
import { setupPlayButton } from './sayit-tts.js';
import { setupDragAndDrop, setupFileInput, setupSampleImageDrag } from './sayit-upload.js';

function showCanvasMode() {
  S.canvasContainer.classList.remove('hidden');
  S.uploadContainer.classList.add('hidden');
  S.canvasModeBtn.classList.add('active');
  S.uploadModeBtn.classList.remove('active');
}

function showUploadMode() {
  S.canvasContainer.classList.add('hidden');
  S.uploadContainer.classList.remove('hidden');
  S.canvasModeBtn.classList.remove('active');
  S.uploadModeBtn.classList.add('active');
}

function setupModeButtons() {
  S.canvasModeBtn.addEventListener('click', showCanvasMode);
  S.uploadModeBtn.addEventListener('click', showUploadMode);
}

function initSayit() {
  S.dropZone = document.getElementById('dropZone');
  S.imageUpload = document.getElementById('imageUpload');
  S.sampleImage = document.getElementById('sampleImage');
  S.loading = document.getElementById('loading');
  S.results = document.getElementById('results');
  S.imgPreview = document.getElementById('imgPreview');
  S.parsedContent = document.getElementById('parsedContent');
  S.playButton = document.getElementById('playButton');
  S.playIcon = document.getElementById('playIcon');
  S.playText = document.getElementById('playText');

  S.canvasModeBtn = document.getElementById('canvasMode');
  S.uploadModeBtn = document.getElementById('uploadMode');
  S.canvasContainer = document.getElementById('canvasContainer');
  S.uploadContainer = document.getElementById('uploadContainer');

  S.drawingCanvas = document.getElementById('drawingCanvas');
  S.eraserHoverOverlay = document.getElementById('eraserHoverOverlay');
  S.clearCanvasBtn = document.getElementById('clearCanvas');
  S.penSizeSlider = document.getElementById('penSize');
  S.readDrawingBtn = document.getElementById('readDrawing');
  S.canvasStatus = document.getElementById('canvasStatus');
  S.penToolBtn = document.getElementById('penTool');
  S.eraserToolBtn = document.getElementById('eraserTool');
  S.undoCanvasBtn = document.getElementById('undoCanvas');
  S.redoCanvasBtn = document.getElementById('redoCanvas');

  initializeTesseract();

  setupModeButtons();

  setupCanvas();
  setupCanvasEvents();
  setupToolButtons();

  loadCanvasFromStorage();

  setupDragAndDrop();

  setupFileInput();

  setupSampleImageDrag();

  setupPlayButton();

  showCanvasMode();
}

if (document.readyState !== 'loading') {
  initSayit();
} else {
  document.addEventListener('DOMContentLoaded', initSayit);
}
