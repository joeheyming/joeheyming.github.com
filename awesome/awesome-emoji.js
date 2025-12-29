// 🎊 EMOJI MODULE 🎊
// Flying emojis make everything more awesome!

/**
 * @fileoverview Flying emoji animation module
 * @requires awesome-config.js
 */

var emojiNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // 🌟 The awesome emoji squad! 🌟
  var emojis = [
    '🤘',
    '🎉',
    '😎',
    '🔥',
    '✨',
    '🌟',
    '💫',
    '⭐',
    '🎸',
    '🎵',
    '🎶',
    '💪',
    '👏',
    '🙌',
    '🥳'
  ];

  // 🎲 Get a random emoji
  namespace.getRandomEmoji = function () {
    return emojis[Math.floor(Math.random() * emojis.length)];
  };

  /**
   * Spawn a flying emoji
   * @param {Object} [options] - Spawn options
   * @param {number} [options.x] - X position
   * @param {number} [options.y] - Y position
   * @param {string} [options.emoji] - Specific emoji to spawn
   * @param {string} [options.size] - Font size
   * @returns {HTMLElement} The spawned emoji element
   */
  namespace.spawn = function (options) {
    options = options || {};
    var duration = (config.durations && config.durations.emoji) || 2000;

    var emoji = document.createElement('div');
    emoji.textContent = options.emoji || namespace.getRandomEmoji();
    emoji.className = 'flying-emoji';
    // Dynamic position only (size comes from CSS)
    emoji.style.left = (options.x || Math.random() * window.innerWidth) + 'px';
    emoji.style.top = (options.y || Math.random() * window.innerHeight) + 'px';
    emoji.style.transition = 'transform ' + duration / 1000 + 's ease-out';
    if (options.size) emoji.style.fontSize = options.size;
    document.body.appendChild(emoji);

    // 🚀 Launch emoji into the awesome atmosphere!
    setTimeout(function () {
      emoji.style.transform = 'translateY(-100vh)';
      // 👋 Fade out near the end
      setTimeout(function () {
        emoji.style.transition = 'opacity 0.3s ease-out';
        emoji.style.opacity = '0';
      }, duration - 500);
      setTimeout(function () {
        if (emoji.parentNode) {
          emoji.parentNode.removeChild(emoji);
        }
      }, duration);
    }, 100);

    return emoji;
  };

  // 🎉 Spawn a burst of emojis!
  namespace.burst = function (count, options) {
    count = count || 10;
    options = options || {};
    var centerX = options.x || window.innerWidth / 2;
    var centerY = options.y || window.innerHeight / 2;
    var spawned = [];

    for (var i = 0; i < count; i++) {
      (function (index) {
        setTimeout(function () {
          var angle = (index / count) * Math.PI * 2;
          var radius = 50 + Math.random() * 100;
          spawned.push(
            namespace.spawn({
              x: centerX + Math.cos(angle) * radius,
              y: centerY + Math.sin(angle) * radius,
              size: 1.5 + Math.random() + 'em'
            })
          );
        }, index * 50);
      })(i);
    }

    return spawned;
  };

  // 🌧️ Make it rain emojis!
  namespace.rain = function (duration, intensity) {
    duration = duration || 5000;
    intensity = intensity || 100; // ms between spawns

    var interval = setInterval(function () {
      namespace.spawn({
        x: Math.random() * window.innerWidth,
        y: -50
      });
    }, intensity);

    setTimeout(function () {
      clearInterval(interval);
    }, duration);

    return interval;
  };

  // 🎯 Spawn emoji at click position
  namespace.atClick = function (e) {
    namespace.spawn({
      x: e.clientX,
      y: e.clientY
    });
  };

  // ➕ Add a custom emoji to the squad
  namespace.addEmoji = function (emoji) {
    emojis.push(emoji);
  };

  // 📋 Get all emojis
  namespace.all = function () {
    return emojis.slice();
  };

  // 🔢 How many emojis do we have?
  namespace.count = function () {
    return emojis.length;
  };

  // 🤘 Return the namespace to the world!
  return namespace;
})();

// 🌍 Expose globally
window.emojiNamespace = emojiNamespace;
window.emoji = emojiNamespace; // Alias for easy access
