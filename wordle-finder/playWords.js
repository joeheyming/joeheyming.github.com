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
}

function renderPlayWords(spots, notSpotsLetters, excluded) {
  var filtered = filterDictionary(spots, notSpotsLetters, excluded);
  var stats = getStats(filtered);
  var frequencyScore = getEntropyScore(filtered, stats);

  const fragment = document.createDocumentFragment();
  frequencyScore.forEach(function(score) {
    var word = score[0];
    const option = document.createElement('option');
    option.value = word;
    option.innerText = word;
    fragment.appendChild(option);
  });
  playWords.appendChild(fragment);
  playWords.value = frequencyScore[0][0];
}

var chosenWords;
var playWordsAnswer;

function onStart() {
  playWordsMode = 'choose';
  step1.style.display = 'none';
  playWordsWin.style.display = 'none';
  wordSelector.style.display = '';

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
  const fragment = document.createDocumentFragment();
  chosenWords.forEach(function(wordResults) {
    const resultFragment = document.createElement('div');
    wordResults.forEach(function(result) {
      const letterFragment = document.createElement('div');
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
  const currentWord = playWords.value;
  var wordDisplay = document.createDocumentFragment();

  // if they are equal, you win
  if (currentWord.toLowerCase() === playWordsAnswer.toLowerCase()) {
    chooseWord.innerText = 'Start Over';
    playWordsWin.style.display = '';
    wordSelector.style.display = 'none';
    playWordsMode = 'done';
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
  resetPlayer();
}
