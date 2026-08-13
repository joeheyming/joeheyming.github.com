/**
 * This file was intentionally vanilla js because I wanted a challenge
 */

// Safe gtag wrapper - won't crash if analytics is blocked
function safeGtag() {
  if (typeof gtag === 'function') {
    gtag.apply(null, arguments);
  }
}

// `window.yieldToMain` is defined by /analytics.js (loaded sync in <head>).
// Local ref keeps the callsite short and avoids a global lookup per await.
var yieldToMain = window.yieldToMain;

// current answer of hte day
var currentAnswer;
// Days since the first wordle.  Useful index for the answers
var currentWordleDay;

// words without past answers
var wordsFilteredByAnswer;
// all possible words
var allWords;

function getWords() {
  var clonedList = Array.from(allWords);
  return clonedList;
}

var answers;
function isIsogram(str) {
  return !/(.).*\1/.test(str);
}

randomWordButton.onclick = function () {
  var word;
  var item;
  var wordList = getWords();
  do {
    item = Math.floor(Math.random() * wordList.length);
    word = wordList[item];
  } while (!isIsogram(word));
  randomWord.textContent = word;
};

// Guard against overlapping submits — the async yield below means a second
// click could otherwise re-enter guess() while the first is still running.
var guessInFlight = false;

// Read all form inputs synchronously up-front so we don't touch the DOM
// again after yielding (the user could type into a field while we're
// scheduled). Cheap — five .value reads plus a couple splits.
function readGuessInputs() {
  var spots = [first, second, third, fourth, fifth].map(function (spot) {
    return spot.value.toLowerCase() || '';
  });
  var notSpots = [notfirst, notsecond, notthird, notfourth, notfifth].map(function (spot) {
    return spot.value.toLowerCase() || '';
  });
  return {
    spots: spots,
    notSpotsLetters: notSpots.map(function (spot) {
      return spot.split('');
    }),
    excluded: excludeLetters.value.toLowerCase().split('')
  };
}

// The Submit handler used to run the entropy solver (up to ~690k pattern
// comparisons on the first guess) plus four tab re-renders synchronously
// inside the click event. On a mid-range Android that pushed INP to
// 400-800ms — well past the 200ms "good" threshold and the biggest single
// contributor to the origin-level p75. The refactor below paints an
// immediate "Working…" state, yields to the browser so it can render that
// frame, then does the heavy work in a fresh task. Post-yield paint is no
// longer part of the click's INP measurement.
async function guess(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (guessInFlight) return false;
  guessInFlight = true;

  var inputs = readGuessInputs();

  var submitBtn = document.getElementById('submit');
  var matchCount = window['match-count'];
  var wasDisabled = submitBtn ? submitBtn.disabled : false;
  if (submitBtn) submitBtn.disabled = true;
  if (matchCount) {
    matchCount.textContent = 'Working…';
    matchCount.removeAttribute('hidden');
  }

  await yieldToMain();

  try {
    var filtered = filterDictionary(inputs.spots, inputs.notSpotsLetters, inputs.excluded);
    var stats = getStats(filtered);

    renderFrequencyScoreTab(stats);
    renderEntropyScore(filtered, stats);
    renderMatches(filtered);
    renderCombos(filtered, stats);
    renderMatchCount(filtered);

    results.removeAttribute('hidden');

    safeGtag('event', 'submit', {
      event_category: 'user action'
    });
  } finally {
    if (submitBtn) submitBtn.disabled = wasDisabled;
    guessInFlight = false;
  }

  return false;
}

function resetScorer() {
  excludeLetters.value = '';
  first.value = '';
  second.value = '';
  third.value = '';
  fourth.value = '';
  fifth.value = '';
  notfirst.value = '';
  notsecond.value = '';
  notthird.value = '';
  notfourth.value = '';
  notfifth.value = '';
  randomWord.textContent = '';
  window['match-count'].setAttribute('hidden', '');
  results.setAttribute('hidden', '');
}

reset.onclick = function () {
  resetScorer();
};

function fetchWords() {
  // words.js is loaded via HTML script tag and should populate window.allwords
  if (window.allwords) {
    allWords = window.allwords;
  } else {
    console.error('window.allwords not found. Make sure words.js is loaded.');
  }
}

function helpClick() {
  dialog.style.display = '';
}

function setMode(mode) {
  var wordleGame = document.getElementById('wordle-game');
  var strategyRow = document.getElementById('strategy-row');
  var sourceRow = document.getElementById('wordle-source-row');

  // Word source is Play Wordle only — not solver or Play with helper.
  if (sourceRow) {
    var showSource = mode === 'wordle';
    sourceRow.hidden = !showSource;
    sourceRow.style.display = showSource ? '' : 'none';
  }

  if (mode === 'play') {
    resetPlayer();
    scorer.style.display = 'none';
    results.style.display = 'none';
    player.style.display = '';
    if (wordleGame) wordleGame.style.display = 'none';
    if (strategyRow) strategyRow.style.display = '';
  } else if (mode === 'wordle') {
    resetScorer();
    resetPlayer();
    scorer.style.display = 'none';
    results.style.display = 'none';
    player.style.display = 'none';
    if (strategyRow) strategyRow.style.display = 'none';
    if (wordleGame) wordleGame.style.display = '';
    if (typeof window.startWordleFromSource === 'function') {
      window.startWordleFromSource();
    } else if (typeof window.startWordleGame === 'function') {
      window.startWordleGame();
    }
  } else {
    resetScorer();
    scorer.style.display = '';
    results.style.display = '';
    player.style.display = 'none';
    if (wordleGame) wordleGame.style.display = 'none';
    if (strategyRow) strategyRow.style.display = '';
  }
}

function addSwipe() {
  var xDown = null;
  var yDown = null;
  function getTouches(evt) {
    return (
      evt.touches || // browser API
      evt.originalEvent.touches
    ); // jQuery
  }

  function handleTouchStart(evt) {
    const firstTouch = getTouches(evt)[0];
    xDown = firstTouch.clientX;
    yDown = firstTouch.clientY;
  }

  function handleTouchMove(evt) {
    if (!xDown || !yDown) {
      return;
    }

    if (results.getAttribute('hidden') === '') {
      return;
    }
    var selected = document.querySelector("[role='tab'][aria-selected=true]");
    var tabList = document.querySelector('[role=tablist]');
    var children = Array.from(tabList.children);
    var index = 0;
    for (var i = 0; i < children.length; i++) {
      index = i;
      var child = children[i];
      if (selected.id === child.id) {
        break;
      }
    }

    var xUp = evt.touches[0].clientX;
    var yUp = evt.touches[0].clientY;

    var xDiff = xDown - xUp;
    var yDiff = yDown - yUp;

    var target;
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
      /*most significant*/
      if (xDiff > 0) {
        var prevIndex = Math.max(0, index - 1);
        target = children[prevIndex];
        /* right swipe */
      } else {
        var nextIndex = Math.min(children.length - 1, index + 1);
        target = children[nextIndex];
      }
    }
    if (target) {
      changeTabs(target);
    }
    /* reset values */
    xDown = null;
    yDown = null;
  }
  document.addEventListener('touchstart', handleTouchStart, false);
  document.addEventListener('touchmove', handleTouchMove, false);
}

// Don't use `window.onload = ...` here — analytics.js also listens for load,
// and a property assignment would replace its handler, breaking GA tracking
// for this page.
window.addEventListener('load', function () {
  setTimeout(function () {
    addSwipe();
    // there is a limit to the number of wordles
    // eventually this number will overflow the list of answers
    currentWordleDay = moment().diff(moment('20210619', 'YYYYMMDD'), 'days');

    fetchWords();

    guessForm.onsubmit = guess;
    submit.onclick = guess;
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        dialog.style.display = 'none';
      }
    });
    helpIcon.onclick = helpClick;

    initTabs();
    solverMode.onchange = function () {
      var mode = this.value;
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('wordle_mode_change', 'Wordle', mode);
      }
      setMode(mode);
    };
    var wordleSource = document.getElementById('wordleSource');
    if (wordleSource) {
      wordleSource.onchange = function () {
        if (solverMode.value === 'wordle' && typeof window.startWordleFromSource === 'function') {
          window.startWordleFromSource();
        }
      };
    }

    //solverMode.value = 'play';
    solverMode.value = 'score';
    setMode(solverMode.value);

    initPlayer();
  }, 1);
});
