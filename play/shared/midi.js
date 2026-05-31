/**
 * WebMIDI input wrapper. Listens to all current and future input devices and
 * fires `noteOn(midi)` / `noteOff(midi)` callbacks. Also toggles a status
 * element so the page can show "MIDI connected".
 *
 * Silently no-ops on browsers without WebMIDI (Safari, Firefox by default).
 *
 * Fires one `midi_first_play` GA event the first time the user actually
 * plays a note on a connected MIDI device. We only need to know whether
 * MIDI is used in the wild; per-note events would dwarf every other GA
 * event on the site. The flag is module-scoped, so multiple instruments
 * sharing this wrapper still report at most once per page load.
 */

let firstPlayTracked = false;

function instrumentNameFromPath() {
  const m = location.pathname.match(/\/play\/([^/]+)\//);
  return m ? m[1] : location.pathname;
}

function trackFirstMidiPlay() {
  if (firstPlayTracked) return;
  firstPlayTracked = true;
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('midi_first_play', 'MIDI', instrumentNameFromPath());
  }
}

export function setupMidi({ onNoteOn, onNoteOff, statusEl }) {
  if (!navigator.requestMIDIAccess) return;

  const showStatus = (visible) => {
    if (!statusEl) return;
    statusEl.hidden = !visible;
  };

  const handleMessage = (event) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    const note = data[1];
    const velocity = data.length > 2 ? data[2] : 0;
    const command = status & 0xf0;

    if (command === 0x90 && velocity > 0) {
      trackFirstMidiPlay();
      onNoteOn?.(note, velocity / 127);
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      onNoteOff?.(note);
    }
  };

  const attach = (input) => {
    input.removeEventListener('midimessage', handleMessage);
    input.addEventListener('midimessage', handleMessage);
  };

  navigator
    .requestMIDIAccess()
    .then((access) => {
      const updateStatus = () => {
        let any = false;
        for (const input of access.inputs.values()) {
          if (input.state === 'connected') any = true;
          attach(input);
        }
        showStatus(any);
      };
      updateStatus();
      access.addEventListener('statechange', updateStatus);
    })
    .catch(() => {
      /* permission denied or unsupported - silently skip */
    });
}
