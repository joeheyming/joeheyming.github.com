import { midiToName, resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { attachKeyboardInput } from '../shared/input.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { parseDwp, DwpParseError } from './dwp-parser.js';
import { EXAMPLES, exampleById } from './examples/examples.js';
import { SamplerEngine } from './sampler-engine.js';

const MAX_FILE_BYTES = 160 * 1024 * 1024;
const LAYOUTS = {
  25: { startMidi: 48, whiteKeyCount: 15 },
  49: { startMidi: 36, whiteKeyCount: 29 },
  61: { startMidi: 36, whiteKeyCount: 36 },
  88: { startMidi: 21, whiteKeyCount: 52 }
};

const fileInput = document.getElementById('dwp-file');
const chooseFileButton = document.getElementById('choose-file');
const dropZone = document.getElementById('drop-zone');
const loadStatus = document.getElementById('load-status');
const loadError = document.getElementById('load-error');
const soundSelect = document.getElementById('sound');
const programName = document.getElementById('program-name');
const programFormat = document.getElementById('program-format');
const programDescription = document.getElementById('program-description');
const zoneCount = document.getElementById('zone-count');
const keyRange = document.getElementById('key-range');
const layerCount = document.getElementById('layer-count');
const zoneMap = document.getElementById('zone-map');
const keyboardEl = document.getElementById('piano-keyboard');
const nowPlaying = document.getElementById('now-playing');
const midiStatus = document.getElementById('midi-status');
const volume = document.getElementById('volume');
const layout = document.getElementById('layout');
const sustain = document.getElementById('sustain');
const showNotes = document.getElementById('show-notes');
const octaveDown = document.getElementById('octave-down');
const octaveUp = document.getElementById('octave-up');
const octaveDisplay = document.getElementById('octave-display');

const engine = new SamplerEngine();
const loadedFiles = new Map();
let layoutConfig = LAYOUTS[layout.value];
let octaveOffset = 0;
let nowPlayingTimer = null;

setMasterVolume(Number(volume.value) / 100);

const setStatus = (message) => {
  loadStatus.textContent = message;
};

const setLoadError = (message) => {
  loadError.textContent = message;
};

const announceNote = (midi) => {
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => nowPlaying.classList.remove('active'), 450);
};

const keyboard = new Keyboard(keyboardEl, {
  startMidi: layoutConfig.startMidi,
  whiteKeyCount: layoutConfig.whiteKeyCount,
  synth: engine,
  onActivity: announceNote
});
keyboardEl.classList.add('show-kbd');

function renderProgram(program) {
  programName.textContent = program.name;
  programFormat.textContent =
    program.format === 'directwave-monolithic' ? 'Monolithic DirectWave program' : 'Built-in sound';
  programDescription.textContent = program.description || 'Loaded from your DWP file.';
  zoneCount.textContent = String(program.zones.length);
  keyRange.textContent = `${midiToName(program.keyLow)}–${midiToName(program.keyHigh)}`;
  layerCount.textContent = String(program.velocityLayers);
  zoneMap.replaceChildren();

  program.zones.forEach((zone, index) => {
    const el = document.createElement('div');
    const width = ((zone.keyHigh - zone.keyLow + 1) / 128) * 100;
    const left = (zone.keyLow / 128) * 100;
    const velocitySpan = zone.velocityHigh - zone.velocityLow + 1;
    const height = Math.max(18, (velocitySpan / 128) * 112);
    const top = ((127 - zone.velocityHigh) / 128) * 112;
    el.className = 'zone';
    el.style.left = `${left}%`;
    el.style.width = `${width}%`;
    el.style.height = `${height}px`;
    el.style.top = `${top}px`;
    el.style.setProperty('--zone-index', String(index));
    el.textContent = zone.name;
    el.title = `${zone.name}: ${midiToName(zone.keyLow)}–${midiToName(zone.keyHigh)}, velocity ${
      zone.velocityLow
    }–${zone.velocityHigh}`;
    zoneMap.appendChild(el);
  });
}

async function loadProgram(program) {
  setStatus('loading…');
  renderProgram(program);
  await resumeIfSuspended();
  await engine.loadProgram(program, (done, total) => {
    setStatus(`loading ${done}/${total}…`);
  });
  setStatus('');
}

async function loadDwpFile(file) {
  if (!file) return;
  setLoadError('');
  if (file.size > MAX_FILE_BYTES) {
    setLoadError('That file is over 160 MB. Choose a smaller monolithic DWP.');
    return;
  }

  setStatus('reading…');
  try {
    const program = parseDwp(await file.arrayBuffer());
    program.id = `file-${loadedFiles.size}`;
    loadedFiles.set(program.id, program);
    const option = document.createElement('option');
    option.value = program.id;
    option.textContent = program.name;
    soundSelect.appendChild(option);
    soundSelect.value = program.id;
    await loadProgram(program);
  } catch (error) {
    setStatus('');
    setLoadError(
      error instanceof DwpParseError ? error.message : 'That file could not be loaded here.'
    );
    console.warn('DWP load failed', error);
  } finally {
    fileInput.value = '';
  }
}

for (const example of EXAMPLES) {
  const option = document.createElement('option');
  option.value = example.id;
  option.textContent = example.name;
  soundSelect.appendChild(option);
}

soundSelect.addEventListener('change', () => {
  const program = loadedFiles.get(soundSelect.value) || exampleById(soundSelect.value);
  loadProgram(program);
});

chooseFileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => loadDwpFile(fileInput.files?.[0]));

const activateDropPicker = (event) => {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.code !== 'Space') return;
  event.preventDefault();
  fileInput.click();
};
dropZone.addEventListener('click', activateDropPicker);
dropZone.addEventListener('keydown', activateDropPicker);
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-active');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-active');
  loadDwpFile(event.dataTransfer?.files?.[0]);
});

volume.addEventListener('input', () => setMasterVolume(Number(volume.value) / 100));
sustain.addEventListener('change', () => keyboard.setSustain(sustain.checked));
showNotes.addEventListener('change', () => {
  keyboardEl.classList.toggle('hide-notes', !showNotes.checked);
});

const updateOctave = () => {
  const startMidi = layoutConfig.startMidi + octaveOffset * 12;
  keyboard.setStartMidi(startMidi);
  octaveDisplay.textContent = midiToName(startMidi);
  octaveDown.disabled = startMidi - 12 < 0;
  octaveUp.disabled = startMidi + 12 > 108;
};

const shiftOctave = (direction) => {
  const nextStart = layoutConfig.startMidi + (octaveOffset + direction) * 12;
  if (nextStart < 0 || nextStart > 108) return;
  octaveOffset += direction;
  updateOctave();
};

octaveDown.addEventListener('click', () => shiftOctave(-1));
octaveUp.addEventListener('click', () => shiftOctave(1));
layout.addEventListener('change', () => {
  layoutConfig = LAYOUTS[layout.value] || LAYOUTS[49];
  octaveOffset = 0;
  keyboard.setWhiteKeyCount(layoutConfig.whiteKeyCount);
  updateOctave();
});

attachKeyboardInput({
  keyboard,
  synth: engine,
  sustainEl: sustain,
  announceNote,
  shiftOctave
});

setupMidi({
  statusEl: midiStatus,
  onNoteOn: (midi, velocity) => {
    resumeIfSuspended();
    keyboard.pressVisual(midi, true);
    engine.noteOn(midi, velocity);
    announceNote(midi);
  },
  onNoteOff: (midi) => {
    keyboard.pressVisual(midi, false);
    engine.noteOff(midi);
  }
});

loadProgram(EXAMPLES[0]).catch((error) => {
  setStatus('Audio is not supported on this device.');
  console.warn(error);
});
