/**
 * Self-play Wordle clone. Picks a random target from the popular
 * `window.wordleAnswers` set (~2309 NYT-curated answers), accepts free
 * typing, and grades each guess with the same duplicate-letter rules
 * the rest of this app already uses (see playWords.js onChooseWord).
 *
 * Vanilla JS to match the rest of wordle-finder.
 */

(function () {
  var WORDLE_MAX_GUESSES = 6;
  var WORDLE_WORD_LEN = 5;

  // Cached DOM nodes (resolved on init).
  var gameRoot;
  var boardEl;
  var keyboardEl;
  var messageEl;
  var newGameBtn;
  var statusEl;

  var allWordsSet;
  var initialized = false;

  var state = {
    answer: '',
    guesses: [], // submitted guesses (lowercase strings)
    results: [], // parallel to guesses; arrays of 'correct'|'maybecorrect'|'incorrect'
    currentGuess: '',
    status: 'idle', // 'idle' | 'playing' | 'won' | 'lost'
    letterStates: {}, // 'a' -> 'correct'|'maybecorrect'|'incorrect'
    messageTimer: null
  };

  function safeGtag() {
    if (typeof gtag === 'function') {
      gtag.apply(null, arguments);
    }
  }

  function pickRandomAnswer() {
    var pool = window.wordleAnswers;
    if (!pool || typeof pool.size !== 'number' || pool.size === 0) {
      // Fallback: any 5-letter word from the dictionary.
      var list = window.allwords || [];
      if (!list.length) return 'crane';
      return list[Math.floor(Math.random() * list.length)];
    }
    // wordleAnswers is a Set; pick by index without materializing twice.
    var idx = Math.floor(Math.random() * pool.size);
    var i = 0;
    var iter = pool.values();
    var entry = iter.next();
    while (!entry.done) {
      if (i === idx) return entry.value;
      i++;
      entry = iter.next();
    }
    return 'crane';
  }

  function ensureWordsSet() {
    if (allWordsSet) return allWordsSet;
    var list = window.allwords || [];
    allWordsSet = new Set(list);
    // Also accept any popular answer (defensive; they should already be in
    // allwords but the data files were curated separately).
    if (window.wordleAnswers && typeof window.wordleAnswers.forEach === 'function') {
      window.wordleAnswers.forEach(function (w) {
        allWordsSet.add(w);
      });
    }
    return allWordsSet;
  }

  function gradeGuess(guess, answer) {
    // Standard Wordle rules with correct duplicate-letter handling:
    // 1. Mark greens first (consuming those answer slots).
    // 2. Then mark yellows from remaining answer letters left-to-right.
    var result = new Array(WORDLE_WORD_LEN);
    var answerLetters = answer.split('');
    var used = [false, false, false, false, false];

    for (var i = 0; i < WORDLE_WORD_LEN; i++) {
      if (guess[i] === answerLetters[i]) {
        result[i] = 'correct';
        used[i] = true;
      }
    }
    for (var j = 0; j < WORDLE_WORD_LEN; j++) {
      if (result[j]) continue;
      var letter = guess[j];
      var matched = false;
      for (var k = 0; k < WORDLE_WORD_LEN; k++) {
        if (!used[k] && answerLetters[k] === letter) {
          used[k] = true;
          matched = true;
          break;
        }
      }
      result[j] = matched ? 'maybecorrect' : 'incorrect';
    }
    return result;
  }

  function updateLetterStates(guess, result) {
    // Precedence: correct > maybecorrect > incorrect. Don't downgrade.
    var priority = { correct: 3, maybecorrect: 2, incorrect: 1 };
    for (var i = 0; i < WORDLE_WORD_LEN; i++) {
      var letter = guess[i];
      var existing = state.letterStates[letter];
      var next = result[i];
      if (!existing || priority[next] > priority[existing]) {
        state.letterStates[letter] = next;
      }
    }
  }

  function showMessage(text, ms) {
    if (!messageEl) return;
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }
    messageEl.textContent = text;
    messageEl.classList.add('visible');
    if (ms) {
      state.messageTimer = setTimeout(function () {
        messageEl.classList.remove('visible');
        messageEl.textContent = '';
      }, ms);
    }
  }

  function clearMessage() {
    if (!messageEl) return;
    if (state.messageTimer) {
      clearTimeout(state.messageTimer);
      state.messageTimer = null;
    }
    messageEl.classList.remove('visible');
    messageEl.textContent = '';
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    for (var r = 0; r < WORDLE_MAX_GUESSES; r++) {
      var row = document.createElement('div');
      row.className = 'wg-row';
      row.dataset.row = String(r);
      for (var c = 0; c < WORDLE_WORD_LEN; c++) {
        var tile = document.createElement('div');
        tile.className = 'wg-tile';
        tile.dataset.row = String(r);
        tile.dataset.col = String(c);
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  var KEY_ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back']
  ];

  function buildKeyboard() {
    keyboardEl.innerHTML = '';
    KEY_ROWS.forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'wg-key-row';
      row.forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wg-key';
        btn.dataset.key = key;
        if (key === 'enter') {
          btn.classList.add('wg-key-wide');
          btn.textContent = 'Enter';
        } else if (key === 'back') {
          btn.classList.add('wg-key-wide');
          btn.setAttribute('aria-label', 'Backspace');
          btn.textContent = '⌫';
        } else {
          btn.textContent = key;
        }
        btn.addEventListener('click', function () {
          handleKey(key);
          // Mobile: blur so a second tap isn't a button re-activation.
          btn.blur();
        });
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  function renderBoard() {
    // Only mutate tiles whose desired state changed — otherwise the flip
    // animation on already-graded rows would replay every keystroke.
    var rows = boardEl.children;
    for (var r = 0; r < WORDLE_MAX_GUESSES; r++) {
      var row = rows[r];
      var word;
      var graded = null;
      if (r < state.guesses.length) {
        word = state.guesses[r];
        graded = state.results[r];
      } else if (r === state.guesses.length && state.status === 'playing') {
        word = state.currentGuess;
      } else {
        word = '';
      }
      for (var c = 0; c < WORDLE_WORD_LEN; c++) {
        var tile = row.children[c];
        var letter = word[c] || '';
        var desired = graded ? graded[c] : letter ? 'filled' : 'empty';
        if (tile.textContent !== letter) {
          tile.textContent = letter;
        }
        if (tile.dataset.state !== desired) {
          tile.dataset.state = desired;
          tile.classList.remove('correct', 'maybecorrect', 'incorrect', 'filled');
          if (desired !== 'empty') tile.classList.add(desired);
        }
      }
    }
  }

  function renderKeyboard() {
    var btns = keyboardEl.querySelectorAll('.wg-key');
    btns.forEach(function (btn) {
      var key = btn.dataset.key;
      btn.classList.remove('correct', 'maybecorrect', 'incorrect');
      if (key && key.length === 1) {
        var s = state.letterStates[key];
        if (s) btn.classList.add(s);
      }
    });
  }

  function renderStatus() {
    if (!statusEl) return;
    if (state.status === 'won') {
      statusEl.textContent =
        'You got it in ' +
        state.guesses.length +
        (state.guesses.length === 1 ? ' guess!' : ' guesses!');
      statusEl.className = 'wg-status wg-status-win';
    } else if (state.status === 'lost') {
      statusEl.textContent = 'The word was ' + state.answer.toUpperCase();
      statusEl.className = 'wg-status wg-status-lose';
    } else {
      statusEl.textContent = '';
      statusEl.className = 'wg-status';
    }
  }

  function shakeRow(rowIndex) {
    var row = boardEl.children[rowIndex];
    if (!row) return;
    row.classList.remove('wg-shake');
    // Force reflow so the animation can restart.
    void row.offsetWidth;
    row.classList.add('wg-shake');
  }

  function submitGuess() {
    if (state.status !== 'playing') return;
    if (state.currentGuess.length < WORDLE_WORD_LEN) {
      showMessage('Need ' + WORDLE_WORD_LEN + ' letters', 1200);
      shakeRow(state.guesses.length);
      return;
    }
    var words = ensureWordsSet();
    if (!words.has(state.currentGuess)) {
      showMessage('Not in word list', 1500);
      shakeRow(state.guesses.length);
      return;
    }

    var guess = state.currentGuess;
    var graded = gradeGuess(guess, state.answer);
    state.guesses.push(guess);
    state.results.push(graded);
    state.currentGuess = '';
    updateLetterStates(guess, graded);

    var won = graded.every(function (g) {
      return g === 'correct';
    });
    if (won) {
      state.status = 'won';
      safeGtag('event', 'wordle_clone_win', {
        event_category: 'play',
        value: state.guesses.length
      });
      showMessage(
        ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'][
          state.guesses.length - 1
        ] || 'Got it!',
        1800
      );
    } else if (state.guesses.length >= WORDLE_MAX_GUESSES) {
      state.status = 'lost';
      safeGtag('event', 'wordle_clone_loss', {
        event_category: 'play'
      });
    }

    renderBoard();
    renderKeyboard();
    renderStatus();
  }

  function handleKey(key) {
    if (!key) return;
    if (state.status !== 'playing') {
      if (key === 'enter') {
        if (typeof window.startWordleFromSource === 'function') {
          window.startWordleFromSource();
        } else {
          startNewGame();
        }
      }
      return;
    }
    if (key === 'enter') {
      submitGuess();
      return;
    }
    if (key === 'back') {
      if (state.currentGuess.length > 0) {
        state.currentGuess = state.currentGuess.slice(0, -1);
        renderBoard();
      }
      return;
    }
    if (key.length === 1 && key >= 'a' && key <= 'z') {
      if (state.currentGuess.length < WORDLE_WORD_LEN) {
        state.currentGuess += key;
        clearMessage();
        renderBoard();
      }
    }
  }

  function onKeydown(e) {
    if (!gameRoot || gameRoot.style.display === 'none') return;
    // Don't hijack typing inside the help dialog or other inputs.
    var target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    var dialog = document.getElementById('dialog');
    if (dialog && dialog.style.display !== 'none') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      handleKey('enter');
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      handleKey('back');
    } else if (e.key && e.key.length === 1) {
      var ch = e.key.toLowerCase();
      if (ch >= 'a' && ch <= 'z') {
        e.preventDefault();
        handleKey(ch);
      }
    }
  }

  function startNewGame(forcedAnswer) {
    var answer =
      typeof forcedAnswer === 'string' && forcedAnswer.length === WORDLE_WORD_LEN
        ? forcedAnswer.toLowerCase()
        : pickRandomAnswer() || 'crane';
    state.answer = answer.toLowerCase();
    state.guesses = [];
    state.results = [];
    state.currentGuess = '';
    state.status = 'playing';
    state.letterStates = {};
    clearMessage();
    renderBoard();
    renderKeyboard();
    renderStatus();
    if (newGameBtn) newGameBtn.textContent = 'New Game';
    safeGtag('event', 'wordle_clone_new_game', {
      event_category: 'play',
      event_label: forcedAnswer ? 'today' : 'random'
    });
  }

  /** Wipe the board without starting a playable game (e.g. while WOTD loads). */
  function clearBoard(statusText) {
    initWordleGame();
    state.answer = '';
    state.guesses = [];
    state.results = [];
    state.currentGuess = '';
    state.status = 'idle';
    state.letterStates = {};
    clearMessage();
    renderBoard();
    renderKeyboard();
    if (statusEl) {
      statusEl.textContent = statusText || '';
      statusEl.className = 'wg-status';
    }
  }

  function initWordleGame() {
    if (initialized) return;
    gameRoot = document.getElementById('wordle-game');
    if (!gameRoot) return;
    boardEl = gameRoot.querySelector('.wg-board');
    keyboardEl = gameRoot.querySelector('.wg-keyboard');
    messageEl = gameRoot.querySelector('.wg-message');
    statusEl = gameRoot.querySelector('.wg-status');
    newGameBtn = gameRoot.querySelector('.wg-new-game');

    buildBoard();
    buildKeyboard();
    renderBoard();
    renderKeyboard();
    renderStatus();

    if (newGameBtn) {
      newGameBtn.addEventListener('click', function () {
        if (typeof window.startWordleFromSource === 'function') {
          window.startWordleFromSource();
        } else {
          startNewGame();
        }
      });
    }
    document.addEventListener('keydown', onKeydown);
    initialized = true;
  }

  // Expose the lifecycle hooks index.js / nyt-wordle.js call when the mode switches.
  window.initWordleGame = initWordleGame;
  window.clearWordleBoard = clearBoard;
  window.startWordleGame = function (forcedAnswer) {
    initWordleGame();
    startNewGame(forcedAnswer);
  };
})();
