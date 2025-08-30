var awesomeNamespace = (function () {
  var namespace = {};
  var awesome_mp3 = 'awesome.mp3';
  var awesome_nyan_gif =
    'http://mlpforums.com/uploads/post_images/img-2896624-1-Nyan_Cat_Emoticon.gif';
  function awesomeColor() {
    var color = '#';
    for (var k = 0; k < 3; k++) {
      color += ('0' + ((Math.random() * 256) | 0).toString(16)).substr(-2);
    }
    return color;
  }
  function awesomeEventCode(e) {
    e = e || window.event;
    return e.keyCode || e.which;
  }

  // Lyrics will be loaded from lyrics.js file
  // You can populate lyrics.js with your actual lyrics and timing
  var awesome_lyrics =
    typeof awesomeLyricsData !== 'undefined'
      ? awesomeLyricsData
      : [
          // Fallback lyrics if lyrics.js isn't loaded
          { lyric: 'Everything is awesome', start: 0, end: 5 }
        ];

  namespace.Awesome = function () {
    this.render();
    this.awesomeReset();
    this.installAwesomeEvents();
    this.awesomeCallback = this.checkAwesomeLyric.bind(this);
    this.awesomeCheckInterval = setInterval(this.awesomeCheck.bind(this), 100); // Check more frequently for better sync

    // Load and parse the LRC file
    fetch('awesome.lrc')
      .then((response) => response.text())
      .then((lrcContent) => {
        this.lyrics = this.parseLRC(lrcContent);
      })
      .catch((error) => console.error('Error loading LRC file:', error));
  };
  namespace.Awesome.prototype = {
    awesomeColorInterval: null,
    //awesomeLyricInterval: null,
    current_lyric_index: -1,
    last_color_change: 0,
    color_change_interval: 2000, // Change color every 2 seconds
    disable_colors: false, // Set to true to disable all color changes for accessibility
    render: function () {
      this.awesome_container = document.createElement('div');
      this.awesome_container.id = 'awesome_parent';
      this.awesome_content = document.createElement('div');
      this.awesome_content.id = 'awesome_div';
      this.awesome_container.appendChild(this.awesome_content);
      document.body.appendChild(this.awesome_container);

      this.awesome_audio = document.createElement('audio');
      this.awesome_audio.controls = true;
      this.awesome_audio.loop = true;
      document.body.appendChild(this.awesome_audio);
      this.awesome_audio.src = awesome_mp3;
      this.awesome_audio.addEventListener('seeked', this.updateLyricsDisplay.bind(this));
    },
    clearAwesomeContent: function () {
      while (this.awesome_content.firstChild) {
        this.awesome_content.removeChild(this.awesome_content.firstChild);
      }
    },
    animateEmojis: function () {
      const emojis = ['🤘', '🎉', '😎', '🔥', '✨'];
      const emojiElement = document.createElement('div');
      emojiElement.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      emojiElement.style.position = 'absolute';
      emojiElement.style.left = Math.random() * window.innerWidth + 'px';
      emojiElement.style.top = Math.random() * window.innerHeight + 'px';
      emojiElement.style.fontSize = '2em';
      emojiElement.style.transition = 'transform 2s ease-out';
      document.body.appendChild(emojiElement);

      setTimeout(() => {
        emojiElement.style.transform = 'translateY(-100vh)';
        setTimeout(() => document.body.removeChild(emojiElement), 2000);
      }, 100);
    },

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

    showNyanCat: function () {
      const showNyan = Math.random() < 0.1; // 10% chance to show Nyan Cat
      if (showNyan) {
        const nyanContainer = document.getElementById('nyan-container');
        const nyanImage = document.getElementById('awesome_nyan');
        nyanContainer.style.display = 'block';
        nyanImage.style.top = Math.random() * (window.innerHeight - nyanImage.height) + 'px';
        nyanImage.style.left = Math.random() * (window.innerWidth - nyanImage.width) + 'px';

        setTimeout(() => {
          nyanContainer.style.display = 'none';
        }, 5000); // Show Nyan Cat for 5 seconds
      }
    },

    showRandomContent: function () {
      const apis = [
        'https://cataas.com/cat',
        'https://dog.ceo/api/breeds/image/random',
        'https://randomfox.ca/floof/',
        'https://meowfacts.herokuapp.com/'
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

    randomNyanDisplay: function () {
      // Nyan Cat display functionality removed
    },

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
        this.animateEmojis(); // Add this line to animate emojis when playing
        this.updateLyricsDisplay(); // Update lyrics display
        // Nyan Cat display removed
      }
    },
    getCurrentLyric: function () {
      var currentTime = this.awesome_audio.currentTime;

      // Find the lyric that should be displayed at the current time
      for (var i = 0; i < awesome_lyrics.length; i++) {
        var lyric = awesome_lyrics[i];
        if (currentTime >= lyric.start && currentTime < lyric.end) {
          return { lyric: lyric, index: i };
        }
      }

      // If no lyric found, return empty or last lyric if past the end
      if (currentTime >= awesome_lyrics[awesome_lyrics.length - 1].end) {
        return { lyric: { lyric: '' }, index: -1 };
      }

      return { lyric: { lyric: '' }, index: -1 };
    },
    checkAwesomeLyric: function () {
      var current = this.getCurrentLyric();

      // Only update if the lyric has changed
      if (current.index !== this.current_lyric_index) {
        this.current_lyric_index = current.index;
        this.clearAwesomeContent();
        this.awesome_content.textContent = current.lyric.lyric;
      }
    },
    setAwesomeColor: function () {
      window.awesome_div.style.color = awesomeColor();
      window.awesome_parent.style.background = awesomeColor();
    },
    awesomeReset: function () {
      this.current_lyric_index = -1;
      this.clearAwesomeContent();
    },
    awesomePlay: function () {
      this.awesome_audio.play();
    },
    awesomePause: function () {
      this.awesome_audio.pause();
    },
    awesomeToggle: function () {
      if (this.awesome_audio.paused) {
        this.awesomePlay();
      } else {
        this.awesomePause();
      }
    },

    installAwesomeEvents: function () {
      document.onkeydown = function (e) {
        var key = awesomeEventCode(e);
        if (key == '32' || key == '13') {
          // enter or spacebar
          this.awesomeToggle();
        }
        if (key == '27') {
          // esc key
          this.awesomePause();
          this.awesomeReset();
          this.awesome_audio.currentTime = 0;
        }
        if (key == '65') {
          // a
          this.awesomeCallback = this.checkAwesomeLyric.bind(this);
        }
        if (key == '67') {
          // c - toggle color changes for accessibility
          this.disable_colors = !this.disable_colors;
          if (this.disable_colors) {
            // Reset to default colors
            window.awesome_div.style.color = '#000';
            window.awesome_parent.style.background = '#fff';
          }
        }
      }.bind(this);
      document.onmouseover = function () {
        document.body.focus();
      }.bind(this);
      document.onclick = function (e) {
        start.style = 'display: none;';
        awesome_parent.style = 'display: table';
        if (e.button == 0) {
          this.awesomeToggle();
        }
      }.bind(this);
    }
  };
  return namespace;
})();

document.addEventListener('DOMContentLoaded', function () {
  // Duplicate code removed
});
