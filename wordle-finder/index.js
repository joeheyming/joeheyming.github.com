/**
 * This file was intentionally vanilla js because I wanted a challenge
 */
window.analytics = function () {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    dataLayer.push(arguments);
  };
  gtag('js', new Date());

  gtag('config', 'G-Q62Q3E20Y0');
};
if (location.hostname !== 'localhost') {
  analytics();
} else {
  window.gtag = function () {};
}

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
  gtag('event', 'generate_random_word', {
    event_category: 'user action'
  });
};

function guess(event) {
  event.preventDefault();
  var spots = [first, second, third, fourth, fifth].map(function (spot) {
    return spot.value.toLowerCase() || '';
  });
  var notSpots = [notfirst, notsecond, notthird, notfourth, notfifth].map(function (spot) {
    return spot.value.toLowerCase() || '';
  });
  var notSpotsLetters = notSpots.map(function (spot) {
    return spot.split('');
  });
  var excluded = excludeLetters.value.toLowerCase().split('');

  var filtered = filterDictionary(spots, notSpotsLetters, excluded);

  var stats = getStats(filtered);

  renderFrequencyScoreTab(stats);
  renderEntropyScore(filtered, stats);
  renderMatches(filtered);
  renderCombos(filtered, stats);
  renderMatchCount(filtered);

  results.removeAttribute('hidden');

  gtag('event', 'submit', {
    event_category: 'user action'
  });

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
  gtag('event', 'reset', {
    event_category: 'user action'
  });
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
  gtag('event', 'help_click', {
    event_category: 'user action'
  });
}

function setMode(mode) {
  if (mode === 'play') {
    resetPlayer();
    scorer.style.display = 'none';
    results.style.display = 'none';
    player.style.display = '';
  } else {
    resetScorer();
    scorer.style.display = '';
    results.style.display = '';
    player.style.display = 'none';
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

window.onload = function () {
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
      setMode(this.value);
    };
    //solverMode.value = 'play';
    solverMode.value = 'score';
    setMode(solverMode.value);

    initPlayer();
  }, 1);
};
