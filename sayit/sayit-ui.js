import { S } from './sayit-state.js';

export function showAppMessage(message, isError) {
  if (!S.sayitAppMessageEl) {
    S.sayitAppMessageEl = document.getElementById('sayitAppMessage');
  }
  if (!S.sayitAppMessageEl) return;
  if (S.sayitAppMessageTimer) {
    clearTimeout(S.sayitAppMessageTimer);
    S.sayitAppMessageTimer = null;
  }
  S.sayitAppMessageEl.textContent = message;
  S.sayitAppMessageEl.classList.remove('hidden');
  if (isError) {
    S.sayitAppMessageEl.classList.add('sayit-app-message--error');
  } else {
    S.sayitAppMessageEl.classList.remove('sayit-app-message--error');
  }
  S.sayitAppMessageTimer = setTimeout(function () {
    S.sayitAppMessageEl.classList.add('hidden');
    S.sayitAppMessageEl.textContent = '';
    S.sayitAppMessageTimer = null;
  }, 6500);
}

export function showResults() {
  S.results.style.display = 'flex';
}

export function hideResults() {
  S.results.style.display = 'none';
}

export function displayImage(src) {
  S.imgPreview.src = src;
}

export function showLoading() {
  S.loading.classList.remove('hidden');
  S.parsedContent.textContent = 'Processing image...';
}

export function hideLoading() {
  S.loading.classList.add('hidden');
}

export function showPlayButton() {
  S.playButton.classList.remove('hidden');
}

export function hidePlayButton() {
  S.playButton.classList.add('hidden');
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  resetPlayButton();
}

export function resetPlayButton() {
  S.playButton.classList.remove('playing');
  S.playIcon.textContent = '🔊';
  S.playText.textContent = 'Play Text';
}
