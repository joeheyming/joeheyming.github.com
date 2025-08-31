var scrollSpeed = 2;
var noteData = steps.noteData;
var bpm = song.bpm;
var beatsPerSec = bpm / 60;
var addToMusicPositionSeconds = song.addToMusicPosition;

// Make these globally accessible for dynamic loading
window.noteData = noteData;
window.bpm = bpm;

var currentTime = 0;
function getMusicBeat(musicSec) {
  return (musicSec + addToMusicPositionSeconds) * beatsPerSec;
}

var audio = document.getElementById('audio_with_controls');

// Apply width constraint: canvas can't be wider than 4 times the arrow width plus padding
var containerWidth = $('#sm-micro').width();
var arrowWidth = 64; // Width of each StepMania arrow
var padding = 64; // Add padding around the arrows
var maxCanvasWidth = arrowWidth * 4 + padding; // Maximum width: 4 times arrow width plus padding
var CANVAS_WIDTH = Math.min(containerWidth, maxCanvasWidth);
var CANVAS_HEIGHT = $('#sm-micro').height() - 150; // Account for controls
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
  $('#w' + id).text(tapNoteScores[tapNoteScore]);

  var possiblePoints = 3 * noteData.length;
  actualPoints += tapNotePoints[tapNoteScore];
  var percent = (actualPoints / possiblePoints) * 100;
  $('#percent-score').text(percent.toFixed(2) + '%');

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
  if ($.browser.mozilla && $.browser.version.substr(0, 3) < 2.0) {
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
  $('#alert-message').text(text);
  $('#logo').hide();
  $('#alert').show();
} else {
  $('#logo').show();
  $('#alert').hide();
}

$(document).ready(function () {
  // Mobile detection and CSS class addition
  function isMobile() {
    return window.innerWidth <= 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  if (isMobile()) {
    document.body.classList.add('mobile');
  }

  // Handle window resize to add/remove mobile class and update canvas
  $(window).resize(function () {
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
    var containerWidth = $('#sm-micro').width();
    var arrowWidth = 64; // Width of each StepMania arrow
    var padding = 64; // Add padding around the arrows
    var maxCanvasWidth = arrowWidth * 4 + padding; // Maximum width: 4 times arrow width plus padding

    // Constrain canvas width to not exceed 4x arrow width plus padding
    CANVAS_WIDTH = Math.min(containerWidth, maxCanvasWidth);
    CANVAS_HEIGHT = $('#sm-micro').height() - 100; // Account for controls
    colInfos = calculateColInfos(CANVAS_WIDTH);

    // Update judgment positioning
    judgment.set({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 });

    if (canvasElement) {
      canvasElement.remove();
    }

    canvasElement = $(
      "<canvas id='sm-micro-canvas' width='" +
        CANVAS_WIDTH +
        "' height='" +
        CANVAS_HEIGHT +
        "'></canvas>"
    );
    canvas = canvasElement.get(0).getContext('2d');
    canvasElement.prependTo('#sm-micro');
  }

  // Initialize canvas
  initializeCanvas();

  // Score toggle functionality for mobile
  $('#scoreToggle').click(function () {
    $('.score-panel').toggleClass('show');
    const isVisible = $('.score-panel').hasClass('show');
    $(this).text(isVisible ? '✕ Close' : '📊 Score');
  });

  // Simple onclick handlers for each button
  $('#button0').click(function () {
    step(0); // Left button (red)
    addButtonFeedback(0);
  });

  $('#button1').click(function () {
    step(1); // Down button (blue)
    addButtonFeedback(1);
  });

  $('#button2').click(function () {
    step(2); // Up button (green)
    addButtonFeedback(2);
  });

  $('#button3').click(function () {
    step(3); // Right button (yellow)
    addButtonFeedback(3);
  });

  // Also handle touch events for mobile
  if (window.Touch) {
    $('#button0')[0].ontouchstart = function () {
      step(0);
      addButtonFeedback(0);
    };
    $('#button1')[0].ontouchstart = function () {
      step(1);
      addButtonFeedback(1);
    };
    $('#button2')[0].ontouchstart = function () {
      step(2);
      addButtonFeedback(2);
    };
    $('#button3')[0].ontouchstart = function () {
      step(3);
      addButtonFeedback(3);
    };
  }

  // Function to add visual feedback to buttons
  function addButtonFeedback(buttonId) {
    var button = $('#button' + buttonId);
    button.addClass('button-pressed');
    setTimeout(function () {
      button.removeClass('button-pressed');
    }, 150);
  }

  $(document).keydown(function (event) {
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
        audio.play();
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
    $('#FPS').text(fps);
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

function draw() {
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
    $('#w' + i).text(tapNoteScores[i]);
  }
  $('#percent-score').text('0.00%');

  // Update global variables from window
  if (window.steps && window.steps.noteData) {
    noteData = window.steps.noteData;
  }
  if (window.song) {
    bpm = window.song.bpm;
    beatsPerSec = bpm / 60;
    addToMusicPositionSeconds = window.song.addToMusicPosition;
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
