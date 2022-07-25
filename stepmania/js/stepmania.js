var scrollSpeed = 2;
var noteData = steps.noteData;
var bpm = song.bpm;
var beatsPerSec = bpm / 60;
var addToMusicPositionSeconds = song.addToMusicPosition;

var currentTime = 0;
function getMusicBeat(musicSec) {
  return (musicSec + addToMusicPositionSeconds) * beatsPerSec;
}

var audio = document.getElementById('audio_with_controls');

var CANVAS_WIDTH = 320;
var CANVAS_WIDTH = $(document.body).width();
var CANVAS_HEIGHT = 360;
var targetFps = 90;
var lastDate = new Date();
var uptimeSeconds = 0;
var framesInCurrentSecond = 0;

var playerBullets = [];

var colInfos = [
  { x: 64 + 64 * 0, y: 32, rotation: 90 },
  { x: 64 + 64 * 1, y: 32, rotation: 0 },
  { x: 64 + 64 * 2, y: 32, rotation: 180 },
  { x: 64 + 64 * 3, y: 32, rotation: -90 }
];

var targetsY = 32;

function merge(o1, o2) {
  for (var attr in o2) {
    o1[attr] = o2[attr];
  }
}
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
  { x: 160, y: 160 }
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
  if (window.Touch) {
    $('#button0')[0].ontouchstart = function (e) {
      step(0);
    };
    $('#button1')[0].ontouchstart = function (e) {
      step(1);
    };
    $('#button2')[0].ontouchstart = function (e) {
      step(2);
    };
    $('#button3')[0].ontouchstart = function (e) {
      step(3);
    };
  } else {
    $('#button0').click(function (e) {
      step(0);
    });
    $('#button1').click(function (e) {
      step(1);
    });
    $('#button2').click(function (e) {
      step(2);
    });
    $('#button3').click(function (e) {
      step(3);
    });
  }

  $(document).keydown(function (event) {
    var keyCode = event.which;

    var col;
    switch (keyCode) {
      case 65 /*d*/:
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
      event.preventDefault();
    }
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

var canvasElement = $(
  "<canvas width='" + CANVAS_WIDTH + "' height='" + CANVAS_HEIGHT + "'></canvas>"
);
var canvas = canvasElement.get(0).getContext('2d');
canvasElement.prependTo('#sm-micro');

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
