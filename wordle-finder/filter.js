function getIncludeMap(spots) {
  var includedMap = {};
  function addIncluded(letter) {
    if (letter) {
      includedMap[letter] = true;
    }
  }
  spots.forEach(function(spot) { addIncluded(spot); });
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

function getLetterStats(matched) {
  var letterStats = {};
  matched.map(function (guess) {
    guess.split('').map(function (letter, i) {
      if (!letterStats[letter]) {
        letterStats[letter] = 0;
      }
      letterStats[letter] = letterStats[letter] + 1;

    });
  });
  return letterStats;
}

function getEntropyScore(filtered, stats) {
  var matched = filtered.matched;

  var probabilities = {};
  var informationStats = {};
  var statKeys = Object.keys(stats.letterStats);
  statKeys.map(function(letter) {
    var probability = stats.letterStats[letter] / matched.length;
    probabilities[letter] = probability;
    var information = Math.log2(1/probability);
    informationStats[letter] = probability * information;
  });

  var probabilityStats = {}
  matched.map(function (match) {
    probabilityStats[match] = 0;
  });

  matched.map(function(match) {
    var letters = match.split('');
    var score = 0;
    var scoreMap = {};
    letters.map(function(letter) {
      if (!scoreMap[letter]) {
        scoreMap[letter] = informationStats[letter];
      }
    });
    Object.keys(scoreMap).map(function(letter) {
      score = score + scoreMap[letter];
    });
    probabilityStats[match] = score;
  });

  var entropyScore = matched.map(function (match) {
    return [match, probabilityStats[match].toFixed(4)];
  });
  entropyScore.sort(function (a, b) {
    return b[1] - a[1];
  });

  return entropyScore;
}

function getMaxStats(stats) {
  var statKeys = Object.keys(stats.letterStats);
  var maxStats = statKeys.map(function (letter) {
    return [letter, stats.letterStats[letter]];
  });

  maxStats.sort(function (a, b) {
    return b[1] - a[1];
  });

  return maxStats;
}

function getMatchStats(matched, stats) {
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

  return matchStats;
}

function getFrequencyScore(stats) {
  // frequency score for each match
  var frequencyScore = Object.keys(stats.matchStats).map(function (match) {
    return [match, stats.matchStats[match]];
  });
  frequencyScore.sort(function (a, b) {
    return b[1] - a[1];
  });
  return frequencyScore;
}

function getBiLetterStats(matched) {
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
  return biLetterStats;
}

function getBiMaxStats(stats) {
  var biMaxStats = Object.keys(stats.biLetterStats).map(function (letter) {
    return [letter, stats.biLetterStats[letter], new RegExp(letter)];
  });

  biMaxStats.sort(function (a, b) {
    return b[1] - a[1];
  });
  return biMaxStats;
}

function getStats(filtered) {
  var matched = filtered.matched;
  var letterStats = getLetterStats(matched);
  var biLetterStats = getBiLetterStats(matched);
  var stats = {
    letterStats: letterStats,
    biLetterStats: biLetterStats,
  }
  stats.matchStats = getMatchStats(matched, stats);

  return stats;
}
