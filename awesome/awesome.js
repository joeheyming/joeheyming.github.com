// 🤘 EVERYTHING IS AWESOME! 🤘
// This code is awesome when you're part of a team!
var awesomeNamespace = (function () {
  var namespace = {};

  // 🎵 The awesome soundtrack that makes everything cool! 🎵
  var awesome_mp3 = 'awesome.mp3';

  // 🌈 Nyan Cat makes everything 20% more awesome! 🌈
  var awesome_nyan_gif =
    'http://mlpforums.com/uploads/post_images/img-2896624-1-Nyan_Cat_Emoticon.gif';

  // 🎨 Generate an awesome random color because EVERYTHING deserves to be colorful! 🎨
  function awesomeColor() {
    var color = '#';
    for (var k = 0; k < 3; k++) {
      color += ('0' + ((Math.random() * 256) | 0).toString(16)).substr(-2);
    }
    return color;
  }

  // ⌨️ Awesome keyboard event handler - because even key codes are awesome! ⌨️
  function awesomeEventCode(e) {
    e = e || window.event;
    return e.keyCode || e.which;
  }

  // 🎤 Awesome lyrics - everything is cool when you're part of a team! 🎤
  var awesome_lyrics =
    typeof awesomeLyricsData !== 'undefined'
      ? awesomeLyricsData
      : [
          // 🎶 Fallback lyrics if lyrics.js isn't loaded - still awesome though! 🎶
          { lyric: 'Everything is awesome', start: 0, end: 5 }
        ];

  // 🚀 The Awesome Constructor - where the magic begins! 🚀
  namespace.Awesome = function () {
    this.render(); // 🎬 Render the awesome stage!
    this.awesomeReset(); // 🔄 Reset to maximum awesomeness!
    this.installAwesomeEvents(); // 🎮 Install awesome controls!
    this.initAwesomeTimer(); // ⏱️ Track how long you've been awesome!
    this.awesomeCallback = this.checkAwesomeLyric.bind(this);
    this.awesomeCheckInterval = setInterval(this.awesomeCheck.bind(this), 100); // 🔁 Check awesomeness 10x per second!

    // 📜 Load awesome lyrics from the LRC file!
    fetch('awesome.lrc')
      .then((response) => response.text())
      .then((lrcContent) => {
        this.lyrics = this.parseLRC(lrcContent);
      })
      .catch((error) => console.error('😢 Error loading awesome lyrics:', error));
  };
  // 🌟 The Awesome Prototype - all the awesome methods live here! 🌟
  namespace.Awesome.prototype = {
    awesomeColorInterval: null,
    //awesomeLyricInterval: null,
    current_lyric_index: -1,
    last_color_change: 0,
    color_change_interval: 2000, // 🎨 Change to an awesome new color every 2 seconds!
    disable_colors: false, // 👁️ Accessibility is awesome too!

    // ⏱️ Awesome Timer - track how long you've been living the dream! ⏱️
    timerInterval: null,
    accumulatedTime: 0, // 📊 Total seconds of pure awesomeness!
    lastPlayTime: null, // 🕐 When did the awesome last begin?
    hasStarted: false, // 🚦 Has the awesome journey started?

    // 🎬 Initialize the awesome timer - like nyan.cat but MORE awesome! 🎬
    initAwesomeTimer: function () {
      var self = this;
      this.awesomeTimerEl = document.getElementById('awesome-timer');
      this.awesomeTimeDisplay = document.getElementById('awesome-time');

      // ▶️ When the awesome music plays, start counting! ▶️
      this.awesome_audio.addEventListener('play', function () {
        self.showAwesomeTimer();
      });

      // ⏸️ When paused, save the awesome time for later! ⏸️
      this.awesome_audio.addEventListener('pause', function () {
        if (self.lastPlayTime !== null) {
          self.accumulatedTime += Math.floor((Date.now() - self.lastPlayTime) / 1000);
          self.lastPlayTime = null;
        }
        if (self.timerInterval) {
          clearInterval(self.timerInterval);
          self.timerInterval = null;
        }
      });
    },

    // ⏱️ Show the awesome timer and start counting! ⏱️
    showAwesomeTimer: function () {
      var self = this;
      if (!this.hasStarted) {
        this.hasStarted = true; // 🎉 The awesome has begun!
      }
      // 🕐 Show timer!
      if (this.awesomeTimerEl) {
        this.awesomeTimerEl.style.display = 'block';
      }
      this.lastPlayTime = Date.now();
      if (!this.timerInterval) {
        this.timerInterval = setInterval(function () {
          self.updateAwesomeTimer();
        }, 1000);
      }
    },

    // 📏 Calculate total awesome duration - every second counts! 📏
    getAwesomeDuration: function () {
      var total = this.accumulatedTime;
      if (this.lastPlayTime !== null) {
        total += Math.floor((Date.now() - this.lastPlayTime) / 1000);
      }
      return total;
    },

    // 🕐 Format time in an awesome human-readable way! 🕐
    formatAwesomeTime: function (seconds) {
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var secs = Math.floor(seconds % 60);

      if (hours > 0) {
        return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      }
      return minutes + ':' + String(secs).padStart(2, '0');
    },

    // 🔄 Update the awesome timer display! 🔄
    updateAwesomeTimer: function () {
      var duration = this.getAwesomeDuration();
      if (this.awesomeTimeDisplay) {
        this.awesomeTimeDisplay.textContent = this.formatAwesomeTime(duration);
      }
    },

    // 📢 Generate an awesome share message - tell the world! 📢
    getAwesomeMessage: function () {
      var duration = this.getAwesomeDuration();
      if (duration < 60) {
        // 🌱 Just getting started being awesome!
        return "🤘 I've been awesome for " + duration + ' seconds! Everything is awesome! 🎉';
      } else if (duration < 3600) {
        // 💪 Now we're cooking with awesome!
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
        // 🏆 LEGENDARY AWESOMENESS ACHIEVED! 🏆
        var hours = Math.floor(duration / 3600);
        minutes = Math.floor((duration % 3600) / 60);
        return (
          "🤘 I've been SUPER awesome for " +
          hours +
          ' hour' +
          (hours > 1 ? 's' : '') +
          (minutes > 0 ? ' and ' + minutes + ' minutes' : '') +
          '! Everything is awesome! 🎉'
        );
      }
    },

    // 🎨 Render the awesome stage - where the magic happens! 🎨
    render: function () {
      this.awesome_container = document.createElement('div');
      this.awesome_container.id = 'awesome_parent';
      this.awesome_content = document.createElement('div');
      this.awesome_content.id = 'awesome_div';
      this.awesome_container.appendChild(this.awesome_content);
      document.body.appendChild(this.awesome_container);

      // 🔊 Create the awesome audio player! 🔊
      this.awesome_audio = document.createElement('audio');
      this.awesome_audio.controls = true;
      this.awesome_audio.loop = true; // 🔁 Awesome never ends!
      document.body.appendChild(this.awesome_audio);
      this.awesome_audio.src = awesome_mp3;
      this.awesome_audio.addEventListener('seeked', this.updateLyricsDisplay.bind(this));
    },

    // 🧹 Clear the stage for more awesome content! 🧹
    clearAwesomeContent: function () {
      while (this.awesome_content.firstChild) {
        this.awesome_content.removeChild(this.awesome_content.firstChild);
      }
    },

    // 🎊 Animate awesome emojis flying across the screen! 🎊
    animateEmojis: function () {
      const emojis = ['🤘', '🎉', '😎', '🔥', '✨']; // 🌟 The awesome emoji squad!
      const emojiElement = document.createElement('div');
      emojiElement.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      emojiElement.style.position = 'absolute';
      emojiElement.style.left = Math.random() * window.innerWidth + 'px';
      emojiElement.style.top = Math.random() * window.innerHeight + 'px';
      emojiElement.style.fontSize = '2em';
      emojiElement.style.transition = 'transform 2s ease-out';
      document.body.appendChild(emojiElement);

      // 🚀 Launch emojis into the awesome atmosphere! 🚀
      setTimeout(() => {
        emojiElement.style.transform = 'translateY(-100vh)';
        setTimeout(() => document.body.removeChild(emojiElement), 2000);
      }, 100);
    },

    // 📜 Parse awesome LRC lyrics - sync words to the beat! 📜
    parseLRC: function (lrcContent) {
      const lines = lrcContent.split('\n');
      const lyrics = [];
      const timePattern = /\[(\d{2}):(\d{2}\.\d{2})\]/;

      lines.forEach((line) => {
        const match = timePattern.exec(line);
        if (match) {
          const minutes = parseInt(match[1], 10);
          const seconds = parseFloat(match[2]);
          const time = minutes * 60 + seconds;
          const text = line.replace(timePattern, '').trim();
          lyrics.push({ time, text });
        }
      });

      return lyrics;
    },

    // 🌈 Show Nyan Cat - 10% chance of rainbow awesomeness! 🌈
    showNyanCat: function () {
      const showNyan = Math.random() < 0.1; // 🎲 Roll for awesome!
      if (showNyan) {
        const nyanContainer = document.getElementById('nyan-container');
        const nyanImage = document.getElementById('awesome_nyan');
        nyanContainer.style.display = 'block';
        nyanImage.style.top = Math.random() * (window.innerHeight - nyanImage.height) + 'px';
        nyanImage.style.left = Math.random() * (window.innerWidth - nyanImage.width) + 'px';

        setTimeout(() => {
          nyanContainer.style.display = 'none';
        }, 5000); // 🌟 5 seconds of Nyan glory!
      }
    },

    // 🐱🐕🦊 Fetch awesome random animals and facts from the internet! 🐱🐕🦊
    showRandomContent: function () {
      const apis = [
        'https://cataas.com/cat', // 🐱 Cat as a Service - awesome!
        'https://dog.ceo/api/breeds/image/random', // 🐕 Random doggos!
        'https://randomfox.ca/floof/', // 🦊 Fluffy foxes!
        'https://meowfacts.herokuapp.com/' // 📚 Cat facts are awesome!
      ];

      const randomApi = apis[Math.floor(Math.random() * apis.length)];

      fetch(randomApi)
        .then((response) => response.json())
        .then((data) => {
          let imageUrl = '';
          if (randomApi.includes('cataas')) {
            imageUrl = randomApi;
          } else if (randomApi.includes('dog.ceo')) {
            imageUrl = data.message;
          } else if (randomApi.includes('randomfox')) {
            imageUrl = data.image;
          } else if (randomApi.includes('meowfacts')) {
            const factDiv = document.createElement('div');
            factDiv.textContent = 'MeowFacts: ' + data.data[0];
            factDiv.className =
              'absolute top-10 right-10 bg-blue-500 text-white p-4 rounded shadow-lg';
            factDiv.style.maxWidth = '400px';
            factDiv.style.left = Math.random() * (window.innerWidth - factDiv.offsetWidth) + 'px';
            factDiv.style.top = Math.random() * (window.innerHeight - factDiv.offsetHeight) + 'px';
            document.body.appendChild(factDiv);

            setTimeout(() => {
              factDiv.style.opacity = '0';
              setTimeout(() => document.body.removeChild(factDiv), 2000);
            }, 5000);
            return;
          }

          const imageObjectURL = imageUrl;
          const animalImage = document.createElement('img');
          animalImage.src = imageObjectURL;
          animalImage.alt = 'Random Animal';
          animalImage.style.position = 'fixed';
          animalImage.style.maxWidth = '150px';
          animalImage.style.top = Math.random() * (window.innerHeight - animalImage.height) + 'px';
          animalImage.style.right = Math.random() * (window.innerWidth - animalImage.width) + 'px';
          const transitions = [
            'spin',
            'opacity',
            'slide',
            'scale',
            'fade',
            'rotate',
            'bounce',
            'flip'
          ];
          const transitionType = transitions[Math.floor(Math.random() * transitions.length)];
          animalImage.className = transitions[Math.floor(Math.random() * transitions.length)];
          animalImage.classList.add(transitionType);

          if (transitionType === 'spin') {
            animalImage.style.transition = 'transform 2s ' + transitionType;
            animalImage.style.transform = 'rotate(360deg)';
          } else {
            animalImage.style.transition = 'opacity 2s ' + transitionType;
            animalImage.style.opacity = '0';
          }
          document.body.appendChild(animalImage);

          setTimeout(() => {
            animalImage.style.opacity = '1';
          }, 100);

          setTimeout(() => {
            animalImage.style.opacity = '0';
            setTimeout(() => document.body.removeChild(animalImage), 2000);
          }, 5000);
        })
        .catch((error) => console.error('Error fetching data:', error));
    },

    // 🎤 Update the awesome lyrics display - karaoke time! 🎤
    updateLyricsDisplay: function () {
      const currentTime = this.awesome_audio.currentTime;
      let currentLyric = null;
      for (let i = 0; i < this.lyrics.length; i++) {
        const lyric = this.lyrics[i];
        const nextLyricTime = i < this.lyrics.length - 1 ? this.lyrics[i + 1].time : Infinity;
        if (currentTime >= lyric.time && currentTime < nextLyricTime) {
          currentLyric = lyric;
          break;
        }
      }
      if (currentLyric && currentLyric.text !== this.currentLyricText) {
        this.currentLyricText = currentLyric.text;
        this.clearAwesomeContent();
        this.awesome_content.textContent = currentLyric.text;
        this.showRandomContent();
      }
    },

    // 🌈 (Deprecated) Nyan Cat had its moment of glory 🌈
    randomNyanDisplay: function () {
      // 😿 Nyan Cat display functionality removed - but never forgotten!
    },

    // 🔄 The awesome check loop - keeping everything in sync! 🔄
    awesomeCheck: function () {
      if (!this.awesome_audio.paused) {
        // Only change colors at the specified interval to prevent epileptic seizures
        if (!this.disable_colors) {
          var now = Date.now();
          if (now - this.last_color_change > this.color_change_interval) {
            this.setAwesomeColor();
            this.last_color_change = now;
          }
        }
        this.awesomeCallback();
        this.animateEmojis(); // 🎊 Emoji party!
        this.updateLyricsDisplay(); // 🎤 Sing along!
      }
    },
    // 🔍 Find the current awesome lyric! 🔍
    getCurrentLyric: function () {
      var currentTime = this.awesome_audio.currentTime;

      // 🎯 Find the lyric that matches the current awesome moment!
      for (var i = 0; i < awesome_lyrics.length; i++) {
        var lyric = awesome_lyrics[i];
        if (currentTime >= lyric.start && currentTime < lyric.end) {
          return { lyric: lyric, index: i };
        }
      }

      // 🤷 No lyric found - but still awesome!
      if (currentTime >= awesome_lyrics[awesome_lyrics.length - 1].end) {
        return { lyric: { lyric: '' }, index: -1 };
      }

      return { lyric: { lyric: '' }, index: -1 };
    },
    // ✅ Check if the lyric changed and update! ✅
    checkAwesomeLyric: function () {
      var current = this.getCurrentLyric();

      // 🔄 Only update if the lyric has changed - efficiency is awesome!
      if (current.index !== this.current_lyric_index) {
        this.current_lyric_index = current.index;
        this.clearAwesomeContent();
        this.awesome_content.textContent = current.lyric.lyric;
      }
    },
    // 🌈 Paint the screen with awesome colors! 🌈
    setAwesomeColor: function () {
      window.awesome_div.style.color = awesomeColor();
      window.awesome_parent.style.background = awesomeColor();
    },

    // 🔄 Reset to initial awesome state! 🔄
    awesomeReset: function () {
      this.current_lyric_index = -1;
      this.clearAwesomeContent();
    },

    // ▶️ Let the awesome begin! ▶️
    awesomePlay: function () {
      this.showAwesomeTimer(); // 🕐 Start timer immediately!
      this.awesome_audio.play();
    },

    // ⏸️ Take an awesome break! ⏸️
    awesomePause: function () {
      this.awesome_audio.pause();
    },

    // 🔀 Toggle between awesome and more awesome! 🔀
    awesomeToggle: function () {
      if (this.awesome_audio.paused) {
        this.awesomePlay();
      } else {
        this.awesomePause();
      }
    },

    // 🎮 Install awesome keyboard and mouse controls! 🎮
    installAwesomeEvents: function () {
      document.onkeydown = function (e) {
        var key = awesomeEventCode(e);
        if (key == '32' || key == '13') {
          // ⏯️ Enter or spacebar - toggle awesome!
          this.awesomeToggle();
        }
        if (key == '27') {
          // 🛑 ESC - stop and reset (but you can always come back!)
          this.awesomePause();
          this.awesomeReset();
          this.awesome_audio.currentTime = 0;
        }
        if (key == '65') {
          // 🅰️ A - for Awesome lyric mode!
          this.awesomeCallback = this.checkAwesomeLyric.bind(this);
        }
        if (key == '67') {
          // 🎨 C - toggle colors for accessibility!
          this.disable_colors = !this.disable_colors;
          if (this.disable_colors) {
            // 👁️ Reset to calm colors
            window.awesome_div.style.color = '#000';
            window.awesome_parent.style.background = '#fff';
          }
        }
      }.bind(this);
      document.onmouseover = function () {
        document.body.focus();
      }.bind(this);
      // 🖱️ Click anywhere to toggle awesome!
      document.onclick = function (e) {
        start.style = 'display: none;';
        awesome_parent.style = 'display: table';
        if (e.button == 0) {
          this.awesomeToggle();
        }
      }.bind(this);
    }
  };

  // 🤘 Return the awesome namespace to the world! 🤘
  return namespace;
})();
