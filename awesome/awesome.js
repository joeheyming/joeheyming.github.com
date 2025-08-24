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
          { lyric: 'Add lyrics.js file with timing!', start: 0, end: 5 },
          { lyric: 'Check the lyrics.js template', start: 5, end: 10 }
        ];

  namespace.Awesome = function () {
    this.render();
    this.awesomeReset();
    this.installAwesomeEvents();
    this.awesomeCallback = this.checkAwesomeLyric.bind(this);
    this.awesomeCheckInterval = setInterval(this.awesomeCheck.bind(this), 100); // Check more frequently for better sync
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
    },
    clearAwesomeContent: function () {
      while (this.awesome_content.firstChild) {
        this.awesome_content.removeChild(this.awesome_content.firstChild);
      }
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
      this.awesomePlay();
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
    awesomeCheckNyan: function () {
      if (window.awesome_nyan) {
        return;
      }

      var awesome_nyan = new Image();
      awesome_nyan.id = 'awesome_nyan';
      awesome_nyan.src = awesome_nyan_gif;
      this.awesome_content.textContent = '';
      this.awesome_content.appendChild(awesome_nyan);
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
        if (key == '78') {
          // n
          this.awesomeCallback = this.awesomeCheckNyan.bind(this);
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
