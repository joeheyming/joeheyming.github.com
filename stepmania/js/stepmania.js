var scrollSpeed = 2;
var noteData = steps.noteData;
var bpm = song.bpm;
var beatsPerSec = bpm / 60;
var addToMusicPositionSeconds = song.addToMusicPosition;

// Background change support
var bgChanges = [];
var currentBackground = null;
var backgroundVideo = null;

// Make these globally accessible for dynamic loading
window.noteData = noteData;
window.bpm = bpm;
window.bgChanges = bgChanges;

var currentTime = 0;
function getMusicBeat(musicSec) {
  return (musicSec + addToMusicPositionSeconds) * beatsPerSec;
}

var audio = document.getElementById('audio_with_controls');

// Apply width constraint: canvas can't be wider than 4 times the arrow width plus padding
var smMicro = document.getElementById('sm-micro');
var containerWidth = smMicro ? smMicro.offsetWidth : 800; // fallback width
var arrowWidth = 64; // Width of each StepMania arrow
var padding = 64; // Add padding around the arrows
var maxCanvasWidth = arrowWidth * 4 + padding; // Maximum width: 4 times arrow width plus padding
var CANVAS_WIDTH = Math.min(containerWidth, maxCanvasWidth);
var CANVAS_HEIGHT = smMicro ? smMicro.offsetHeight : 150; // Reduced from 150 to give more space for judgment messages
var targetFps = 90;
var lastDate = new Date();
var uptimeSeconds = 0;
var framesInCurrentSecond = 0;

// Calculate responsive column positions
function calculateColInfos(width) {
  var colWidth = width / 5; // 5 columns with spacing
  return [
    { x: colWidth * 1, y: 32, rotation: 90 },
    { x: colWidth * 2, y: 32, rotation: 0 },
    { x: colWidth * 3, y: 32, rotation: 180 },
    { x: colWidth * 4, y: 32, rotation: -90 }
  ];
}

var colInfos = calculateColInfos(CANVAS_WIDTH);

var targetsY = 32;

function merge(o1, o2) {
  for (var attr in o2) {
    o1[attr] = o2[attr];
  }
}

// Make globally accessible
window.merge = merge;
function deepCopy(o) {
  var ret = {};
  merge(ret, o);
  return ret;
}

var timingWindows = [0.05, 0.1, 0.15, 0.25, 0.3];
var tapNotePoints = [3, 3, 2, 1, 0, -5];

var tapNoteScores = [0, 0, 0, 0, 0, 0];
var actualPoints = 0;

function handleTapNoteScore(tapNoteScore) {
  tapNoteScores[tapNoteScore]++;
  var id = tapNoteScore;
  var scoreElement = document.getElementById('w' + id);
  if (scoreElement) scoreElement.textContent = tapNoteScores[tapNoteScore];

  var possiblePoints = 3 * noteData.length;
  actualPoints += tapNotePoints[tapNoteScore];
  var percent = Math.max(0, (actualPoints / possiblePoints) * 100);
  var percentElement = document.getElementById('percent-score');
  if (percentElement) percentElement.textContent = percent.toFixed(2) + '%';

  if (tapNoteScore == 5) {
    judgment
      .stop()
      .set({ frameIndex: tapNoteScore, scaleX: 1, scaleY: 1, y: 160, alpha: 1 })
      .animate({ y: 210 }, 0.5)
      .animate({ alpha: 0 }, 0);
  } else {
    judgment
      .stop()
      .set({ frameIndex: tapNoteScore })
      .animate({ scaleX: 1.4, scaleY: 1.4, alpha: 1 }, 0)
      .animate({ scaleX: 1, scaleY: 1 }, 0.1)
      .animate({ scaleX: 1, scaleY: 1 }, 0.5)
      .animate({ alpha: 0 }, 0.2);
  }
}

targets = [];
colInfos.forEach(function (colInfo) {
  targets.push(
    Actor(imgDir + 'down-target.png', { frameWidth: 64, frameHeight: 64, numFrames: 3 }, colInfo)
  );
});

explosions = [];
colInfos.forEach(function (colInfo) {
  var target = Actor(
    imgDir + 'down-explosion.png',
    { frameWidth: 64, frameHeight: 64, numFrames: 1 },
    colInfo
  );
  explosions.push(target);
  target.set({ alpha: 0 });
});

var judgment = Actor(
  imgDir + 'judgment.png',
  { frameWidth: 168, frameHeight: 28, numFrames: 6 },
  { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }
);
judgment.set({ alpha: 0 });
var noteSprite = Sprite(imgDir + 'down-note.png', {
  frameWidth: 64,
  frameHeight: 64,
  numFrames: 16
});

function getBrowserAlertText() {
  // Modern browser detection without jQuery
  var userAgent = navigator.userAgent;
  var isFirefox = userAgent.indexOf('Firefox') !== -1;
  var firefoxVersion = userAgent.match(/Firefox\/(\d+)/);

  if (isFirefox && firefoxVersion && parseInt(firefoxVersion[1]) < 20) {
    return 'Your version of Firefox is known to have incorrect audio sync. More info...';
  }
  var supportsAudio = !!document.createElement('audio').canPlayType;
  if (!supportsAudio) {
    return "Your browser doesn't support the HTML5 audio tag. More info...";
  }
  return '';
}

var text = getBrowserAlertText();
if (text) {
  var alertMessage = document.getElementById('alert-message');
  var logo = document.getElementById('logo');
  var alert = document.getElementById('alert');

  if (alertMessage) alertMessage.textContent = text;
  if (logo) logo.style.display = 'none';
  if (alert) alert.style.display = 'block';
} else {
  var logo = document.getElementById('logo');
  var alert = document.getElementById('alert');

  if (logo) logo.style.display = 'block';
  if (alert) alert.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function () {
  // Mobile detection and CSS class addition
  function isMobile() {
    return window.innerWidth <= 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  if (isMobile()) {
    document.body.classList.add('mobile');
  }

  // Handle window resize to add/remove mobile class and update canvas
  window.addEventListener('resize', function () {
    if (isMobile()) {
      document.body.classList.add('mobile');
    } else {
      document.body.classList.remove('mobile');
    }
    // Reinitialize canvas with new dimensions
    setTimeout(initializeCanvas, 100); // Slight delay to ensure CSS updates
  });

  // Initialize canvas with proper dimensions
  function initializeCanvas() {
    var containerWidth = document.getElementById('sm-micro').offsetWidth;
    var arrowWidth = 64; // Width of each StepMania arrow
    var padding = 64; // Add padding around the arrows
    var maxCanvasWidth = arrowWidth * 4 + padding; // Maximum width: 4 times arrow width plus padding

    // Constrain canvas width to not exceed 4x arrow width plus padding
    CANVAS_WIDTH = Math.min(containerWidth, maxCanvasWidth);
    CANVAS_HEIGHT = document.getElementById('sm-micro').offsetHeight - 50; // Reduced from 100 to give more space for judgment messages
    colInfos = calculateColInfos(CANVAS_WIDTH);

    // Update judgment positioning
    judgment.set({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 });

    if (canvasElement) {
      canvasElement.remove();
    }

    canvasElement = document.createElement('canvas');
    canvasElement.id = 'sm-micro-canvas';
    canvasElement.width = CANVAS_WIDTH;
    canvasElement.height = CANVAS_HEIGHT;
    document.getElementById('sm-micro').prepend(canvasElement);
    canvas = canvasElement.getContext('2d');
  }

  // Initialize canvas
  initializeCanvas();

  // Score toggle functionality for mobile
  document.getElementById('scoreToggle').addEventListener('click', function () {
    const scorePanel = document.querySelector('.score-panel');
    if (scorePanel) {
      scorePanel.classList.toggle('show');
      const isVisible = scorePanel.classList.contains('show');
      this.textContent = isVisible ? '✕ Close' : '📊 Score';
    }
  });

  // Simple onclick handlers for each button - REMOVED (now handled by web component)
  // document.getElementById('button0').addEventListener('click', function () {
  //   step(0); // Left button (red)
  //   addButtonFeedback(0);
  // });

  // document.getElementById('button1').addEventListener('click', function () {
  //   step(1); // Down button (blue)
  //   addButtonFeedback(1);
  // });

  // document.getElementById('button2').addEventListener('click', function () {
  //   step(2); // Up button (green)
  //   addButtonFeedback(2);
  // });

  // document.getElementById('button3').addEventListener('click', function () {
  //   step(3); // Right button (yellow)
  //   addButtonFeedback(3);
  // });

  // Also handle touch events for mobile - REMOVED (now handled by web component)
  // if (window.Touch) {
  //   document.getElementById('button0')[0].ontouchstart = function () {
  //     step(0);
  //     addButtonFeedback(0);
  //   };
  //   document.getElementById('button1')[0].ontouchstart = function () {
  //     step(1);
  //     addButtonFeedback(1);
  //   };
  //   document.getElementById('button2')[0].ontouchstart = function () {
  //     step(2);
  //     addButtonFeedback(2);
  //   };
  //   document.getElementById('button3')[0].ontouchstart = function () {
  //     step(3);
  //     addButtonFeedback(3);
  //   };
  // }

  // Handle web component button events
  document.addEventListener('stepButtonClick', function (event) {
    const buttonId = event.detail.buttonId;
    const buttonNumber = buttonId.replace('button', '');
    step(parseInt(buttonNumber));

    // Add visual feedback to the web component
    const stepButton = event.target;
    if (stepButton && stepButton.addPressedFeedback) {
      stepButton.addPressedFeedback();
    }
  });

  // Function to add visual feedback to buttons (for keyboard)
  function addButtonFeedback(buttonId) {
    var button = document.getElementById(buttonId);
    if (button && button.addPressedFeedback) {
      button.addPressedFeedback();
    }
  }

  // Expose functions globally for gamepad integration
  window.step = step;
  window.addButtonFeedback = addButtonFeedback;

  // Sync video with audio playback
  audio.addEventListener('play', function () {
    var videoElement = document.getElementById('background-video');
    if (videoElement && backgroundVideo) {
      videoElement.play().catch(function (error) {
        console.log('Video play failed:', error);
      });
    }
  });

  audio.addEventListener('pause', function () {
    var videoElement = document.getElementById('background-video');
    if (videoElement && backgroundVideo) {
      videoElement.pause();
    }
  });

  audio.addEventListener('play', function () {
    // Hide the loading overlay when audio starts playing
    const loadingOverlay = document.getElementById('main-loading-overlay');
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
      loadingOverlay.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', function (event) {
    // Don't handle game controls when user is typing in an input field
    if (
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.contentEditable === 'true' ||
      event.target.isContentEditable ||
      event.target.nodeName === 'ZENIUS-BROWSER'
    ) {
      return;
    }

    var keyCode = event.which;

    var col;
    switch (keyCode) {
      case 65 /*a*/:
      case 37:
        col = 0;
        break;
      case 87 /*w*/:
      case 38:
        col = 2;
        break;
      case 68 /*d*/:
      case 39:
        col = 3;
        break;
      case 83 /*s*/:
      case 40:
        col = 1;
        break;
    }
    if (undefined != col) {
      step(col);
      addButtonFeedback(col);
      event.preventDefault();
    }
    // spacebar toggle play/pause
    if (keyCode == 32) {
      if (audio.paused) {
        audio.play().catch((error) => {
          console.log('Audio play failed:', error);
        });
      } else {
        audio.pause();
      }
      event.preventDefault();
    }
  });

  audio.addEventListener('ended', function () {
    const gameOverMessage = document.getElementById('game-over-message');
    gameOverMessage.classList.remove('hidden');
    gameOverMessage.classList.add('animate-fade-in');

    // Optionally hide the message after a few seconds
    setTimeout(() => {
      gameOverMessage.classList.add('hidden');
      gameOverMessage.classList.remove('animate-fade-in');
    }, 5000);
  });

  function step(col) {
    // timestamp the input as early as possible
    var songSeconds = audio.currentTime;
    songSeconds += addToMusicPositionSeconds;

    var songBeats = songSeconds * beatsPerSec;

    var hit = false;
    var tapNoteScore = 0;
    noteData.forEach(function (note) {
      var noteBeat = note[0];
      var noteCol = note[1];
      var noteProps = note[2];
      var diff = Math.abs(noteBeat - songBeats);

      if ('tapNoteScore' in noteProps) return;

      if (noteCol != col) return;

      if (diff >= timingWindows[timingWindows.length - 1]) return;

      for (var j = 0; j < timingWindows.length; j++) {
        if (diff <= timingWindows[j]) {
          noteProps.tapNoteScore = j;
          tapNoteScore = j;
          break;
        }
      }

      hit = true;
      //$('#note' + i).css({ alpha: 0 });
    });
    if (hit) {
      handleTapNoteScore(tapNoteScore);

      var explosion = explosions[col];
      explosion
        .stop()
        .set({ scaleX: 1, scaleY: 1, alpha: 1 })
        .animate({ scaleX: 1.1, scaleY: 1.1 }, 0.1)
        .animate({ alpha: 0 }, 0.1);
    } else {
      var target = targets[col];
      target.stop().set({ scaleX: 0.5, scaleY: 0.5 }).animate({ scaleX: 1, scaleY: 1 }, 0.2);
    }
  }

  // Expose functions globally for gamepad integration
  window.step = step;
  window.addButtonFeedback = addButtonFeedback;
  console.log('🎮 StepMania functions exposed globally for gamepad integration');
});

var canvasElement;
var canvas;

setInterval(function () {
  var thisDate = new Date();
  var deltaSeconds = (thisDate.getTime() - lastDate.getTime()) / 1000;
  update(deltaSeconds);
  draw();
  lastDate = thisDate;
  framesInCurrentSecond++;
  var oldSec = Math.floor(uptimeSeconds);
  var newSec = Math.floor(uptimeSeconds + deltaSeconds);
  if (oldSec != newSec) {
    var fps = framesInCurrentSecond / (newSec - oldSec);
    var fpsElement = document.getElementById('FPS');
    if (fpsElement) fpsElement.textContent = fps;
    framesInCurrentSecond = 0;
  }
  uptimeSeconds += deltaSeconds;
}, 1000 / targetFps);

var lastSeenCurrentTime = 0;
function update(deltaSeconds) {
  // currentTime is choppy in Firefox.
  if (lastSeenCurrentTime != audio.currentTime) {
    lastSeenCurrentTime = audio.currentTime;
    currentTime = lastSeenCurrentTime;
  } else {
    if (audio.paused == false) currentTime += deltaSeconds;
  }

  // Handle background changes
  updateBackgroundChanges();

  targets.forEach(function (target) {
    target.update(deltaSeconds);
  });
  explosions.forEach(function (target) {
    target.update(deltaSeconds);
  });
  judgment.update(deltaSeconds);

  var missIfOlderThanSeconds = currentTime - timingWindows[timingWindows.length - 1];
  var missIfOlderThanBeat = getMusicBeat(missIfOlderThanSeconds);

  numMisses = 0;
  noteData.forEach(function (note) {
    var noteBeat = note[0];
    var noteProps = note[2];
    if (noteBeat < missIfOlderThanBeat) {
      if (!('tapNoteScore' in noteProps)) {
        numMisses++;
        noteProps.tapNoteScore = 5;
        handleTapNoteScore(5);
      }
    }
  });
}

function updateBackgroundChanges() {
  if (!bgChanges || bgChanges.length === 0) return;

  var musicBeat = getMusicBeat(currentTime);

  // Find the next background change that should be triggered
  for (var i = 0; i < bgChanges.length; i++) {
    var bgChange = bgChanges[i];
    if (bgChange.beat <= musicBeat && !bgChange.triggered) {
      bgChange.triggered = true;
      console.log('Triggering background change at beat', bgChange.beat, ':', bgChange.file);
      console.log('Current music beat:', musicBeat, 'Current time:', currentTime);
      applyBackgroundChange(bgChange);
    }
  }
}

function applyBackgroundChange(bgChange) {
  var gameArea = document.getElementById('sm-micro');
  var videoElement = document.getElementById('background-video');

  console.log('Applying background change:', bgChange);

  if (bgChange.isNoBackground) {
    // Remove background
    console.log('Removing background');
    gameArea.style.backgroundImage = 'none';
    if (videoElement) {
      videoElement.style.opacity = '0';
      videoElement.pause();
    }
    currentBackground = null;
    backgroundVideo = null;
  } else if (bgChange.isVideo) {
    // Handle video background
    console.log('Setting video background:', bgChange.file);
    if (videoElement) {
      // Construct full URL for video file
      var videoUrl = bgChange.file;
      if (!videoUrl.startsWith('http')) {
        // If it's a relative path, construct the full URL using the OGG file's base URL
        if (window.mainPageController && window.mainPageController.currentSong) {
          var currentSongData = window.mainPageController.currentSong.data;
          if (currentSongData.url) {
            // Extract the base URL from the OGG URL and append the video filename
            var baseUrl = currentSongData.url.substring(
              0,
              currentSongData.url.lastIndexOf('/') + 1
            );
            videoUrl = baseUrl + bgChange.file;
            console.log('Constructed video URL:', videoUrl);
          }
        }
      }

      // Remove the static background image so video shows through
      gameArea.style.backgroundImage = 'none';

      videoElement.src = videoUrl;
      videoElement.style.opacity = '1';

      console.log('Starting video at beat:', bgChange.beat, 'current time:', currentTime);

      // Handle video loading errors
      videoElement.addEventListener(
        'error',
        function () {
          console.log('Video failed to load:', videoUrl);
          videoElement.style.opacity = '0';
          backgroundVideo = null;
          // Restore static background image
          if (window.mainPageController && window.mainPageController.currentSong) {
            var currentSongData = window.mainPageController.currentSong.data;
            if (currentSongData.background) {
              gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${currentSongData.background})`;
            }
          }
        },
        { once: true }
      );

      videoElement.play().catch(function (error) {
        console.log('Video autoplay failed:', error);
        // Hide the video element if it fails to load
        videoElement.style.opacity = '0';
        backgroundVideo = null;
        // Restore static background image
        if (window.mainPageController && window.mainPageController.currentSong) {
          var currentSongData = window.mainPageController.currentSong.data;
          if (currentSongData.background) {
            gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${currentSongData.background})`;
          }
        }
      });
      backgroundVideo = videoUrl;
    }
    // Keep the static background as fallback
    currentBackground = bgChange.file;
  } else {
    // Handle static image background
    console.log('Setting image background:', bgChange.file);
    var imageUrl = bgChange.file;
    if (!imageUrl.startsWith('http')) {
      // If it's a relative path, construct the full URL using the OGG file's base URL
      if (window.mainPageController && window.mainPageController.currentSong) {
        var currentSongData = window.mainPageController.currentSong.data;
        if (currentSongData.url) {
          var baseUrl = currentSongData.url.substring(0, currentSongData.url.lastIndexOf('/') + 1);
          imageUrl = baseUrl + bgChange.file;
          console.log('Constructed image URL:', imageUrl);
        }
      }
    }

    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${imageUrl})`;
    if (videoElement) {
      videoElement.style.opacity = '0';
      videoElement.pause();
    }
    currentBackground = imageUrl;
    backgroundVideo = null;
  }
}

function draw() {
  if (!canvas) return; // Don't draw if canvas isn't ready

  canvas.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  targets.forEach(function (target) {
    target.draw();
  });
  explosions.forEach(function (target) {
    target.draw();
  });

  drawNoteField();

  judgment.draw();
}

function drawNoteField() {
  var musicBeat = getMusicBeat(currentTime);

  var arrowSize = 64;
  var arrowSpacing = arrowSize * scrollSpeed;
  var distFromNearestBeat = Math.abs(musicBeat - Math.round(musicBeat));
  var lit = distFromNearestBeat < 0.1;
  targets.forEach(function (target) {
    target.props.frameIndex = lit ? 0 : 1;
  });
  var animateOverBeats = 4;
  var musicBeatRemainder = musicBeat % animateOverBeats;
  var percentThroughAnimation = musicBeatRemainder / animateOverBeats;
  var numNoteFrames = 16;
  var noteFrameIndex = percentThroughAnimation * numNoteFrames;

  for (var i = 0; i < noteData.length; i++) {
    var note = noteData[i];
    var beat = note[0];
    var col = note[1];
    var noteProps = note[2];
    var colInfo = colInfos[col];
    var beatUntilNote = beat - musicBeat;

    var onScreen = beatUntilNote < 6.2 / scrollSpeed && beatUntilNote > -0.6 / scrollSpeed;
    var needUpdateOnScreen = note.lastOnScreen == null || onScreen != note.lastOnScreen;

    if (onScreen) {
      var beatFraction = beat - Math.floor(beat);
      var frameOffset = beatFraction * numNoteFrames;
      var thisNoteFrameIndex = Math.round(noteFrameIndex + frameOffset) % numNoteFrames;
      var y = targetsY + beatUntilNote * arrowSpacing;
      var alpha = 1;
      if ('tapNoteScore' in noteProps) {
        if (noteProps.tapNoteScore < 5) alpha = 0;
      }
      noteSprite.draw(canvas, thisNoteFrameIndex, colInfo.x, y, 1, 1, colInfo.rotation, alpha);
    }
  }
}

// Reset function for dynamic song loading
function resetGame() {
  // Reset score data
  tapNoteScores = [0, 0, 0, 0, 0, 0];
  actualPoints = 0;

  // Update score display
  for (var i = 0; i < tapNoteScores.length; i++) {
    var scoreElement = document.getElementById('w' + i);
    if (scoreElement) scoreElement.textContent = tapNoteScores[i];
  }
  var percentElement = document.getElementById('percent-score');
  if (percentElement) percentElement.textContent = '0.00%';

  // Update global variables from window
  if (window.steps && window.steps.noteData) {
    noteData = window.steps.noteData;
  }
  if (window.song) {
    bpm = window.song.bpm;
    beatsPerSec = bpm / 60;
    addToMusicPositionSeconds = window.song.addToMusicPosition;
  }
  if (window.bgChanges) {
    bgChanges = window.bgChanges;
    // Reset triggered flags
    bgChanges.forEach(function (bgChange) {
      bgChange.triggered = false;
    });
  }

  // Reset background
  currentBackground = null;
  backgroundVideo = null;
  var videoElement = document.getElementById('background-video');
  if (videoElement) {
    videoElement.style.opacity = '0';
    videoElement.pause();
  }

  // Reset audio
  currentTime = 0;
  lastSeenCurrentTime = 0;
  var audioEl = document.getElementById('audio_with_controls');
  if (audioEl) {
    audioEl.currentTime = 0;
    audioEl.pause();
  }

  console.log('Game reset - Notes:', noteData.length, 'BPM:', bpm);
}

// Make reset function globally accessible
window.resetGame = resetGame;
