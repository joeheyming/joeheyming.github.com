// Speech and Media Commands for Heyming Terminal
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

  const speechCommands = {
    say: {
      handler: (terminal, args) => {
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
      },
      description: 'speak text aloud'
    },

    hollywood: {
      handler: (terminal, args) => {
        setTimeout(() => {
          terminal.addOutput('🎬 Hollywood Terminal Simulation Starting...');
          terminal.addOutput('');
          terminal.addOutput('HOLLYWOOD TERMINAL - System Monitor v2.0');
          terminal.addOutput('═'.repeat(50));
          terminal.addOutput('');

          // Simulate multiple monitoring panels
          const panels = [
            'Network Traffic: eth0: 1.2MB/s ↑ 856KB/s ↓',
            'System Load: Load: 0.52, 0.58, 0.55',
            'Process Monitor: PID 1234: terminal (2.1% CPU)',
            'Memory Usage: Total: 16GB, Used: 8.2GB (51%)',
            'Disk I/O: sda: 45MB/s read, 23MB/s write',
            'Temperature: CPU: 42°C, GPU: 38°C',
            'Network: Packets: 1,234,567 in, 987,654 out',
            'Security: No threats detected'
          ];

          let panelIndex = 0;
          const interval = setInterval(() => {
            terminal.addOutput(
              `[${new Date().toLocaleTimeString()}] ${panels[panelIndex % panels.length]}`
            );
            panelIndex++;

            if (panelIndex >= 20) {
              clearInterval(interval);
              terminal.addOutput('');
              terminal.addOutput('🎬 Hollywood Terminal Simulation Complete!');
            }
          }, 500);
        }, 100);

        return '';
      },
      description: 'Hollywood terminal simulation'
    }
  };

  // Initialize voices when module loads
  initializeVoices();

  // Register all speech commands
  Object.entries(speechCommands).forEach(([name, cmd]) => {
    registerCommand(name, cmd.handler, cmd.description, 'Speech & Media');
  });
})();
