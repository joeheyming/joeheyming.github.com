// 🌈 NYAN CAT MODULE 🌈
// Because everything is 20% more awesome with rainbow cats!

/**
 * @fileoverview Nyan Cat spawning module
 * @requires awesome-config.js
 * @requires awesome-animations.js
 */

var nyanNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // 🌈 Nyan Cat GIF sources (HTTPS only)! 🌈
  var nyanGifs = [
    'https://media.giphy.com/media/sIIhZliB2McAo/giphy.gif',
    'https://media.giphy.com/media/EZICHGrSD5QEFCxMiC/giphy.gif',
    'https://i.imgur.com/sLqfIRC.gif' // Nyan cat alternative (HTTPS)
  ];

  // 🎲 Get a random Nyan Cat GIF
  namespace.getRandomNyan = function () {
    return nyanGifs[Math.floor(Math.random() * nyanGifs.length)];
  };

  /**
   * Spawn a Nyan Cat on the screen
   * @param {Object} [options] - Spawn options
   * @param {number} [options.chance] - Spawn chance (0-1)
   * @param {string} [options.size] - Size in CSS units
   * @param {string} [options.src] - Custom GIF source
   * @param {number} [options.duration] - Display duration in ms
   * @returns {HTMLElement|null} The spawned nyan element or null
   */
  namespace.spawn = function (options) {
    options = options || {};
    var defaultChance = (config.timing && config.timing.spawnChance) || 0.02;
    var chance = options.chance || defaultChance;

    // 🎲 Roll for Nyan!
    if (Math.random() > chance) return null;

    // Size from CSS variable or option override
    var sizeNum = options.size ? parseInt(options.size, 10) : 100;

    var nyan = document.createElement('img');
    nyan.src = options.src || namespace.getRandomNyan();
    nyan.alt = 'Nyan Cat!';
    nyan.className = 'nyan-cat';
    // Dynamic position only (size comes from CSS)
    nyan.style.left = Math.random() * (window.innerWidth - sizeNum) + 'px';
    nyan.style.top = Math.random() * (window.innerHeight - sizeNum) + 'px';
    if (options.size) {
      nyan.style.maxWidth = options.size;
      nyan.style.maxHeight = options.size;
    }
    document.body.appendChild(nyan);

    // 🎬 Fade in the Nyan!
    setTimeout(function () {
      nyan.style.opacity = '1';
    }, 50);

    // 🎲 Apply a random awesome animation!
    var duration = options.duration || (config.durations && config.durations.nyan) || 5000;
    if (typeof animationsNamespace !== 'undefined') {
      animationsNamespace.applyRandom(nyan, { delay: 500, duration: duration - 1000 });
    } else if (options.fly !== false) {
      // 🌈 Fallback: Make it fly across the screen!
      setTimeout(function () {
        nyan.style.transform = 'translateX(' + (Math.random() > 0.5 ? '' : '-') + '500px)';
      }, 100);
    }

    // 👋 Nyan flies away after spreading joy!
    setTimeout(function () {
      nyan.style.transition = 'opacity 0.5s ease-out';
      nyan.style.opacity = '0';
      setTimeout(function () {
        if (nyan.parentNode) {
          nyan.parentNode.removeChild(nyan);
        }
      }, 500);
    }, duration);

    return nyan;
  };

  // 🌈 Force spawn a Nyan Cat (100% chance)!
  namespace.forceSpawn = function (options) {
    options = options || {};
    options.chance = 1;
    return namespace.spawn(options);
  };

  // 🎉 Spawn a whole rainbow of Nyan Cats!
  namespace.rainbow = function (count) {
    count = count || 3;
    var nyans = [];
    for (var i = 0; i < count; i++) {
      (function (index) {
        setTimeout(function () {
          nyans.push(namespace.forceSpawn());
        }, index * 500); // 🐱 Stagger the rainbow!
      })(i);
    }
    return nyans;
  };

  // 🌈 Create a Nyan Cat parade across the screen!
  namespace.parade = function () {
    var nyan = document.createElement('img');
    nyan.src = namespace.getRandomNyan();
    nyan.alt = 'Nyan Cat Parade!';
    nyan.className = 'nyan-cat';
    // Dynamic styles for parade
    nyan.style.maxWidth = '150px';
    nyan.style.maxHeight = '150px';
    nyan.style.left = '-200px';
    nyan.style.top = Math.random() * (window.innerHeight - 150) + 'px';
    nyan.style.transition = 'left 8s linear';
    nyan.style.opacity = '1';
    document.body.appendChild(nyan);

    // 🚀 Start the parade!
    setTimeout(function () {
      nyan.style.left = window.innerWidth + 200 + 'px';
    }, 50);

    // 🧹 Clean up after parade
    setTimeout(function () {
      if (nyan.parentNode) {
        nyan.parentNode.removeChild(nyan);
      }
    }, 9000);

    return nyan;
  };

  // 🦄 How many Nyan GIFs do we have?
  namespace.count = function () {
    return nyanGifs.length;
  };

  // 📋 Get all Nyan URLs
  namespace.all = function () {
    return nyanGifs.slice();
  };

  // ➕ Add a custom Nyan GIF
  namespace.addGif = function (url) {
    nyanGifs.push(url);
  };

  // 🤘 Return the namespace to the world!
  return namespace;
})();

// 🌍 Expose globally
window.nyanNamespace = nyanNamespace;
window.nyan = nyanNamespace; // Alias for easy access
