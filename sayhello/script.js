window.addEventListener('load', function () {
  var voiceLookup = {};
  window.speechSynthesis.onvoiceschanged = function () {
    window.speechSynthesis.getVoices();
    var voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      Array.from(voices).forEach(function (voice, i) {
        voiceLookup[voice.name] = voice;
        var option = window.document.createElement('option');
        option.value = voice.name;
        option.textContent = voice.name;
        window.voiceSelector.appendChild(option);
      });
    } else {
      window.voiceSelector.setAttribute('hidden', '');
    }
  };
  window.helloForm.onsubmit = function sayHello(event) {
    event.preventDefault();
    var currentUtterance = window.utterance.value;
    var voiceValue = window.voiceSelector.value;
    var voice = voiceLookup[voiceValue];
    // Show speaking indicator
    var indicator = document.getElementById('speakingIndicator');
    indicator.classList.add('active');

    var utter = new SpeechSynthesisUtterance(currentUtterance);
    if (voice) {
      utter.voice = voice;
    }
    utter.onend = function () {
      indicator.classList.remove('active');
    };
    window.speechSynthesis.speak(utter);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  };

  // Add keyboard shortcut: Cmd+Enter or Ctrl+Enter to submit
  window.utterance.onkeydown = function (event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      window.helloForm.dispatchEvent(new Event('submit'));
    }
  };

  // Configure share button with context
  var shareBtn = document.querySelector('share-button');
  if (shareBtn) {
    shareBtn.textGenerator = function () {
      var text = window.utterance.value.trim();
      if (text) {
        var preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
        return 'I just made my browser say: "' + preview + '" using Say Hello! 🗣️';
      }
      return 'Check out Say Hello - a text-to-speech tool! 🗣️';
    };
  }
});
