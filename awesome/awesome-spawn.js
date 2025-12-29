// 🎰 SPAWN MODULE 🎰
// Unified random content spawner - auto-discovers from other modules!

/**
 * @fileoverview Auto-discovering spawn coordinator
 * Reads from other modules' registries - no hardcoding needed!
 */

var spawnNamespace = (function () {
  'use strict';

  var namespace = {};

  // ═══════════════════════════════════════════════════════════════════
  // 🎯 Content Type Weights - Only thing to configure here!
  // ═══════════════════════════════════════════════════════════════════
  var spawnWeights = {
    parrot: 30, // 30% party parrots
    nyan: 20, // 20% nyan cats
    animal: 50 // 50% animals (auto-distributed among all types)
  };

  // ═══════════════════════════════════════════════════════════════════
  // 🎲 Weighted Random Selection
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Select a category based on weights
   * @returns {string} Selected category
   */
  function weightedCategorySelect() {
    var entries = Object.keys(spawnWeights);
    var totalWeight = entries.reduce(function (sum, key) {
      return sum + spawnWeights[key];
    }, 0);

    var random = Math.random() * totalWeight;
    var cumulative = 0;

    for (var i = 0; i < entries.length; i++) {
      cumulative += spawnWeights[entries[i]];
      if (random <= cumulative) {
        return entries[i];
      }
    }

    return entries[entries.length - 1];
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🚀 Spawn Functions - Auto-discover from other modules
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Spawn random content - caller handles probability
   */
  namespace.random = function () {
    var category = weightedCategorySelect();

    switch (category) {
      case 'parrot':
        if (typeof partyParrotNamespace !== 'undefined') {
          partyParrotNamespace.forceSpawn();
        }
        break;

      case 'nyan':
        if (typeof nyanNamespace !== 'undefined') {
          nyanNamespace.forceSpawn();
        }
        break;

      case 'animal':
        if (typeof animalsNamespace !== 'undefined') {
          animalsNamespace.random();
        }
        break;
    }
  };

  /**
   * Force spawn a specific type
   * @param {string} type - Type to spawn
   */
  namespace.spawn = function (type) {
    switch (type) {
      case 'parrot':
        if (typeof partyParrotNamespace !== 'undefined') {
          partyParrotNamespace.forceSpawn();
        }
        break;

      case 'nyan':
        if (typeof nyanNamespace !== 'undefined') {
          nyanNamespace.forceSpawn();
        }
        break;

      case 'emoji':
        if (typeof emojiNamespace !== 'undefined') {
          emojiNamespace.spawn();
        }
        break;

      default:
        // Check if it's an animal type
        if (typeof animalsNamespace !== 'undefined') {
          if (typeof animalsNamespace[type] === 'function') {
            animalsNamespace[type]();
          } else {
            animalsNamespace.random();
          }
        }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 🎪 Special Effect Functions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Spawn multiple items at once
   * @param {number} count - Number of items to spawn
   */
  namespace.party = function (count) {
    count = count || 5;
    for (var i = 0; i < count; i++) {
      namespace.random(1.0); // Force spawn
    }
  };

  /**
   * Complete chaos mode - everything at once!
   */
  namespace.chaos = function () {
    if (typeof partyParrotNamespace !== 'undefined') {
      partyParrotNamespace.flock(5);
    }
    if (typeof nyanNamespace !== 'undefined') {
      nyanNamespace.parade(3);
    }
    if (typeof emojiNamespace !== 'undefined') {
      emojiNamespace.rain(20);
    }
    if (typeof animalsNamespace !== 'undefined') {
      for (var i = 0; i < 5; i++) {
        animalsNamespace.random();
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // ⚙️ Configuration
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Adjust weight for a category
   * @param {string} type - Category name
   * @param {number} weight - New weight
   */
  namespace.setWeight = function (type, weight) {
    if (Object.prototype.hasOwnProperty.call(spawnWeights, type)) {
      spawnWeights[type] = weight;
    }
  };

  /**
   * Get available spawn types (auto-discovered)
   * @returns {Array<string>} Available types
   */
  namespace.types = function () {
    var types = ['parrot', 'nyan', 'emoji'];

    // Add all animal types from registry
    if (typeof animalsNamespace !== 'undefined' && typeof animalsNamespace.types === 'function') {
      types = types.concat(animalsNamespace.types());
    }

    return types;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 🔧 Convenience methods (delegate to other modules)
  // ═══════════════════════════════════════════════════════════════════

  namespace.parrot = function () {
    namespace.spawn('parrot');
  };
  namespace.nyan = function () {
    namespace.spawn('nyan');
  };
  namespace.emoji = function () {
    namespace.spawn('emoji');
  };

  return namespace;
})();

// 🌍 Expose globally
window.spawnNamespace = spawnNamespace;
window.awesomeSpawnNamespace = spawnNamespace; // Alias for consistency
