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

function addEntropyScore(filtered, stats) {
  var matched = filtered.matched;

  var probabilityStats = {};
  var probabilitySpotStats = {};
  matched.map(function (match) {
    probabilityStats[match] = 0;
    probabilitySpotStats[match] = 0;
  });

  var informationStats = {};
  var statKeys = Object.keys(stats.letterStats);
  statKeys.map(function (letter) {
    var probability = stats.letterStats[letter] / matched.length;
    var information = -Math.log2(probability);
    informationStats[letter] = probability * information;
  });

  matched.map(function (match) {
    var letters = match.split('');
    var score = 0;
    var spotScore = 0;
    var scoreMap = {};
    letters.map(function (letter, index) {
      if (!scoreMap[letter]) {
        scoreMap[letter] = informationStats[letter];
      }
    });
    Object.keys(scoreMap).map(function (letter, index) {
      var probability = stats.spotStats[index][letter] / matched.length;
      var information = -Math.log2(probability);

      score = score + scoreMap[letter];
      spotScore = spotScore + probability * information;
    });
    probabilityStats[match] = score;
    probabilitySpotStats[match] = spotScore;
  });

  var entropyScore = matched.map(function (match) {
    return [match, probabilityStats[match].toFixed(4)];
  });
  entropyScore.sort(function (a, b) {
    return b[1] - a[1];
  });

  stats.entropyScore = entropyScore;

  var spotEntropyScore = matched.map(function (match) {
    return [match, probabilitySpotStats[match].toFixed(4)];
  });
  spotEntropyScore.sort(function (a, b) {
    return b[1] - a[1];
  });
  stats.spotEntropyScore = spotEntropyScore;

  var combinedEntropyScore = matched.map(function (match) {
    return [match, (probabilityStats[match] + probabilitySpotStats[match]).toFixed(4)];
  });
  combinedEntropyScore.sort(function (a, b) {
    return b[1] - a[1];
  });
  stats.combinedEntropyScore = combinedEntropyScore;
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

function getStats(filtered) {
  var stats = {};
  var matched = filtered.matched;
  addLetterStats(matched, stats);
  addBiLetterStats(matched, stats);
  addBiMaxStats(stats);
  addMatchStats(matched, stats);
  addMaxStats(stats);
  addEntropyScore(filtered, stats);
  addFrequencyScore(stats);

  return stats;
}
