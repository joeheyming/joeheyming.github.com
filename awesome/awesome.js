// 🤘 EVERYTHING IS AWESOME! 🤘
// This code is awesome when you're part of a team!

/**
 * @fileoverview Main awesome experience controller
 * @requires awesome-config.js
 * @requires awesome-animations.js
 * @requires awesome-spawn.js
 * @requires awesome-emoji.js
 */

var awesomeNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // 🎵 The awesome soundtrack
  var AUDIO_SRC = 'awesome.mp3';
  var LRC_SRC = 'awesome.lrc';

  /**
   * Generate a random hex color
   * @returns {string} Hex color string
   */
  function generateRandomColor() {
    var color = '#';
    for (var k = 0; k < 3; k++) {
      color += ('0' + ((Math.random() * 256) | 0).toString(16)).substr(-2);
    }
    return color;
  }

  /**
   * Parse LRC lyrics file content
   * @param {string} lrcContent - Raw LRC file content
   * @returns {Array<{time: number, text: string}>} Parsed lyrics
   */
  function parseLRC(lrcContent) {
    var lines = lrcContent.split('\n');
    var lyrics = [];
    var timePattern = /\[(\d{2}):(\d{2}\.\d{2})\]/;

    lines.forEach(function (line) {
      var match = timePattern.exec(line);
      if (match) {
        var minutes = parseInt(match[1], 10);
        var seconds = parseFloat(match[2]);
        var time = minutes * 60 + seconds;
        var text = line.replace(timePattern, '').trim();
        lyrics.push({ time: time, text: text });
      }
    });

    return lyrics;
  }

  /**
   * Main Awesome Constructor
   * @constructor
   */
  namespace.Awesome = function () {
    this.lyrics = [];
    this.currentLyricText = '';
    this.currentLyricIndex = -1;
    this.lastColorChange = 0;
    this.colorChangeInterval = (config.timing && config.timing.colorChangeInterval) || 2000;
    this.disableColors = false;
    this.checkInterval = (config.timing && config.timing.checkInterval) || 100;

    // Timer state
    this.timerInterval = null;
    this.accumulatedTime = 0;
    this.lastPlayTime = null;
    this.hasStarted = false;

    // Bound methods for event listeners (needed for removal)
    this.boundOnPlay = this.onAudioPlay.bind(this);
    this.boundOnPause = this.onAudioPause.bind(this);
    this.boundOnSeeked = this.updateLyricsDisplay.bind(this);
    this.boundOnKeydown = this.handleKeydown.bind(this);
    this.boundOnClick = this.handleClick.bind(this);

    this.render();
    this.reset();
    this.installEvents();
    this.initTimer();

    // Main loop
    this.checkIntervalId = setInterval(this.check.bind(this), this.checkInterval);

    // Load lyrics
    this.loadLyrics();
  };

  namespace.Awesome.prototype = {
    /**
     * Load lyrics from LRC file
     */
    loadLyrics: function () {
      var self = this;
      fetch(LRC_SRC)
        .then(function (response) {
          return response.text();
        })
        .then(function (lrcContent) {
          self.lyrics = parseLRC(lrcContent);
        })
        .catch(function (error) {
          console.error('😢 Error loading lyrics:', error);
          // Fallback lyric
          self.lyrics = [{ time: 0, text: 'Everything is awesome!' }];
        });
    },

    /**
     * Render the DOM elements
     */
    render: function () {
      // Container
      this.container = document.createElement('div');
      this.container.id = 'awesome_parent';

      // Content (lyrics display)
      this.content = document.createElement('div');
      this.content.id = 'awesome_div';
      this.container.appendChild(this.content);
      document.body.appendChild(this.container);

      // Audio player
      this.audio = document.createElement('audio');
      this.audio.controls = true;
      this.audio.loop = true;
      this.audio.src = AUDIO_SRC;
      document.body.appendChild(this.audio);
    },

    /**
     * Initialize the timer display
     */
    initTimer: function () {
      this.timerEl = document.getElementById('awesome-timer');
      this.timeDisplay = document.getElementById('awesome-time');

      this.audio.addEventListener('play', this.boundOnPlay);
      this.audio.addEventListener('pause', this.boundOnPause);
      this.audio.addEventListener('seeked', this.boundOnSeeked);
    },

    /**
     * Handle audio play event
     */
    onAudioPlay: function () {
      this.showTimer();
    },

    /**
     * Handle audio pause event
     */
    onAudioPause: function () {
      if (this.lastPlayTime !== null) {
        this.accumulatedTime += Math.floor((Date.now() - this.lastPlayTime) / 1000);
        this.lastPlayTime = null;
      }
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },

    /**
     * Show and start the timer
     */
    showTimer: function () {
      var self = this;
      if (!this.hasStarted) {
        this.hasStarted = true;
      }
      if (this.timerEl) {
        this.timerEl.style.display = 'block';
      }
      this.lastPlayTime = Date.now();
      if (!this.timerInterval) {
        this.timerInterval = setInterval(function () {
          self.updateTimer();
        }, 1000);
      }
    },

    /**
     * Get total awesome duration in seconds
     * @returns {number} Duration in seconds
     */
    getDuration: function () {
      var total = this.accumulatedTime;
      if (this.lastPlayTime !== null) {
        total += Math.floor((Date.now() - this.lastPlayTime) / 1000);
      }
      return total;
    },

    /**
     * Format seconds to human readable time
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted time string
     */
    formatTime: function (seconds) {
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var secs = Math.floor(seconds % 60);

      if (hours > 0) {
        return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      }
      return minutes + ':' + String(secs).padStart(2, '0');
    },

    /**
     * Update the timer display
     */
    updateTimer: function () {
      var duration = this.getDuration();
      if (this.timeDisplay) {
        this.timeDisplay.textContent = this.formatTime(duration);
      }

      // 🎊 Check for milestone celebrations
      if (typeof confettiNamespace !== 'undefined') {
        confettiNamespace.checkMilestone(duration);
      }
    },

    /**
     * Generate share message based on duration
     * @returns {string} Share message
     */
    getShareMessage: function () {
      var duration = this.getDuration();
      if (duration < 60) {
        return "🤘 I've been awesome for " + duration + ' seconds! Everything is awesome! 🎉';
      } else if (duration < 3600) {
        var minutes = Math.floor(duration / 60);
        var secs = duration % 60;
        return (
          "🤘 I've been awesome for " +
          minutes +
          ' minute' +
          (minutes > 1 ? 's' : '') +
          (secs > 0 ? ' and ' + secs + ' seconds' : '') +
          '! Everything is awesome! 🎉'
        );
      } else {
        var hours = Math.floor(duration / 3600);
        var mins = Math.floor((duration % 3600) / 60);
        return (
          "🤘 I've been SUPER awesome for " +
          hours +
          ' hour' +
          (hours > 1 ? 's' : '') +
          (mins > 0 ? ' and ' + mins + ' minutes' : '') +
          '! Everything is awesome! 🎉'
        );
      }
    },

    // Alias for backward compatibility
    getAwesomeMessage: function () {
      return this.getShareMessage();
    },

    /**
     * Clear the lyrics display
     */
    clearContent: function () {
      while (this.content.firstChild) {
        this.content.removeChild(this.content.firstChild);
      }
    },

    /**
     * Update lyrics display based on current audio time
     */
    updateLyricsDisplay: function () {
      if (!this.lyrics || this.lyrics.length === 0) return;

      var currentTime = this.audio.currentTime;
      var currentLyric = null;

      for (var i = 0; i < this.lyrics.length; i++) {
        var lyric = this.lyrics[i];
        var nextLyricTime = i < this.lyrics.length - 1 ? this.lyrics[i + 1].time : Infinity;
        if (currentTime >= lyric.time && currentTime < nextLyricTime) {
          currentLyric = lyric;
          break;
        }
      }

      if (currentLyric && currentLyric.text !== this.currentLyricText) {
        this.currentLyricText = currentLyric.text;
        this.clearContent();
        this.content.textContent = currentLyric.text;

        // Spawn something on lyric change
        if (typeof spawnNamespace !== 'undefined') {
          spawnNamespace.random();
        }
      }
    },

    /**
     * Main check loop - runs every tick
     */
    check: function () {
      if (!this.audio.paused) {
        // Color changes
        if (!this.disableColors) {
          var now = Date.now();
          if (now - this.lastColorChange > this.colorChangeInterval) {
            this.setColor();
            this.lastColorChange = now;
          }
        }

        // Spawn emojis frequently
        if (typeof emojiNamespace !== 'undefined') {
          emojiNamespace.spawn();
        }

        // Random spawns (parrots, nyan, animals)
        var spawnChance = (config.timing && config.timing.spawnChance) || 0.02;
        if (typeof spawnNamespace !== 'undefined' && Math.random() < spawnChance) {
          spawnNamespace.random();
        }

        // Update lyrics
        this.updateLyricsDisplay();
      }
    },

    /**
     * Set random background and text colors
     */
    setColor: function () {
      this.content.style.color = generateRandomColor();
      this.container.style.background = generateRandomColor();
    },

    /**
     * Reset to initial state
     */
    reset: function () {
      this.currentLyricIndex = -1;
      this.currentLyricText = '';
      this.clearContent();
    },

    /**
     * Start playback
     */
    play: function () {
      this.showTimer();
      this.audio.play();

      // 🌈 Enable rainbow cursor
      if (typeof cursorNamespace !== 'undefined') {
        cursorNamespace.enable();
      }

      // 🪩 Enable disco ball
      if (typeof discoNamespace !== 'undefined') {
        discoNamespace.enable();
      }

      // 🎆 Enable auto fireworks
      if (typeof fireworksNamespace !== 'undefined') {
        fireworksNamespace.enable(3000); // Every 3 seconds
      }
    },

    /**
     * Pause playback
     */
    pause: function () {
      this.audio.pause();

      // Disable effects when paused
      if (typeof cursorNamespace !== 'undefined') {
        cursorNamespace.disable();
      }
      if (typeof discoNamespace !== 'undefined') {
        discoNamespace.disable();
      }
      if (typeof fireworksNamespace !== 'undefined') {
        fireworksNamespace.disable();
      }
    },

    /**
     * Toggle play/pause
     */
    toggle: function () {
      if (this.audio.paused) {
        this.play();
      } else {
        this.pause();
      }
    },

    /**
     * Handle keyboard events
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleKeydown: function (e) {
      var keys = config.keys || {
        toggle: [' ', 'Enter'],
        reset: 'Escape',
        lyricMode: 'a',
        colorToggle: 'c'
      };

      // Toggle play/pause
      if (keys.toggle.indexOf(e.key) !== -1) {
        e.preventDefault();
        this.toggle();
      }

      // Reset
      if (e.key === keys.reset) {
        this.pause();
        this.reset();
        this.audio.currentTime = 0;
      }

      // Color toggle
      if (e.key.toLowerCase() === keys.colorToggle) {
        this.disableColors = !this.disableColors;
        if (this.disableColors) {
          this.content.style.color = 'var(--text-1)';
          this.container.style.background = 'var(--surface-0)';
        }
      }
    },

    /**
     * Handle click events
     * @param {MouseEvent} e - Mouse event
     */
    handleClick: function (e) {
      var startEl = document.getElementById('start');
      if (startEl) {
        startEl.style.display = 'none';
      }
      this.container.style.display = 'table';
      if (e.button === 0) {
        this.toggle();
      }
    },

    /**
     * Install event listeners
     */
    installEvents: function () {
      document.addEventListener('keydown', this.boundOnKeydown);
      document.addEventListener('click', this.boundOnClick);
      document.addEventListener('mouseover', function () {
        document.body.focus();
      });
    },

    /**
     * Remove event listeners
     */
    removeEvents: function () {
      document.removeEventListener('keydown', this.boundOnKeydown);
      document.removeEventListener('click', this.boundOnClick);
      this.audio.removeEventListener('play', this.boundOnPlay);
      this.audio.removeEventListener('pause', this.boundOnPause);
      this.audio.removeEventListener('seeked', this.boundOnSeeked);
    },

    /**
     * Clean up and destroy the instance
     */
    destroy: function () {
      // Clear intervals
      if (this.checkIntervalId) {
        clearInterval(this.checkIntervalId);
        this.checkIntervalId = null;
      }
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      // Stop audio. removeAttribute + load() rather than src='' so the
      // browser doesn't try to load the document URL as audio (which
      // would fire a fake resource_error in /analytics.js).
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();

      // Remove event listeners
      this.removeEvents();

      // Remove DOM elements
      if (this.audio.parentNode) {
        this.audio.parentNode.removeChild(this.audio);
      }
      if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      console.log('🤘 Awesome instance destroyed');
    }
  };

  return namespace;
})();
