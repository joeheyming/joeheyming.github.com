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
  recognize(sampleImage.src);
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
      recognize(e.target.result);
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

function recognize(imageSource) {
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

  // Initialize Tesseract worker
  initializeTesseract();

  // Setup drag and drop functionality
  setupDragAndDrop();

  // Setup file input
  setupFileInput();

  // Setup sample image dragging
  setupSampleImageDrag();

  // Setup play button
  setupPlayButton();
};
