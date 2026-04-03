#!/usr/bin/env node
/**
 * Node.js benchmark harness for the Wordle solver.
 * Concatenates all browser JS into a single eval to avoid vm context overhead.
 *
 * Usage:  node benchmark.js [startingWord]
 * Example: node benchmark.js salet
 */

const fs = require('fs');
const path = require('path');

const dir = __dirname;

// Shim browser globals
global.window = global;
global.Set = Set;
global.alert = () => {};

// Load browser scripts in dependency order (same as index.html)
const filesToLoad = ['wordFrequency.js', 'words.js', 'filter.js'];

for (const file of filesToLoad) {
  const code = fs.readFileSync(path.join(dir, file), 'utf-8');
  // eslint-disable-next-line no-eval
  eval(code);
}

// Make allWords available the way index.js does
global.allWords = global.window.allwords;
global.getWords = function () {
  return Array.from(global.allWords);
};

function simulateGame(answer, startingWord, trace) {
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
    if (trace) {
      var solns = filtered.matched.filter(function (w) {
        return window.wordleAnswers ? window.wordleAnswers.has(w) : true;
      });
      var nsStr = notSpots
        .map(function (ns, i) {
          return ns.length ? i + ':!' + ns.join('') : '';
        })
        .filter(Boolean)
        .join(' ');
      console.log(
        '  guess ' +
          guessCount +
          ': ' +
          guess +
          ' (solutions=' +
          solns.length +
          ', matched=' +
          filtered.matched.length +
          ')' +
          (solns.length <= 10 ? ' [' + solns.join(', ') + ']' : '') +
          '\n    spots=[' +
          spots.join(',') +
          '] excl=[' +
          excluded.join(',') +
          '] notSpots={' +
          nsStr +
          '}'
      );
    }
    if (guess === answer) return guessCount;

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
          // Gray but letter appears in green/yellow elsewhere:
          // record that THIS position is definitely not this letter
          notSpots[ii].push(letter);
        }
      }
    }
  }
  return maxGuesses;
}

// --- Run the benchmark ---

const args = process.argv.slice(2);
let startingWord = null;
let quickMode = false;
let sampleSize = 0;

let traceWord = null;

for (const arg of args) {
  if (arg === '--quick') {
    quickMode = true;
    sampleSize = 300;
  } else if (arg.startsWith('--sample=')) {
    sampleSize = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--trace=')) {
    traceWord = arg.split('=')[1];
  } else if (arg.startsWith('--strategy=')) {
    global.window._solverStrategy = arg.split('=')[1];
  } else if (arg.length === 5 && /^[a-z]+$/.test(arg)) {
    startingWord = arg;
  }
}

// Handle trace mode: trace a single word and exit
if (traceWord) {
  console.log('=== TRACE: ' + traceWord + ' ===');
  const result = simulateGame(traceWord, startingWord, true);
  console.log('Result: ' + result + ' guesses');
  process.exit(0);
}

const allAnswers = Array.from(global.window.wordleAnswers);

// For quick mode, use a deterministic representative sample
let answers;
if (sampleSize > 0 && sampleSize < allAnswers.length) {
  // Deterministic sample: pick every Nth word
  const step = Math.floor(allAnswers.length / sampleSize);
  answers = [];
  for (let i = 0; i < allAnswers.length && answers.length < sampleSize; i += step) {
    answers.push(allAnswers[i]);
  }
} else {
  answers = allAnswers;
}

const distribution = {};
let totalGuesses = 0;
let failures = 0;
const worstWords = [];
const startTime = Date.now();

console.log('=== WORDLE BENCHMARK ===');
console.log(
  `Words to test: ${answers.length}${sampleSize ? ' (sample of ' + allAnswers.length + ')' : ''}`
);
console.log(`Starting word: ${startingWord || '(auto-select)'}`);
console.log('');

for (let i = 0; i < answers.length; i++) {
  const answer = answers[i];
  const guesses = simulateGame(answer, startingWord);
  totalGuesses += guesses;
  distribution[guesses] = (distribution[guesses] || 0) + 1;
  if (guesses > 6) {
    failures++;
    worstWords.push({ word: answer, guesses });
  }

  if ((i + 1) % 200 === 0 || (quickMode && (i + 1) % 50 === 0)) {
    const pct = (((i + 1) / answers.length) * 100).toFixed(0);
    const avg = (totalGuesses / (i + 1)).toFixed(3);
    const elapsedSoFar = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(
      `  Progress: ${i + 1}/${answers.length} (${pct}%) avg=${avg} elapsed=${elapsedSoFar}s`
    );
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const average = (totalGuesses / answers.length).toFixed(4);
const successRate = (((answers.length - failures) / answers.length) * 100).toFixed(2);

console.log('');
console.log('=== RESULTS ===');
console.log(`Average guesses: ${average}`);
console.log(`Total guesses:   ${totalGuesses}`);
console.log(`Success (≤6):    ${successRate}% (${answers.length - failures}/${answers.length})`);
console.log(`Failures (>6):   ${failures}`);
console.log(`Time:            ${elapsed}s`);
console.log('');
console.log('Distribution:');
for (let g = 1; g <= 10; g++) {
  const count = distribution[g] || 0;
  if (count === 0) continue;
  const pct = ((count / answers.length) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round((count / answers.length) * 80));
  console.log(`  ${g}: ${bar} ${count} (${pct}%)`);
}

if (worstWords.length > 0) {
  worstWords.sort((a, b) => b.guesses - a.guesses);
  console.log('');
  console.log(`Worst words (top 20):`);
  worstWords.slice(0, 20).forEach((w) => console.log(`  ${w.word}: ${w.guesses} guesses`));
}

console.log('');
console.log(
  `SUMMARY: avg=${average} success=${successRate} failures=${failures} total=${answers.length} time=${elapsed}s`
);
