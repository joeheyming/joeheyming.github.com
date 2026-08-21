import { S } from './sayit-state.js';
import { showAppMessage, resetPlayButton } from './sayit-ui.js';

export function setupPlayButton() {
  S.playButton.addEventListener('click', function () {
    var text = S.parsedContent.textContent;

    if (
      !text ||
      text === 'Processing...' ||
      text.includes('Error') ||
      text.includes('No text could be extracted')
    ) {
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      resetPlayButton();
    } else {
      speakText(text);
    }
  });
}

export function speakText(text) {
  if (!window.speechSynthesis) {
    showAppMessage('Speech synthesis is not supported in this browser.', true);
    return;
  }

  var trimmed = (text || '').trim();
  if (!trimmed) {
    return;
  }

  S.playButton.classList.add('playing');
  S.playIcon.textContent = '⏸️';
  S.playText.textContent = 'Stop';

  var utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = 0.8;

  utterance.onend = function () {
    resetPlayButton();
  };

  utterance.onerror = function (ev) {
    resetPlayButton();
    var code = ev && ev.error ? ev.error : '';
    if (code === 'canceled' || code === 'interrupted') {
      return;
    }
    if (code) {
      console.warn('Speech synthesis:', code);
    } else {
      console.warn('Speech synthesis error', ev);
    }
  };

  window.speechSynthesis.cancel();
  try {
    window.speechSynthesis.getVoices();
  } catch (e) {
    /* ignore */
  }
  setTimeout(function () {
    window.speechSynthesis.speak(utterance);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }, 0);
}
