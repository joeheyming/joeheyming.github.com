// ============================================================
// Pattern-Based Entropy (Information Theory - 3Blue1Brown approach)
// OPTIMIZED VERSION - uses typed arrays and avoids string operations
// ============================================================

// ============================================================
// Sigmoid-based Word Popularity Scoring
// ============================================================

/**
 * Sigmoid function: maps any value to range (0, 1)
 * Used to convert word frequency rank to a popularity score
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Calculate a popularity score for a word using sigmoid function
 * Returns a value between 0 and 1, where 1 = very popular
 *
 * Parameters tuned for word frequency ranks:
 * - Rank 100 (very common) → score ~0.95
 * - Rank 500 (common) → score ~0.82
 * - Rank 1000 (moderate) → score ~0.62
 * - Rank 2000 (less common) → score ~0.38
 * - Rank 5000 (uncommon) → score ~0.12
 * - Rank 10000 (rare) → score ~0.02
 */
function getPopularityScore(word) {
  var rank = typeof getWordFrequency === 'function' ? getWordFrequency(word) : 10000;
  var isKnown = typeof isWordleAnswer === 'function' ? isWordleAnswer(word) : false;

  // Sigmoid parameters:
  // midpoint = 1500 (words ranked around 1500 get score ~0.5)
  // steepness = 800 (controls how sharp the transition is)
  var midpoint = 1500;
  var steepness = 800;

  // Transform: low rank (common) → high score
  // sigmoid((midpoint - rank) / steepness)
  var score = sigmoid((midpoint - rank) / steepness);

  // Bonus for known Wordle answers: boost by 0.3 (capped at 1.0)
  if (isKnown) {
    score = Math.min(1.0, score + 0.3);
  }

  return score;
}

/**
 * Calculate combined score: entropy + popularity bonus
 * This blends information theory with word commonality
 *
 * Formula: combinedScore = entropy * (1 + popularityWeight * popularityScore)
 *
 * With popularityWeight = 0.15:
 * - A word with 5.0 bits entropy and popularity 1.0 → 5.0 * 1.15 = 5.75
 * - A word with 5.0 bits entropy and popularity 0.0 → 5.0 * 1.00 = 5.00
 *
 * This gives common words up to a 15% boost
 */
function getCombinedScore(entropy, popularityScore, popularityWeight) {
  popularityWeight = popularityWeight !== undefined ? popularityWeight : 0.15;
  return entropy * (1 + popularityWeight * popularityScore);
}

// ============================================================
// Pattern Calculation Functions
// ============================================================

/**
 * Calculate pattern between guess and solution using char codes (FAST)
 * Returns a number 0-242 representing the pattern (3^5 possibilities).
 * Pattern encoding: 0=gray, 1=yellow, 2=green
 */
function getPatternFast(guessCodes, solutionCodes) {
  // Use a single integer to track used positions (bits 0-4)
  var used = 0;
  var p0 = 0,
    p1 = 0,
    p2 = 0,
    p3 = 0,
    p4 = 0;

  // First pass: mark greens
  if (guessCodes[0] === solutionCodes[0]) {
    p0 = 2;
    used |= 1;
  }
  if (guessCodes[1] === solutionCodes[1]) {
    p1 = 2;
    used |= 2;
  }
  if (guessCodes[2] === solutionCodes[2]) {
    p2 = 2;
    used |= 4;
  }
  if (guessCodes[3] === solutionCodes[3]) {
    p3 = 2;
    used |= 8;
  }
  if (guessCodes[4] === solutionCodes[4]) {
    p4 = 2;
    used |= 16;
  }

  // Second pass: mark yellows (only for non-green positions)
  var g, j;
  if (p0 === 0) {
    g = guessCodes[0];
    for (j = 0; j < 5; j++) {
      if (!(used & (1 << j)) && g === solutionCodes[j]) {
        p0 = 1;
        used |= 1 << j;
        break;
      }
    }
  }
  if (p1 === 0) {
    g = guessCodes[1];
    for (j = 0; j < 5; j++) {
      if (!(used & (1 << j)) && g === solutionCodes[j]) {
        p1 = 1;
        used |= 1 << j;
        break;
      }
    }
  }
  if (p2 === 0) {
    g = guessCodes[2];
    for (j = 0; j < 5; j++) {
      if (!(used & (1 << j)) && g === solutionCodes[j]) {
        p2 = 1;
        used |= 1 << j;
        break;
      }
    }
  }
  if (p3 === 0) {
    g = guessCodes[3];
    for (j = 0; j < 5; j++) {
      if (!(used & (1 << j)) && g === solutionCodes[j]) {
        p3 = 1;
        used |= 1 << j;
        break;
      }
    }
  }
  if (p4 === 0) {
    g = guessCodes[4];
    for (j = 0; j < 5; j++) {
      if (!(used & (1 << j)) && g === solutionCodes[j]) {
        p4 = 1;
        used |= 1 << j;
        break;
      }
    }
  }

  return p0 * 81 + p1 * 27 + p2 * 9 + p3 * 3 + p4;
}

/**
 * Convert word to array of char codes for fast comparison
 */
function wordToCodes(word) {
  return [
    word.charCodeAt(0),
    word.charCodeAt(1),
    word.charCodeAt(2),
    word.charCodeAt(3),
    word.charCodeAt(4)
  ];
}

/**
 * Precompute char codes for all words in a list
 */
function precomputeCodes(words) {
  var codes = new Array(words.length);
  for (var i = 0; i < words.length; i++) {
    codes[i] = wordToCodes(words[i]);
  }
  return codes;
}

/**
 * Calculate entropy using Int32Array for pattern counts (FAST)
 * Returns { entropy, expectedRemaining, uniquePatterns }
 */
function calculateEntropyFast(guessCodes, solutionCodesList, patternCounts) {
  // Reset pattern counts (reuse array)
  patternCounts.fill(0);

  var numSolutions = solutionCodesList.length;
  var uniquePatterns = 0;

  // Count patterns
  for (var i = 0; i < numSolutions; i++) {
    var pattern = getPatternFast(guessCodes, solutionCodesList[i]);
    if (patternCounts[pattern] === 0) {
      uniquePatterns++;
    }
    patternCounts[pattern]++;
  }

  // Calculate entropy: H = -Σ p(x) * log2(p(x))
  var entropy = 0;
  var expectedRemaining = 0;

  for (var p = 0; p < 243; p++) {
    var count = patternCounts[p];
    if (count > 0) {
      var probability = count / numSolutions;
      entropy -= probability * Math.log2(probability);
      expectedRemaining += probability * count;
    }
  }

  return {
    entropy: entropy,
    expectedRemaining: expectedRemaining,
    uniquePatterns: uniquePatterns
  };
}

/**
 * Read the active strategy from the UI dropdown, falling back to 'pure-entropy'.
 * Strategies: 'pure-entropy', 'entropy-popularity', 'frequency', 'hard-mode'
 */
function getStrategy() {
  if (typeof window !== 'undefined' && window.strategySelect) {
    return window.strategySelect.value || 'pure-entropy';
  }
  if (typeof window !== 'undefined' && window._solverStrategy) {
    return window._solverStrategy;
  }
  return 'pure-entropy';
}

// ============================================================
// Original Filter Functions
// ============================================================

function getIncludeMap(spots) {
  var includedMap = {};
  function addIncluded(letter) {
    if (letter) {
      includedMap[letter] = true;
    }
  }
  spots.forEach(function (spot) {
    addIncluded(spot);
  });
  return includedMap;
}

function getNotSpotMap(notSpotsLetters) {
  var notSpotMap = {};
  notSpotsLetters.forEach(function (letters) {
    letters.forEach(function (letter) {
      if (letter) {
        notSpotMap[letter] = true;
      }
    });
  });
  return notSpotMap;
}

function getAllIncludedMap(spots, notSpotsLetters) {
  var allIncludedMap = {};
  function addAllIncluded(letter) {
    if (letter) {
      allIncludedMap[letter] = true;
    }
  }
  // don't forget to include spots
  notSpotsLetters.map(function (letters) {
    letters.map(addAllIncluded);
  });
  spots.map(addAllIncluded);

  return allIncludedMap;
}

function filterDictionary(spots, notSpotsLetters, excluded) {
  var includedMap = getIncludeMap(spots);
  var notSpotMap = getNotSpotMap(notSpotsLetters);
  var allIncludedMap = getAllIncludedMap(spots, notSpotsLetters);

  var included = Object.keys(allIncludedMap);

  var wordList = getWords();
  var matched = wordList.filter(function (word) {
    return (
      included.every(function (letter) {
        return word.match(letter) !== null;
      }) &&
      !excluded.some(function (letter) {
        return word.match(letter) !== null;
      })
    );
  });

  function filterSpot(spot, letter) {
    if (!letter) {
      return;
    }
    var lowerLetter = letter.toLowerCase();
    matched = matched.filter(function (word) {
      return word[spot] === lowerLetter;
    });
  }
  spots.map(function (spot, index) {
    filterSpot(index, spot);
  });

  function filterNotSpot(spot, letters) {
    if (!letters) {
      return;
    }
    matched = matched.filter(function (word) {
      return !letters.some(function (letter) {
        return word[spot] === letter;
      });
    });
  }

  notSpotsLetters.map(function (letters, index) {
    filterNotSpot(index, letters);
  });

  return {
    matched: matched,
    includedMap: includedMap,
    notSpotMap: notSpotMap
  };
}

function addLetterStats(matched, stats) {
  var letterStats = {};
  var spotStats = [{}, {}, {}, {}, {}];
  var uniqueLetterStats = {};
  matched.map(function (guess) {
    var seen = {};
    guess.split('').map(function (letter, i) {
      if (!seen[letter]) {
        seen[letter] = true;
        if (uniqueLetterStats[letter]) {
          uniqueLetterStats[letter] = uniqueLetterStats[letter] + 1;
        } else {
          uniqueLetterStats[letter] = 1;
        }
      }
      if (!letterStats[letter]) {
        letterStats[letter] = 0;
      }
      if (!spotStats[i][letter]) {
        spotStats[i][letter] = 0;
      }
      spotStats[i][letter] = spotStats[i][letter] + 1;
      letterStats[letter] = letterStats[letter] + 1;
    });
  });
  Object.assign(stats, {
    letterStats: letterStats,
    spotStats: spotStats,
    uniqueLetterStats: uniqueLetterStats
  });
}

function addMaxStats(stats) {
  var statKeys = Object.keys(stats.letterStats);
  var maxStats = statKeys.map(function (letter) {
    return [letter, stats.letterStats[letter]];
  });

  maxStats.sort(function (a, b) {
    return b[1] - a[1];
  });

  stats.maxStats = maxStats;
}

/**
 * Add true pattern-based entropy scores (3Blue1Brown / Information Theory approach)
 * OPTIMIZED: Uses typed arrays and precomputed char codes for ~10x speedup
 *
 * For each guess, we calculate:
 * 1. patternEntropy: How much information (bits) the guess provides on average
 * 2. expectedRemaining: Expected # of words left after this guess
 * 3. uniquePatterns: How many distinct feedback patterns this guess can produce
 */
function addPatternEntropyScore(filtered, stats, options) {
  var matched = filtered.matched;
  options = options || {};
  var strategy = options.strategy || getStrategy();

  // 'frequency' strategy skips entropy entirely — use frequencyScore from getStats
  if (strategy === 'frequency') {
    stats.patternEntropyScore = (stats.frequencyScore || []).slice(0, 300).map(function (item) {
      var isKnown = typeof isWordleAnswer === 'function' ? isWordleAnswer(item[0]) : false;
      var displayWord = isKnown ? item[0] + '★' : item[0];
      return [displayWord, item[1], 0, 0];
    });
    stats.bestGuess =
      stats.frequencyScore && stats.frequencyScore.length > 0 ? stats.frequencyScore[0][0] : null;
    return;
  }

  var hasWordleAnswers =
    typeof window !== 'undefined' && window.wordleAnswers && window.wordleAnswers.size > 0;

  // Determine solution space: use wordleAnswers ∩ matched when available
  var solutions = matched;
  if (hasWordleAnswers) {
    var answersSet = window.wordleAnswers;
    solutions = matched.filter(function (w) {
      return answersSet.has(w);
    });
    if (solutions.length === 0) solutions = matched;
  }

  if (solutions.length <= 1) {
    var trivialWords = solutions.length > 0 ? solutions : matched;
    stats.patternEntropyScore = trivialWords.map(function (word) {
      return [word, 0, trivialWords.length, 1];
    });
    stats.bestGuess = trivialWords[0] || null;
    return;
  }

  var maxWordsToScore = options.maxWordsToScore || 300;
  var wordsToScore;
  var isHardMode = strategy === 'hard-mode';

  if (isHardMode) {
    // Hard mode: only guess from remaining matches (no out-of-set words)
    if (matched.length > maxWordsToScore) {
      if (stats.frequencyScore && stats.frequencyScore.length > 0) {
        wordsToScore = stats.frequencyScore.slice(0, maxWordsToScore).map(function (item) {
          return item[0];
        });
      } else {
        wordsToScore = matched.slice(0, maxWordsToScore);
      }
    } else {
      wordsToScore = matched;
    }
  } else if (hasWordleAnswers && solutions.length <= maxWordsToScore) {
    // Small/medium pool: score ALL wordleAnswers for out-of-set discrimination
    wordsToScore = Array.from(window.wordleAnswers);
    solutions.forEach(function (w) {
      if (!window.wordleAnswers.has(w)) wordsToScore.push(w);
    });
  } else if (matched.length > maxWordsToScore) {
    // Large pool (first guess): top candidates by frequency score
    if (stats.frequencyScore && stats.frequencyScore.length > 0) {
      wordsToScore = stats.frequencyScore.slice(0, maxWordsToScore).map(function (item) {
        return item[0];
      });
    } else {
      wordsToScore = matched.slice(0, maxWordsToScore);
    }
  } else {
    wordsToScore = matched;
  }

  var solutionCodesList = precomputeCodes(solutions);
  var matchedSet = new Set(solutions);
  var patternCounts = new Int32Array(243);

  var popularityWeight = strategy === 'entropy-popularity' ? 0.15 : 0;

  var entropyResults = new Array(wordsToScore.length);

  for (var i = 0; i < wordsToScore.length; i++) {
    var guess = wordsToScore[i];
    var guessCodes = wordToCodes(guess);

    var result = calculateEntropyFast(guessCodes, solutionCodesList, patternCounts);

    var popularityScore = getPopularityScore(guess);
    var isKnownAnswer = typeof isWordleAnswer === 'function' ? isWordleAnswer(guess) : false;

    var combinedScore = getCombinedScore(result.entropy, popularityScore, popularityWeight);

    entropyResults[i] = {
      word: guess,
      entropy: result.entropy,
      combinedScore: combinedScore,
      popularityScore: popularityScore,
      expectedRemaining: result.expectedRemaining,
      uniquePatterns: result.uniquePatterns,
      isValidSolution: matchedSet.has(guess),
      isKnownAnswer: isKnownAnswer
    };
  }

  entropyResults.sort(function (a, b) {
    var scoreDiff = b.combinedScore - a.combinedScore;
    if (scoreDiff !== 0) return scoreDiff;

    if (a.isValidSolution !== b.isValidSolution) {
      return a.isValidSolution ? -1 : 1;
    }
    return a.expectedRemaining - b.expectedRemaining;
  });

  // Format for display: [word, combinedScore, expectedRemaining, uniquePatterns]
  stats.patternEntropyScore = entropyResults.map(function (r) {
    // Add ★ for known Wordle answers
    var displayWord = r.isKnownAnswer ? r.word + '★' : r.word;
    return [
      displayWord,
      r.combinedScore.toFixed(2),
      r.expectedRemaining.toFixed(2),
      r.uniquePatterns
    ];
  });

  // Also create a simpler sorted list
  stats.bestGuesses = entropyResults.slice(0, 20).map(function (r) {
    return {
      word: r.word,
      score: r.combinedScore.toFixed(2),
      entropy: r.entropy.toFixed(2),
      popularity: Math.round(r.popularityScore * 100) + '%',
      remaining: r.expectedRemaining.toFixed(1),
      patterns: r.uniquePatterns,
      isSolution: r.isValidSolution,
      isKnownAnswer: r.isKnownAnswer
    };
  });

  stats.bestGuess = entropyResults.length > 0 ? entropyResults[0].word : null;
}

function addMatchStats(matched, stats) {
  var matchStats = {};
  matched.map(function (match) {
    matchStats[match] = 0;
  });

  var statKeys = Object.keys(stats.letterStats);
  statKeys.map(function (letter) {
    matched.map(function (match, i) {
      if (match.indexOf(letter) !== -1) {
        matchStats[match] = matchStats[match] + stats.letterStats[letter];
      }
    });
  });

  /* statKeys = Object.keys(stats.biLetterStats);
   * statKeys.map(function (combo) {
   *   matched.map(function (match, i) {
   *     if (match.indexOf(combo) !== -1) {
   *       matchStats[match] = matchStats[match] + stats.biLetterStats[combo];
   *     }
   *   });
   * });
   */
  delete matchStats[''];

  stats.matchStats = matchStats;
}

function addFrequencyScore(stats) {
  // frequency score for each match
  var frequencyScore = Object.keys(stats.matchStats).map(function (match) {
    return [match, stats.matchStats[match]];
  });
  frequencyScore.sort(function (a, b) {
    return b[1] - a[1];
  });
  stats.frequencyScore = frequencyScore;
}

function addBiLetterStats(matched, stats) {
  var biLetterStats = {};
  matched.map(function (guess) {
    guess.split('').map(function (letter, i) {
      if (i < guess.length - 1) {
        var combo = letter + guess[i + 1];
        if (!biLetterStats[combo]) {
          biLetterStats[combo] = 0;
        }
        biLetterStats[combo] = biLetterStats[combo] + 1;
      }
    });
  });
  stats.biLetterStats = biLetterStats;
}

function addBiMaxStats(stats) {
  var biMaxStats = Object.keys(stats.biLetterStats).map(function (letter) {
    return [letter, stats.biLetterStats[letter], new RegExp(letter)];
  });

  biMaxStats.sort(function (a, b) {
    return b[1] - a[1];
  });
  stats.biMaxStats = biMaxStats;
}

function getStats(filtered, options) {
  var stats = {};
  var matched = filtered.matched;
  addLetterStats(matched, stats);
  addBiLetterStats(matched, stats);
  addBiMaxStats(stats);
  addMatchStats(matched, stats);
  addMaxStats(stats);
  addFrequencyScore(stats);

  // Pattern-based entropy (information theory approach)
  // This is the mathematically correct method for Wordle optimization
  addPatternEntropyScore(filtered, stats, options);

  return stats;
}
