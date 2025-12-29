// ⚙️ AWESOME CONFIG ⚙️
// Centralized configuration for all awesome modules
// Style, timing, and display settings only - APIs live in their modules!

/**
 * @fileoverview Global configuration for Awesome app
 * Each module owns its own data (URLs, registries, etc.)
 * This file just has shared settings
 */

window.awesomeConfig = {
  // ═══════════════════════════════════════════════════════════════════
  // 📐 Z-Index Layers
  // ═══════════════════════════════════════════════════════════════════
  zIndex: {
    emoji: '9998',
    animals: '9996',
    parrot: '9997',
    nyan: '9997',
    confetti: '9999',
    cursor: '9995',
    fireworks: '9994',
    disco: '9990',
    lyrics: '99999' // Always on top
  },

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
  // 📏 Durations (how long things stay on screen)
  // ═══════════════════════════════════════════════════════════════════
  durations: {
    emoji: 1500,
    animal: 5000,
    catFact: 5000,
    parrot: 5000,
    nyan: 3000
  },

  // ═══════════════════════════════════════════════════════════════════
  // 📐 Sizes
  // ═══════════════════════════════════════════════════════════════════
  sizes: {
    emoji: '2em',
    animal: '150px',
    parrot: '80px',
    nyan: '100px'
  },

  // ═══════════════════════════════════════════════════════════════════
  // 🎨 Visual Effects
  // ═══════════════════════════════════════════════════════════════════
  effects: {
    animalShadow: '0 4px 15px rgba(0,0,0,0.3)',
    parrotShadow: '0 0 20px rgba(255,255,255,0.5)',
    nyanGlow: '0 0 30px rgba(255,105,180,0.8)'
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
