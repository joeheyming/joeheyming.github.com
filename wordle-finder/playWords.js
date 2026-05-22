function resetPlayer(clearGraph) {
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
  chooseWord.disabled = false;
  playWordsMode = 'start';
  sortSelector.style.display = 'none';
  sortSelectorSelect.value = 'pattern-entropy';

  // Only clear graph if explicitly requested
  if (clearGraph) {
    playWordsResults.innerHTML = '';
    playStats = {}; // Reset stats too
  }

  // Hide benchmark options
  var benchmarkOptions = document.getElementById('benchmarkOptions');
  if (benchmarkOptions) benchmarkOptions.style.display = 'none';

  var radio = document.querySelector('[type=radio]:checked');
  if (radio && radio.value === 'auto-play') {
    sortSelector.style.display = '';
  }
}

function renderPlayWords(spots, notSpotsLetters, excluded) {
  var filtered = filterDictionary(spots, notSpotsLetters, excluded);
  var stats = getStats(filtered);
  var sortValue = sortSelectorSelect.value;

  var currentWords = filtered.matched;
  if (sortValue === 'pattern-entropy') {
    // Use the information-theory based pattern entropy score
    var patternScores = stats.patternEntropyScore || [];
    if (patternScores.length > 0) {
      currentWords = patternScores.map(function (score) {
        // Strip ★ suffix for clean word
        return score[0].replace('★', '');
      });
    }
  } else if (sortValue === 'frequency-score') {
    var frequencyScores = stats.frequencyScore;
    currentWords = frequencyScores.map(function (score) {
      return score[0];
    });
  }
  // 'alphabet' uses default matched order (already alphabetical)

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
  var radio = document.querySelector('[type=radio]:checked');

  // Handle benchmark mode separately
  if (radio && radio.value === 'benchmark') {
    var startWordInput = document.getElementById('benchmarkStartWord');
    var word = startWordInput ? startWordInput.value.toLowerCase().trim() : '';
    if (word && word.length !== 5) {
      alert('Starting word must be 5 letters');
      return;
    }
    step1.style.display = 'none';
    chooseWord.innerText = 'Running...';
    chooseWord.disabled = true;
    runBenchmark(word || null);
    return;
  }

  playWordsMode = 'choose';
  step1.style.display = 'none';
  playWordsWin.style.display = 'none';
  wordSelector.style.display = '';
  sortSelector.style.display = '';

  if (radio && radio.value === 'randomPlayWord') {
    var selection = Math.floor(Math.random() * allWords.length);
    var randomWord = allWords[selection];
    playWordsAnswer = randomWord;
  }
  wordDisplay.innerHTML = 'No words have been played yet';
  chooseWord.innerText = 'Choose';
  playWordsDone = false;
  renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);

  if (radio && radio.value === 'auto-play') {
    autoPlay();
  }
}

var playInterval;
var playStats = {};
var isPaused = false;

function autoPlay() {
  if (playInterval) {
    return;
  }

  isPaused = false;
  var results = [];
  var answerCount = 0;

  playInterval = setInterval(function () {
    // Skip if paused
    if (isPaused) return;

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
        updatePauseButton();
      } else {
        onStart();
        window.sortSelectorSelect.value = lastSort;
      }
    }
  }, 250);

  updatePauseButton();
}

function togglePause() {
  isPaused = !isPaused;
  updatePauseButton();
}

function stopAutoPlay() {
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = undefined;
  }
  isPaused = false;
  updatePauseButton();
}

function updatePauseButton() {
  var pauseBtn = document.getElementById('pauseBtn');
  if (pauseBtn) {
    if (!playInterval) {
      pauseBtn.style.display = 'none';
    } else {
      pauseBtn.style.display = '';
      pauseBtn.innerText = isPaused ? '▶ Resume' : '⏸ Pause';
    }
  }
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

/**
 * Update the stats graph showing distribution of guesses
 */
function updateStatsGraph() {
  var y = Object.keys(playStats);
  if (y.length === 0) return;

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

  // Calculate total games for percentage
  var totalGames = 0;
  Object.keys(playStats).forEach(function (k) {
    totalGames += playStats[k];
  });

  var data = [
    {
      type: 'bar',
      marker: {
        color: '#467046'
      },
      x: x,
      y: y,
      orientation: 'h',
      text: x.map(function (val) {
        return val + ' (' + Math.round((val / totalGames) * 100) + '%)';
      }),
      textposition: 'outside',
      textangle: 0
    }
  ];

  var graphWidth = Math.min(320, playWordsResults.clientWidth || 320);

  Plotly.newPlot(
    playWordsResults,
    data,
    {
      showlegend: false,
      width: graphWidth,
      height: 200,
      title: {
        text: 'Games: ' + totalGames,
        font: { size: 12 }
      },
      xaxis: {
        showgrid: false,
        zeroline: false
      },
      yaxis: {
        showgrid: false,
        zeroline: false,
        autorange: 'reversed',
        title: 'Guesses'
      },
      margin: {
        t: 30,
        l: 40,
        r: 80,
        b: 20
      }
    },
    {
      displayModeBar: false
    }
  );
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
  // Remove ★ suffix if present (from entropy score display)
  var currentWord = playWords.value.replace('★', '');
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

    // Always update the graph when a game is won
    updateStatsGraph();
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
    playWords.innerHTML = '';
    renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
  };

  // Show/hide benchmark options based on radio selection
  var radios = document.querySelectorAll('[name=playMode]');
  radios.forEach(function (radio) {
    radio.onchange = function () {
      var benchmarkOptions = document.getElementById('benchmarkOptions');
      if (benchmarkOptions) {
        benchmarkOptions.style.display = this.value === 'benchmark' ? '' : 'none';
      }
      // Show sort selector for auto-play in initial state
      if (sortSelector && this.value === 'auto-play') {
        sortSelector.style.display = '';
      } else if (sortSelector) {
        sortSelector.style.display = 'none';
      }
    };
  });

  resetPlayer();
}

// ============================================================
// BENCHMARK MODE - Test algorithm against all Wordle answers
// ============================================================

var benchmarkRunning = false;
var benchmarkResults = [];

/**
 * Simulate a single game: given an answer, return number of guesses needed
 */
function simulateGame(answer, startingWord) {
  var spots = ['', '', '', '', ''];
  var notSpots = [[], [], [], [], []];
  var excluded = [];
  var guessCount = 0;
  var maxGuesses = 10;

  while (guessCount < maxGuesses) {
    var filtered = filterDictionary(spots, notSpots, excluded);
    var stats = getStats(filtered);

    var guess;
    if (guessCount === 0 && startingWord) {
      guess = startingWord;
    } else if (stats.patternEntropyScore && stats.patternEntropyScore.length > 0) {
      guess = stats.patternEntropyScore[0][0].replace('★', '');
    } else if (filtered.matched.length > 0) {
      guess = filtered.matched[0];
    } else {
      return guessCount + 1;
    }

    guessCount++;
    if (guess === answer) return guessCount;

    // Apply guess result
    var answerLetters = answer.split('');
    var guessLetters = guess.split('');
    var used = [false, false, false, false, false];
    var isGreenThisGuess = [false, false, false, false, false];

    for (var i = 0; i < 5; i++) {
      if (guessLetters[i] === answerLetters[i]) {
        spots[i] = guessLetters[i];
        used[i] = true;
        isGreenThisGuess[i] = true;
      }
    }

    for (var ii = 0; ii < 5; ii++) {
      if (isGreenThisGuess[ii]) continue;
      var letter = guessLetters[ii];
      var foundYellow = false;
      for (var jj = 0; jj < 5; jj++) {
        if (!used[jj] && letter === answerLetters[jj]) {
          notSpots[ii].push(letter);
          used[jj] = true;
          foundYellow = true;
          break;
        }
      }
      if (!foundYellow && excluded.indexOf(letter) === -1) {
        var appearsElsewhere = false;
        for (var kk = 0; kk < 5; kk++) {
          if (spots[kk] === letter || notSpots[kk].indexOf(letter) !== -1) {
            appearsElsewhere = true;
            break;
          }
        }
        if (!appearsElsewhere) {
          excluded.push(letter);
        } else {
          notSpots[ii].push(letter);
        }
      }
    }
  }
  return maxGuesses;
}

function runBenchmark(startingWord) {
  if (benchmarkRunning) return;

  var answers = window.wordleAnswers ? Array.from(window.wordleAnswers) : [];
  if (answers.length === 0) {
    alert('No Wordle answers found. Make sure wordFrequency.js is loaded.');
    return;
  }

  benchmarkRunning = true;
  benchmarkResults = [];
  var distribution = {};
  var totalGuesses = 0;
  var failures = 0;
  var startTime = Date.now();
  var index = 0;
  var batchSize = 20;

  console.log('=== BENCHMARK START ===');
  console.log('Testing ' + answers.length + ' words, starting with: ' + (startingWord || '(auto)'));

  function processBatch() {
    var batchEnd = Math.min(index + batchSize, answers.length);

    for (var i = index; i < batchEnd; i++) {
      var answer = answers[i];
      var guesses = simulateGame(answer, startingWord);
      benchmarkResults.push({ word: answer, guesses: guesses });
      totalGuesses += guesses;
      distribution[guesses] = (distribution[guesses] || 0) + 1;
      if (guesses > 6) failures++;
    }

    index = batchEnd;
    var pct = Math.round((index / answers.length) * 100);
    playWordsResults.innerHTML =
      '<p>Progress: ' + index + '/' + answers.length + ' (' + pct + '%)</p>';

    if (index < answers.length) {
      setTimeout(processBatch, 0);
    } else {
      finishBenchmark(answers.length, totalGuesses, distribution, failures, startTime);
    }
  }

  processBatch();
}

function finishBenchmark(total, totalGuesses, distribution, failures, startTime) {
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  var average = (totalGuesses / total).toFixed(3);
  var successRate = (((total - failures) / total) * 100).toFixed(1);

  console.log('=== RESULTS ===');
  console.log(
    'Average: ' + average + ' guesses, Success: ' + successRate + '%, Time: ' + elapsed + 's'
  );

  var html = '<h3>Benchmark Results</h3>';
  html += '<p><strong>Average:</strong> ' + average + ' guesses</p>';
  html += '<p><strong>Success (≤6):</strong> ' + successRate + '%</p>';
  html += '<p><strong>Time:</strong> ' + elapsed + 's</p>';
  html += '<div style="margin-top: 10px;">';

  for (var g = 1; g <= 8; g++) {
    var count = distribution[g] || 0;
    if (count === 0) continue;
    var pct = ((count / total) * 100).toFixed(1);
    var width = Math.round((count / total) * 200);
    var color = g <= 6 ? '#467046' : '#686c70';
    html += '<div style="margin: 2px 0; display: flex; align-items: center;">';
    html += '<span style="width: 20px;">' + g + '</span>';
    html +=
      '<span style="width: ' +
      width +
      'px; height: 16px; background: ' +
      color +
      '; display: inline-block;"></span>';
    html += '<span style="margin-left: 5px;">' + count + ' (' + pct + '%)</span>';
    html += '</div>';
  }
  html += '</div>';

  playWordsResults.innerHTML = html;
  benchmarkRunning = false;
  chooseWord.innerText = 'Start Over';
  chooseWord.disabled = false;
  playWordsMode = 'done';
}

window.runBenchmark = runBenchmark;
