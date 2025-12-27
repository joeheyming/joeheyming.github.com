/**
 * Audio Manager
 * Handles game sound effects using the original WAV files
 * Uses audio pooling to prevent memory leaks from cloning audio nodes
 */

import { AUDIO } from './constants.js';

export class AudioManager {
  constructor() {
    this.enabled = true;
    this.sounds = {};
    this.initialized = false;

    // Audio pools for frequently played sounds (prevents memory leaks)
    this.pools = {};
    this.poolIndices = {};

    // For skippable intro
    this.currentIntroSound = null;
    this.introResolve = null;

    // Sound file paths from constants
    this.soundFiles = AUDIO.SOUND_FILES;

    // Pre-bind methods
    this.init = this.init.bind(this);

    // Try to initialize on any user interaction (browser requirement)
    const initOnInteraction = () => {
      this.init();
      document.removeEventListener('click', initOnInteraction);
      document.removeEventListener('keydown', initOnInteraction);
      document.removeEventListener('touchstart', initOnInteraction);
    };

    document.addEventListener('click', initOnInteraction);
    document.addEventListener('keydown', initOnInteraction);
    document.addEventListener('touchstart', initOnInteraction);
  }

  async init() {
    if (this.initialized) return;

    try {
      // Load all sound files
      await this.loadSounds();
      this.initialized = true;
      console.log('Audio initialized with WAV files');
    } catch (e) {
      console.warn('Audio initialization failed:', e);
      this.enabled = false;
    }
  }

  async loadSounds() {
    // Create Audio elements for each sound
    for (const [name, path] of Object.entries(this.soundFiles)) {
      try {
        const audio = new Audio(path);
        audio.preload = 'auto';

        // Wait for the audio to be loaded
        await new Promise((resolve, reject) => {
          audio.addEventListener('canplaythrough', resolve, { once: true });
          audio.addEventListener('error', reject, { once: true });
          audio.load();
        });

        this.sounds[name] = audio;

        // Create pool for frequently played sounds (chomp is played most often)
        if (name === 'chomp') {
          this.createPool(name, AUDIO.CHOMP_POOL_SIZE);
        }
      } catch (e) {
        console.warn(`Failed to load sound ${name}:`, e);
        // Create a dummy function if loading fails
        this.sounds[name] = null;
      }
    }
  }

  /**
   * Create an audio pool for a sound to avoid memory leaks from cloning
   * @param {string} name - Sound name
   * @param {number} size - Pool size
   */
  createPool(name, size) {
    if (!this.sounds[name]) return;

    this.pools[name] = [];
    this.poolIndices[name] = 0;

    for (let i = 0; i < size; i++) {
      const audio = this.sounds[name].cloneNode();
      audio.volume = AUDIO.DEFAULT_VOLUME;
      this.pools[name].push(audio);
    }
  }

  /**
   * Play a sound from the pool (for frequently played sounds)
   * @param {string} name - Sound name
   */
  playFromPool(name) {
    if (!this.enabled || !this.pools[name]) return;

    const pool = this.pools[name];
    const audio = pool[this.poolIndices[name]];

    // Reset and play
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Ignore autoplay errors
    });

    // Move to next in pool (circular)
    this.poolIndices[name] = (this.poolIndices[name] + 1) % pool.length;
  }

  async playSound(name, waitForEnd = false) {
    // Ensure audio is initialized first
    if (!this.initialized) {
      await this.init();
    }

    if (!this.enabled || !this.sounds[name]) {
      return waitForEnd ? Promise.resolve() : undefined;
    }

    // Use pool for frequently played sounds
    if (this.pools[name] && !waitForEnd) {
      this.playFromPool(name);
      return;
    }

    try {
      // For non-pooled sounds, clone the audio
      const sound = this.sounds[name].cloneNode();
      sound.volume = AUDIO.DEFAULT_VOLUME;

      if (waitForEnd) {
        // Return a promise that resolves when the sound ends
        return new Promise((resolve) => {
          sound.addEventListener('ended', resolve, { once: true });
          sound.addEventListener('error', resolve, { once: true });
          sound.play().catch((e) => {
            // Resolve immediately on autoplay errors
            console.warn(`Error playing ${name}:`, e);
            resolve();
          });
        });
      } else {
        sound.play().catch((e) => {
          // Ignore autoplay errors
          if (e.name !== 'NotAllowedError') {
            console.warn(`Error playing ${name}:`, e);
          }
        });
      }
    } catch (e) {
      console.warn(`Error playing ${name}:`, e);
      return waitForEnd ? Promise.resolve() : undefined;
    }
  }

  playChomp() {
    // Don't await - fire and forget for performance
    this.playSound('chomp');
  }

  playPowerPill() {
    this.playSound('powerPill');
  }

  playGhostEaten() {
    this.playSound('ghostEaten');
  }

  playDeath() {
    this.playSound('death');
  }

  async playStart(waitForEnd = false) {
    if (!waitForEnd) {
      return this.playSound('start', false);
    }

    // For skippable intro - store references
    if (!this.initialized) {
      await this.init();
    }

    if (!this.enabled || !this.sounds.start) {
      return Promise.resolve();
    }

    try {
      const sound = this.sounds.start.cloneNode();
      sound.volume = AUDIO.DEFAULT_VOLUME;
      this.currentIntroSound = sound;

      return new Promise((resolve) => {
        this.introResolve = resolve;

        const cleanup = () => {
          this.currentIntroSound = null;
          this.introResolve = null;
          resolve();
        };

        sound.addEventListener('ended', cleanup, { once: true });
        sound.addEventListener('error', cleanup, { once: true });
        sound.play().catch((e) => {
          console.warn('Error playing start:', e);
          cleanup();
        });
      });
    } catch (e) {
      console.warn('Error playing start:', e);
      return Promise.resolve();
    }
  }

  // Skip the intro music (called when user clicks during intro)
  skipIntro() {
    if (this.currentIntroSound) {
      this.currentIntroSound.pause();
      this.currentIntroSound.currentTime = 0;
      this.currentIntroSound = null;
    }
    if (this.introResolve) {
      this.introResolve();
      this.introResolve = null;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}
