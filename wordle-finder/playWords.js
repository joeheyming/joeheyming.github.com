function resetPlayer() {
  step1.style.display = '';
  wordSelector.style.display = 'none'
  playWordsSpots = ['','','','',''];
  playwordsNotSpots = [[],[],[],[],[]]
  playWordsExclude = []
  chosenWords = [];
  playWordsWin.style.display = 'none';
  playWordsDone = false;
  wordDisplay.innerHTML = '';
  chooseWord.innerText = 'Start';
  playWordsMode = 'start';
  sortSelector.style.display = 'none';
}

function renderPlayWords(spots, notSpotsLetters, excluded) {
  var filtered = filterDictionary(spots, notSpotsLetters, excluded);
  var stats = getStats(filtered);
  var sortValue = sortSelectorSelect.value;

  var words = filtered.matched;
  if (sortValue === 'frequency-score') {
    var frequencyScores = getFrequencyScore(stats);
    words = frequencyScores.map(function (score) { return score[0]; });
  } else if (sortValue === 'entropy-score') {
    var entropyScores = getEntropyScore(filtered, stats);
    words = entropyScores.map(function (score) { return score[0]; });
  }

  var fragment = document.createDocumentFragment();
  words.forEach(function(word) {
    var option = document.createElement('option');
    option.value = word;
    option.innerText = word;
    fragment.appendChild(option);
  });
  playWords.appendChild(fragment);
  playWords.value = words[0];
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
    var selection = Math.floor(Math.random() * words.length);
    var randomWord = words[selection];
    playWordsAnswer = randomWord;
  }
  wordDisplay.innerHTML = 'No words have been played yet'
  chooseWord.innerText = 'Choose';
  playWordsDone = false;
  renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
}

var playWordsSpots;
var playWordsExclude;
var playWordsMode;

function renderWords() {
  wordDisplay.innerHTML = '';
  var fragment = document.createDocumentFragment();
  chosenWords.forEach(function(wordResults) {
    var resultFragment = document.createElement('div');
    wordResults.forEach(function(result) {
      var letterFragment = document.createElement('div');
      letterFragment.className = 'play-letter ' + result.result;
      letterFragment.innerHTML = result.letter
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
    chooseWord.innerText = 'Start Over';
    playWordsWin.style.display = '';
    wordSelector.style.display = 'none';
    sortSelector.style.display = 'none';
    playWordsMode = 'done';
    playWordsCount.innerHTML = '<strong>You got it in ' + (chosenWords.length +1)+ '</strong>'
  }

  var guessResults = [];
  currentWord.split('').forEach(function(letter, index) {
    if (letter === playWordsAnswer[index]) {
      playWordsSpots[index] = letter;
      guessResults.push({ letter: letter, result: 'correct' });
    } else if (playWordsAnswer.match(letter)) {
      playwordsNotSpots[index].push(letter);
      guessResults.push({ letter: letter, result: 'maybecorrect' });
    } else {
      playWordsExclude.push(letter);
      guessResults.push({ letter: letter, result: 'incorrect' });
    }
  });
  chosenWords.push(guessResults);

  playWords.innerHTML = '';
  renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
  renderWords();
}

function initPlayer() {
  chooseWord.onclick = onChooseWord;
  sortSelectorSelect.onchange = function() {
    renderPlayWords(playWordsSpots, playwordsNotSpots, playWordsExclude);
  }
  resetPlayer();
}
