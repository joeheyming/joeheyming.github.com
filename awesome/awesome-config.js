// ⚙️ AWESOME CONFIG ⚙️
// Behavioral configuration for all awesome modules
// Visual styles (sizes, effects, z-index) are in awesome.css as CSS custom properties

/**
 * @fileoverview Global configuration for Awesome app
 * Each module owns its own data (URLs, registries, etc.)
 * This file has timing, duration, and keyboard settings
 *
 * Visual configuration lives in awesome.css:
 *   --awesome-emoji-size, --awesome-parrot-size, etc.
 *   --z-confetti, --z-parrot, etc.
 */

window.awesomeConfig = {
  // ═══════════════════════════════════════════════════════════════════
  // ⏱️ Timing (milliseconds)
  // ═══════════════════════════════════════════════════════════════════
  timing: {
    checkInterval: 1000, // Check lyrics every second
    timerInterval: 1000, // Update timer every second
    awesomeIdleTimeout: 1200000, // 20 minutes before idle
    spawnChance: 0.1 // 10% chance per tick to spawn animals/parrots/nyan
  },

  // ═══════════════════════════════════════════════════════════════════
  // 📏 Durations (how long things stay on screen, in ms)
  // ═══════════════════════════════════════════════════════════════════
  durations: {
    emoji: 1500,
    animal: 5000,
    catFact: 5000,
    parrot: 5000,
    nyan: 3000
  },

  // ═══════════════════════════════════════════════════════════════════
  // ⌨️ Keyboard Bindings
  // ═══════════════════════════════════════════════════════════════════
  keys: {
    toggle: [' ', 'Enter'], // Space or Enter to play/pause
    reset: 'Escape',
    colorToggle: 'c',
    skip: 'ArrowRight',
    previous: 'ArrowLeft'
  }
};
