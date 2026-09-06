/**
 * WebMIDI input wrapper. Listens to all current and future input devices and
 * fires `noteOn(midi)` / `noteOff(midi)` callbacks. Also toggles a status
 * element so the page can show "MIDI connected".
 *
 * Silently no-ops on browsers without WebMIDI (Safari, Firefox by default).
 */

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
