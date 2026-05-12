import { S } from './sayit-state.js';
import { hideLoading, hidePlayButton, showLoading, showPlayButton } from './sayit-ui.js';
import { speakText } from './sayit-tts.js';

export async function initializeTesseract() {
  try {
    S.worker = await Tesseract.createWorker('eng');

    await S.worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: ''
    });

    console.log('Tesseract initialized successfully');
  } catch (error) {
    console.log('Tesseract initialization error:', error);
  }
}

export async function recognize(imageSource, autoPlay) {
  showLoading();
  hidePlayButton();

  try {
    const result = await S.worker.recognize(imageSource);
    hideLoading();
    var extractedText = result.data.text.trim();

    if (extractedText) {
      var cleanText = extractedText.replace(/[()|/\\]/g, '');
      S.parsedContent.textContent = cleanText;
      showPlayButton();

      if (autoPlay) {
        speakText(cleanText);
      }
    } else {
      S.parsedContent.textContent =
        'No text could be extracted from this image. Please try with a clearer image containing readable text.';
      hidePlayButton();
    }
  } catch (error) {
    hideLoading();
    console.error('OCR Error:', error);
    S.parsedContent.textContent =
      'Error processing image. Please try again with a different image.';
    hidePlayButton();
  }
}
