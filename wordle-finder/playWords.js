function resetPlayer() {
  step1.style.display = '';
  wordSelector.style.display = 'none';
  playWordsSpots = ['', '', '', '', ''];
  playwordsNotSpots = [[], [], [], [], []];
  playWordsExclude = [];
  chosenWords = [];
  playWordsWin.style.display = 'none';
  playWordsDone = false;
  wordDisplay.innerHTML = '';
  chooseWord.innerText = 'Start';
  playWordsMode = 'start';
  sortSelector.style.display = 'none';
  sortSelectorSelect.value = 'entropy-score';
  window.excludePreviousAnswers.checked = false;
  var radio = document.querySelector('[type=radio]:checked');
  if (radio.value === 'auto-play') {
    sortSelector.style.display = '';
  }
}

function renderPlayWords(spots, notSpotsLetters, excluded) {
  var filtered = filterDictionary(spots, notSpotsLetters, excluded);
  var stats = getStats(filtered);
  var sortValue = sortSelectorSelect.value;

  var currentWords = filtered.matched;
  if (sortValue === 'frequency-score') {
    var frequencyScores = stats.frequencyScore;
    currentWords = frequencyScores.map(function (score) {
      return score[0];
    });
  } else if (sortValue === 'entropy-score') {
    var entropyScores = stats.entropyScore;
    currentWords = entropyScores.map(function (score) {
      return score[0];
    });
  } else if (sortValue === 'spot-entropy-score') {
    var entropyScores = stats.spotEntropyScore;
    currentWords = entropyScores.map(function (score) {
      return score[0];
    });
  } else if (sortValue === 'combined-entropy-score') {
    var entropyScores = stats.combinedEntropyScore;
    currentWords = entropyScores.map(function (score, index) {
      return score[0];
    });
  }

  var fragment = document.createDocumentFragment();
  currentWords.forEach(function (word) {
    var option = document.createElement('option');
    option.value = word;
    option.innerText = word;
    fragment.appendChild(option);
  });
  playWords.appendChild(fragment);
  playWords.value = currentWords[0];
}

var chosenWords;
var playWordsAnswer;

function onStart() {
  playWordsMode = 'choose';
  step1.style.display = 'none';
  playWordsWin.style.display = 'none';
  wordSelector.style.display = '';
  sortSelector.style.display = '';

  // todo, support random and custom
  var radio = document.querySelector('[type=radio]:checked');
  if (radio.value === 'wotd') {
    playWordsAnswer = currentAnswer;
  } else if (radio.value === 'randomPlayWord') {
    var selection = Math.floor(Math.random() * allWords.length);
    var randomWord = allWords[selection];
    playWordsAnswer = randomWord;
  }
  wordDisplay.innerHTML = 'No words have been played yet';
  chooseWord.innerText = 'Choose';
  playWordsDone = false;
  renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);

  if (radio.value === 'auto-play') {
    autoPlay();
  }
}

var playInterval;
var playStats = {};

function autoPlay() {
  if (playInterval) {
    return;
  }

  var results = [];
  var answerCount = 0;

  playInterval = setInterval(function () {
    // action
    if (playWordsMode === 'choose') {
      if (playWordsAnswer === undefined) {
        playWordsAnswer = allWords[answerCount];
      }
      onChooseWord();
    } else if (playWordsMode === 'done') {
      results.push({
        word: playWordsAnswer,
        tries: chosenWords.length + 1
      });

      playWordsAnswer = undefined;
      answerCount = answerCount + 1;
      var lastSort = window.sortSelectorSelect.value;
      resetPlayer();
      if (answerCount >= allWords.length) {
        clearInterval(playInterval);
        playInterval = undefined;
      } else {
        onStart();
        window.sortSelectorSelect.value = lastSort;
      }
    }
  }, 250);
}

var playWordsSpots;
var playWordsExclude;
var playWordsMode;

function renderWords() {
  wordDisplay.innerHTML = '';
  var fragment = document.createDocumentFragment();
  chosenWords.forEach(function (wordResults) {
    var resultFragment = document.createElement('div');
    wordResults.forEach(function (result) {
      var letterFragment = document.createElement('div');
      letterFragment.className = 'play-letter ' + result.result;
      letterFragment.innerHTML = result.letter;
      resultFragment.appendChild(letterFragment);
    });
    wordDisplay.appendChild(resultFragment);
  });
  wordDisplay.appendChild(fragment);
}

function onChooseWord() {
  if (playWordsMode === 'start') {
    onStart();
    return;
  }
  if (playWordsMode === 'done') {
    resetPlayer();
    return;
  }
  var currentWord = playWords.value;
  var wordDisplay = document.createDocumentFragment();

  // if they are equal, you win
  if (currentWord.toLowerCase() === playWordsAnswer.toLowerCase()) {
    var numPlays = chosenWords.length + 1;
    if (!playStats[numPlays]) {
      playStats[numPlays] = 0;
    }
    playStats[numPlays] = playStats[numPlays] + 1;
    chooseWord.innerText = 'Start Over';
    playWordsWin.style.display = '';
    wordSelector.style.display = 'none';
    sortSelector.style.display = 'none';
    playWordsMode = 'done';
    playWordsCount.innerHTML = '<strong>You got it in ' + numPlays + '</strong>';
    var radio = document.querySelector('[type=radio]:checked');
    if (radio.value === 'auto-play') {
      var y = Object.keys(playStats);
      var maxY = 0;
      y.forEach(function (i) {
        maxY = Math.max(i, maxY);
      });
      y = Array.from({ length: maxY }, function (x, i) {
        return i;
      });
      y.push(maxY);
      y.shift();
      var x = y.map(function (i) {
        return playStats[i] || 0;
      });
      var data = [
        {
          type: 'bar',
          marker: {
            color: '#6aaa64'
          },
          x: x,
          y: y,
          orientation: 'h',
          text: x.map(String),
          textangle: 0
        }
      ];

      Plotly.newPlot(
        playWordsResults,
        data,
        {
          showlegend: false,
          width: 300,
          xaxis: {
            showgrid: false,
            zeroline: false
          },
          yaxis: {
            showgrid: false,
            zeroline: false,
            autorange: 'reversed'
          },
          margin: {
            t: 0
          }
        },
        {
          displayModeBar: false
        }
      );
    }
  }

  var guessResults = [];
  var letters = currentWord.split('');
  var maybeCorrectLetters = {};
  var correctLetters = {};
  var letterLookup = {};

  playWordsAnswer.split('').forEach(function (letter) {
    if (!letterLookup[letter]) {
      letterLookup[letter] = 1;
    } else {
      letterLookup[letter] = letterLookup[letter] + 1;
    }
  });

  letters.forEach(function (letter, index) {
    if (letter === playWordsAnswer[index]) {
      playWordsSpots[index] = letter;
      guessResults[index] = { letter: letter, result: 'correct' };
      if (!correctLetters[letter]) {
        correctLetters[letter] = 1;
      } else {
        correctLetters[letter] = correctLetters[letter] + 1;
      }
    } else if (playWordsAnswer.match(letter)) {
      if (!maybeCorrectLetters[letter]) {
        maybeCorrectLetters[letter] = 1;
      } else {
        maybeCorrectLetters[letter] = maybeCorrectLetters[letter] + 1;
      }
      guessResults[index] = { letter: letter, result: 'maybecorrect' };
      playwordsNotSpots[index].push(letter);
    } else {
      playWordsExclude.push(letter);
      guessResults[index] = { letter: letter, result: 'incorrect' };
    }
  });

  letters.forEach(function (letter, index) {
    if (
      guessResults[index].result === 'maybecorrect' &&
      maybeCorrectLetters[letter] + correctLetters[letter] > letterLookup[letter]
    ) {
      guessResults[index].result = 'incorrect';
    }
  });
  chosenWords.push(guessResults);

  playWords.innerHTML = '';
  renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
  renderWords();
}

function initPlayer() {
  chooseWord.onclick = onChooseWord;
  sortSelectorSelect.onchange = function () {
    renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
  };
  resetPlayer();
}
