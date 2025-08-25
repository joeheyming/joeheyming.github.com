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
var drawingCanvas, canvasCtx, clearCanvasBtn, penSizeSlider, readDrawingBtn, canvasStatus;
var penToolBtn, eraserToolBtn;

// Drawing state
var isDrawing = false;
var currentPenSize = 15; // 75% thickness for better OCR
var currentTool = 'pen'; // 'pen' or 'eraser'
var autoSaveTimeout;

function initializeTesseract() {
  worker = Tesseract.createWorker();
  var OEM = Tesseract.OEM;
  var PSM = Tesseract.PSM;

  worker
    .load()
    .then(function () {
      return worker.loadLanguage('eng');
    })
    .then(function () {
      return worker.initialize('eng');
    })
    .then(function () {
      return worker.setParameters({
        init_oem: OEM.TESSERACT_ONLY,
        tessedit_pageseg_mode: '6',
        tessedit_char_whitelist: '',
        tessjs_create_box: '0',
        tessjs_create_hocr: '1',
        tessjs_create_osd: '0',
        tessjs_create_tsv: '1',
        tessjs_create_unlv: '0'
      });
    })
    .then(function () {
      console.log('Tesseract initialized successfully');
    })
    .catch(function (error) {
      console.log('Tesseract initialization error:', error);
    });
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
      alert('Please select an image file (JPG, PNG, GIF, BMP)');
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
    alert('Speech synthesis not supported in your browser');
    return;
  }

  // Update button to show playing state
  playButton.classList.add('playing');
  playIcon.textContent = '⏸️';
  playText.textContent = 'Stop';

  var utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.8; // Slightly slower for clarity

  utterance.onend = function () {
    resetPlayButton();
  };

  utterance.onerror = function () {
    resetPlayButton();
    console.error('Speech synthesis error');
  };

  window.speechSynthesis.speak(utterance);
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

function recognize(imageSource, autoPlay) {
  showLoading();
  hidePlayButton(); // Hide play button while processing

  worker
    .recognize(imageSource, 'eng')
    .then(function (result) {
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
    })
    .catch(function (error) {
      hideLoading();
      console.error('OCR Error:', error);
      parsedContent.textContent =
        'Error processing image. Please try again with a different image.';
      hidePlayButton();
    });
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
  canvasCtx = drawingCanvas.getContext('2d');

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
  isDrawing = true;
  // Hide status message when user starts drawing
  canvasStatus.classList.add('hidden');

  // Debug: Log coordinate info for troubleshooting
  var coords = getCanvasCoordinates(e);
  console.log('Drawing started at:', coords.x, coords.y, 'Event type:', e.type);

  draw(e);
}

function draw(e) {
  if (!isDrawing) return;

  // Get accurate coordinates for both mouse and touch events
  var coords = getCanvasCoordinates(e);
  var x = coords.x;
  var y = coords.y;

  canvasCtx.lineWidth = currentPenSize;

  // Set composite operation based on current tool
  if (currentTool === 'eraser') {
    canvasCtx.globalCompositeOperation = 'destination-out';
  } else {
    canvasCtx.globalCompositeOperation = 'source-over';
  }

  canvasCtx.lineTo(x, y);
  canvasCtx.stroke();
  canvasCtx.beginPath();
  canvasCtx.moveTo(x, y);
}

function getCanvasCoordinates(e) {
  var rect = drawingCanvas.getBoundingClientRect();
  var clientX, clientY;

  // Handle both mouse and touch events
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
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

  // Auto-save canvas after drawing stroke
  autoSaveCanvas();
}

function clearCanvas() {
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
}

function updatePenSize() {
  currentPenSize = penSizeSlider.value;
}

// Tool switching functions
function selectPenTool() {
  currentTool = 'pen';
  penToolBtn.classList.add('active');
  eraserToolBtn.classList.remove('active');
  drawingCanvas.classList.remove('eraser-mode');

  // Reset canvas context for drawing
  canvasCtx.globalCompositeOperation = 'source-over';
}

function selectEraserTool() {
  currentTool = 'eraser';
  penToolBtn.classList.remove('active');
  eraserToolBtn.classList.add('active');
  drawingCanvas.classList.add('eraser-mode');

  // Set canvas context for erasing
  canvasCtx.globalCompositeOperation = 'destination-out';
}

function setupToolButtons() {
  penToolBtn.addEventListener('click', selectPenTool);
  eraserToolBtn.addEventListener('click', selectEraserTool);

  // Add keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Only work in canvas mode and when not typing in inputs
    if (
      canvasContainer.classList.contains('hidden') ||
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA'
    ) {
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      selectPenTool();
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      selectEraserTool();
    }
  });
}

function setupCanvasEvents() {
  // Mouse events
  drawingCanvas.addEventListener('mousedown', startDrawing);
  drawingCanvas.addEventListener('mousemove', draw);
  drawingCanvas.addEventListener('mouseup', stopDrawing);
  drawingCanvas.addEventListener('mouseout', stopDrawing);

  // Touch events for mobile - enhanced for better mobile experience
  drawingCanvas.addEventListener(
    'touchstart',
    function (e) {
      e.preventDefault(); // Prevent scrolling
      startDrawing(e); // Pass the touch event directly
    },
    { passive: false }
  );

  drawingCanvas.addEventListener(
    'touchmove',
    function (e) {
      e.preventDefault(); // Prevent scrolling while drawing
      draw(e); // Pass the touch event directly
    },
    { passive: false }
  );

  drawingCanvas.addEventListener(
    'touchend',
    function (e) {
      e.preventDefault();
      stopDrawing(); // No event needed for stop
    },
    { passive: false }
  );

  // Prevent touch scrolling on the canvas area
  drawingCanvas.addEventListener(
    'touchcancel',
    function (e) {
      e.preventDefault();
      stopDrawing(); // No event needed for stop
    },
    { passive: false }
  );

  // Control events
  clearCanvasBtn.addEventListener('click', clearCanvas);
  penSizeSlider.addEventListener('input', updatePenSize);
  readDrawingBtn.addEventListener('click', readCanvasDrawing);
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
  clearCanvasBtn = document.getElementById('clearCanvas');
  penSizeSlider = document.getElementById('penSize');
  readDrawingBtn = document.getElementById('readDrawing');
  canvasStatus = document.getElementById('canvasStatus');
  penToolBtn = document.getElementById('penTool');
  eraserToolBtn = document.getElementById('eraserTool');

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
