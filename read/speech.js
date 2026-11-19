import { speechChunks } from './prose.js';

/**
 * Speaks one short utterance at a time. The first utterance of a click
 * is started immediately so mobile browsers still treat it as a gesture.
 * A later utterance waits briefly after cancel(), which otherwise drops it.
 */
export class SpeechReader {
  /**
   * @param {SpeechSynthesis} synth
   * @param {{ gapMs?: number, Utterance?: typeof SpeechSynthesisUtterance }} [options]
   */
  constructor(synth, options = {}) {
    this.synth = synth;
    this.gapMs = options.gapMs ?? 50;
    this.Utterance = options.Utterance || globalThis.SpeechSynthesisUtterance;
    /** @type {{ chunks: string[] }[]} */
    this.blocks = [];
    this.blockIndex = 0;
    this.chunkIndex = 0;
    this.playing = false;
    this._resumeArmed = false;
    this._ended = false;
    this._pin = false;
    this._token = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._timer = null;
    /** @type {SpeechSynthesisUtterance | null} */
    this._utterance = null;
    /** @type {SpeechSynthesisVoice | null} */
    this.voice = null;

    /** @type {((index: number, pin: boolean) => void) | null} */
    this.onBlock = null;
    /** @type {((state: { playing: boolean }) => void) | null} */
    this.onState = null;
    /** @type {(() => void) | null} */
    this.onEnd = null;
  }

  get canResume() {
    return this._resumeArmed && !this.playing && !this._ended;
  }

  /**
   * @param {SpeechSynthesisVoice | null} voice
   */
  setVoice(voice) {
    this.voice = voice;
    if (this.playing) this._speak();
  }

  /**
   * @param {string[]} texts Block strings, one per paragraph or heading.
   */
  load(texts) {
    this.stop();
    this.blocks = texts.map((text) => ({ chunks: speechChunks(text) }));
    this.blockIndex = 0;
    this.chunkIndex = 0;
    this._ended = false;
  }

  /**
   * @param {number} index
   * @param {boolean} pin Scroll this block to the top of the page.
   */
  play(index, pin) {
    if (index != null) {
      this.blockIndex = index;
      this.chunkIndex = 0;
    }
    this._pin = Boolean(pin);
    this._ended = false;
    this._resumeArmed = true;
    this.playing = true;
    this.onState?.({ playing: true });
    this._speak();
  }

  resume() {
    if (!this.canResume) return;
    this.playing = true;
    this._pin = false;
    this.onState?.({ playing: true });
    this._speak();
  }

  pause() {
    this.playing = false;
    this._token += 1;
    this._clearTimer();
    this._cancel();
    this.onState?.({ playing: false });
  }

  disarm() {
    this._resumeArmed = false;
  }

  stop() {
    this.playing = false;
    this._resumeArmed = false;
    this._ended = false;
    this._token += 1;
    this._clearTimer();
    this.blockIndex = 0;
    this.chunkIndex = 0;
    this._cancel();
    this.onState?.({ playing: false });
  }

  _clearTimer() {
    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _cancel() {
    try {
      this.synth.cancel();
    } catch {
      /* Already idle. */
    }
  }

  _speak() {
    const token = ++this._token;
    this._clearTimer();
    while (this.blockIndex < this.blocks.length) {
      const chunks = this.blocks[this.blockIndex].chunks;
      if (this.chunkIndex < chunks.length) break;
      this.blockIndex += 1;
      this.chunkIndex = 0;
    }
    if (this.blockIndex >= this.blocks.length) {
      this.playing = false;
      this._resumeArmed = false;
      this._ended = true;
      this.onState?.({ playing: false });
      this.onEnd?.();
      return;
    }
    if (this.chunkIndex === 0) {
      this.onBlock?.(this.blockIndex, this._pin);
      this._pin = false;
    }
    const chunk = this.blocks[this.blockIndex].chunks[this.chunkIndex];
    const start = () => {
      if (token !== this._token || !this.playing) return;
      const utterance = new this.Utterance(chunk);
      utterance.rate = 1;
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      }
      utterance.onend = () => {
        if (token !== this._token || !this.playing) return;
        this.chunkIndex += 1;
        this._speak();
      };
      utterance.onerror = (event) => {
        const code = event?.error || '';
        if (code === 'canceled' || code === 'interrupted') return;
        this.playing = false;
        this.onState?.({ playing: false });
      };
      this._utterance = utterance;
      this.synth.speak(utterance);
    };

    let busy = false;
    try {
      busy = Boolean(this.synth.speaking);
    } catch {
      busy = false;
    }
    if (busy) {
      this._cancel();
      if (this.gapMs === 0) start();
      else this._timer = setTimeout(start, this.gapMs);
    } else {
      start();
    }
  }
}
