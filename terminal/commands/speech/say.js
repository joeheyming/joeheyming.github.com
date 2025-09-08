// say command - speak text aloud
(function () {
  'use strict';

  // Speech synthesis state
  let voicesLoaded = false;
  let voicesReadyCallback = null;

  // Initialize voices
  function initializeVoices() {
    const synth = window.speechSynthesis;
    synth.onvoiceschanged = () => {
      voicesLoaded = true;
      if (voicesReadyCallback) {
        voicesReadyCallback();
        voicesReadyCallback = null;
      }
    };
  }

  // Speech synthesis helper
  function say(text, voiceName) {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const selectedVoice = voices.find((voice) => voice.name === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    synth.speak(utterance);
  }

  // List available voices
  function listVoices() {
    if (!voicesLoaded) {
      voicesReadyCallback = () => listVoices();
      return 'Loading voices, please try again.';
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voiceList = voices.map((voice) => voice.name).join('\n  ');
    return `Available voices:\n  ${voiceList}`;
  }

  // Show say help
  function showSayHelp() {
    return `say [text] - Speak the text with the default voice
say --voice [voiceName] [text] - Speak the text with the specified voice
say --list - List available voices
say --help - Show this help message`;
  }

  // Initialize voices when module loads
  initializeVoices();

  registerCommand('say', (terminal, args) => {
    if (args.includes('--list')) {
      return listVoices();
    }
    if (args.includes('--help')) {
      return showSayHelp();
    }
    const voiceIndex = args.indexOf('--voice');
    let voiceName = 'Google US English'; // Default voice
    if (voiceIndex !== -1 && args[voiceIndex + 1]) {
      voiceName = args[voiceIndex + 1];
      args.splice(voiceIndex, 2); // Remove --voice and its value
    }
    const text = args.join(' ');
    say(text, voiceName);
    return `🔊 Speaking: "${text}"`;
  }, 'speak text aloud', 'Speech & Media');
})();
