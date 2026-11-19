import { blockIndexOnPage } from './place.js';
import { SpeechReader } from './speech.js';

const VOICE_KEY = 'heyming.books.voice.v1';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {'play' | 'pause'} kind
 */
function icon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('listen-icon');
  const shapes =
    kind === 'play'
      ? [['polygon', { points: '4,2 14,8 4,14' }]]
      : [
          ['rect', { x: '3', y: '2', width: '3.5', height: '12', rx: '1' }],
          ['rect', { x: '9.5', y: '2', width: '3.5', height: '12', rx: '1' }]
        ];
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
    shape.setAttribute('fill', 'currentColor');
    svg.appendChild(shape);
  }
  return svg;
}

/**
 * Voices for the reader's language first, then the rest by name.
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} language
 */
export function sortVoices(voices, language) {
  const primary = String(language || '')
    .toLowerCase()
    .split('-')[0];
  const rank = (/** @type {SpeechSynthesisVoice} */ voice) => {
    const lang = String(voice.lang || '').toLowerCase();
    if (primary && lang.split(/[-_]/)[0] === primary) return 0;
    return 1;
  };
  return [...voices].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang)
  );
}

function savedVoiceUri() {
  try {
    return localStorage.getItem(VOICE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * @param {string} uri
 */
function saveVoiceUri(uri) {
  try {
    if (uri) localStorage.setItem(VOICE_KEY, uri);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    /* Private mode keeps the choice for this visit only. */
  }
}

/**
 * @param {{
 *   reader: import('./reader.js').Reader,
 *   button: HTMLButtonElement,
 *   voiceSelect: HTMLSelectElement | null,
 *   synth: SpeechSynthesis | null,
 *   onUnavailable: () => void,
 *   onEmpty: () => void
 * }} opts
 */
export function attachListen({ reader, button, voiceSelect, synth, onUnavailable, onEmpty }) {
  const speech = synth ? new SpeechReader(synth) : null;
  let active = false;

  /**
   * @param {boolean} playing
   */
  function setLabel(playing) {
    const label = document.createElement('span');
    label.className = 'reader-nav-extra';
    label.textContent = playing ? 'Pause' : 'Listen';
    button.replaceChildren(icon(playing ? 'pause' : 'play'), label);
    button.setAttribute('aria-label', playing ? 'Pause' : 'Listen');
    button.classList.toggle('is-playing', playing);
  }

  /**
   * @param {boolean} on
   */
  function setActive(on) {
    active = on;
    reader.setListening(on);
  }

  setLabel(false);

  if (speech) {
    speech.onBlock = (index, pin) => {
      reader.setSpeakingBlock(index);
      if (pin || !reader.isBlockOnPage(index)) reader.scrollBlockToTop(index);
    };
    speech.onState = ({ playing }) => setLabel(playing);
    speech.onEnd = () => {
      reader.clearSpeaking();
      setLabel(false);
    };
  }

  /** @type {SpeechSynthesisVoice[]} */
  let voices = [];

  function fillVoices() {
    if (!speech || !synth || !voiceSelect) return;
    let list = [];
    try {
      list = synth.getVoices() || [];
    } catch {
      list = [];
    }
    voices = sortVoices(list, document.documentElement.lang || navigator.language || 'en');
    const wanted = voiceSelect.value || savedVoiceUri();
    const device = document.createElement('option');
    device.value = '';
    device.textContent = 'Device voice';
    const options = [device];
    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})`;
      options.push(option);
    }
    voiceSelect.replaceChildren(...options);
    const match = voices.find((voice) => voice.voiceURI === wanted) || null;
    voiceSelect.value = match ? match.voiceURI : '';
    speech.voice = match;
  }

  if (voiceSelect) {
    if (!speech) {
      voiceSelect.closest('.reader-voice')?.classList.add('hidden');
    } else {
      fillVoices();
      synth?.addEventListener?.('voiceschanged', fillVoices);
      voiceSelect.addEventListener('change', () => {
        const voice = voices.find((v) => v.voiceURI === voiceSelect.value) || null;
        saveVoiceUri(voice ? voice.voiceURI : '');
        speech.setVoice(voice);
      });
    }
  }

  /**
   * @param {number} index
   * @param {boolean} pin
   */
  function startAt(index, pin) {
    if (!speech) return;
    const texts = reader.speakableTexts();
    if (!texts.some((text) => text)) {
      onEmpty();
      return;
    }
    if (!active || speech.blocks.length !== texts.length) speech.load(texts);
    setActive(true);
    speech.play(index, pin);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }

  button.addEventListener('click', () => {
    if (!speech) {
      onUnavailable();
      return;
    }
    if (speech.playing) {
      speech.pause();
      return;
    }
    if (speech.canResume) {
      speech.resume();
      return;
    }
    startAt(Math.max(0, reader.firstBlockOnPage()), true);
  });

  reader.onBlockClick = (index) => {
    if (!speech || !active) return false;
    startAt(index, false);
    return true;
  };

  reader.onUserPageTurn = (scrollTop) => {
    if (!speech) return;
    const index = blockIndexOnPage(reader.blockTops(), scrollTop, reader.pageViewHeight());
    if (speech.playing && index >= 0) speech.play(index, false);
    else speech.disarm();
  };

  return {
    stop() {
      speech?.stop();
      setActive(false);
      reader.clearSpeaking();
      setLabel(false);
    },
    get playing() {
      return Boolean(speech?.playing);
    },
    /**
     * @param {number} index
     */
    playAt(index) {
      if (!speech?.playing || index < 0) return;
      speech.play(index, true);
    }
  };
}
