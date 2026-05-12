import { S } from './sayit-state.js';
import { showAppMessage, showResults, displayImage } from './sayit-ui.js';
import { recognize } from './sayit-tesseract.js';

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight(e) {
  S.dropZone.classList.add('dragover');
}

function unhighlight(e) {
  S.dropZone.classList.remove('dragover');
}

function handleDrop(e) {
  var dt = e.dataTransfer;

  var imageSource = dt.getData('image-source');
  if (imageSource === 'sample') {
    handleSampleImageDrop();
    return;
  }

  var files = dt.files;
  if (files.length > 0) {
    handleFiles(files);
  }
}

function handleSampleImageDrop() {
  showResults();
  displayImage(S.sampleImage.src);
  recognize(S.sampleImage.src, false);
}

function handleFiles(files) {
  if (files.length > 0) {
    var file = files[0];

    if (!file.type.startsWith('image/')) {
      showAppMessage('Please select an image file (JPG, PNG, GIF, BMP).', true);
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      showResults();
      displayImage(e.target.result);
      recognize(e.target.result, false);
    };
    reader.readAsDataURL(file);
  }
}

export function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    S.dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    S.dropZone.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    S.dropZone.addEventListener(eventName, unhighlight, false);
  });

  S.dropZone.addEventListener('drop', handleDrop, false);

  S.dropZone.addEventListener('click', () => {
    S.imageUpload.click();
  });
}

export function setupFileInput() {
  S.imageUpload.addEventListener('change', function (e) {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });
}

export function setupSampleImageDrag() {
  S.sampleImage.addEventListener('dragstart', function (e) {
    e.dataTransfer.setData('text/plain', S.sampleImage.src);
    e.dataTransfer.setData('image-source', 'sample');
  });
}
