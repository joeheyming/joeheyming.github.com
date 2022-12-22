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
var wordRequest = fetch('words?bust_cache=' + Math.random());
var answerRequest = fetch('answers?bust_cache' + Math.random());

// current answer of hte day
var currentAnswer;
// Days since the first wordle.  Useful index for the answers
var currentWordleDay;

// words without past answers
var wordsFilteredByAnswer;
// all possible words
var allWords;

function getWords() {
  var clonedList = Array.from(
    window.excludePreviousAnswers.checked ? wordsFilteredByAnswer : allWords
  );
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
  function getText(response) {
    return response.text().then(function (text) {
      return text.trim().split('\n');
    });
  }

  Promise.all([wordRequest.then(getText), answerRequest.then(getText)]).then(function (responses) {
    allWords = responses[0];
    answers = responses[1];
    currentAnswer = answers[currentWordleDay];

    // create a lookup to filter later
    var pastAnswers = {};
    for (var i = 0; i < currentWordleDay; i++) {
      var word = answers[i];
      pastAnswers[word] = true;
    }
    wordsFilteredByAnswer = allWords.filter(function (word) {
      return pastAnswers[word] === undefined;
    });
  });
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

window.onload = function () {
  setTimeout(function () {
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
  }, 250);
};
