function analytics() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function() {
    dataLayer.push(arguments);
  }
  gtag('js', new Date());

  gtag('config', 'G-Q62Q3E20Y0');
}
if (location.hostname !== 'localhost') {
  analytics();
} else {
  window.gtag = function() {}
}

var res = fetch('words');
var words;
function isIsogram(str) {
  return !/(.).*\1/.test(str);
}

randomWordButton.onclick = function () {
  var word;
  var item;
  do {
    item = Math.floor(Math.random() * words.length);
    word = words[item];
  } while (!isIsogram(word));
  randomWord.textContent = word;
  gtag('event', 'generate_random_word', {
    event_category: 'user action',
  });
};

function guess(event) {
  event.preventDefault();
  var spots = [first, second, third, fourth, fifth];
  var includedMap = {};
  function addIncluded(letter) {
    if (letter) {
      includedMap[letter] = true;
    }
  }

  var spotLetters = spots.map(function (spot) {
    var letter = spot.value[0] && spot.value[0].toLowerCase();
    addIncluded(letter);
    return letter;
  });
  var notSpots = [notfirst, notsecond, notthird, notfourth, notfifth];
  var notSpotMap = {};
  var notSpotLetters = notSpots.map(function (spot) {
    var value = (spot.value && spot.value.toLowerCase()) || '';
    var letters = value.split('');
    letters.map(function (letter) {
      if (letter) {
        notSpotMap[letter] = true;
      }
    });
    return letters;
  });
  var notSpotKeys = Object.keys(notSpotMap);

  var allIncludedMap = {};
  function addAllIncluded(letter) {
    if (letter) {
      allIncludedMap[letter] = true;
    }
  }
  var includeLettersSplit = includeLetters.value.toLowerCase().split('');
  includeLettersSplit.map(addAllIncluded);
  includeLettersSplit.map(addIncluded);
  // don't forget to include spots
  notSpotLetters.map(function (letters) {
    letters.map(addAllIncluded);
  });
  spotLetters.map(addAllIncluded);
  var included = Object.keys(allIncludedMap);

  var excluded = excludeLetters.value.toLowerCase().split('');
  var matched = words.filter(function (word) {
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
  spotLetters.map(function (spot, index) {
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

  notSpotLetters.map(function (letters, index) {
    filterNotSpot(index, letters);
  });

  var letterStats = {};
  var biLetterStats = {};
  matched.map(function (guess) {
    guess.split('').map(function (letter, i) {
      if (!letterStats[letter]) {
        letterStats[letter] = 0;
      }
      letterStats[letter] = letterStats[letter] + 1;

      if (i < guess.length - 1) {
        var combo = letter + guess[i + 1];
        if (!biLetterStats[combo]) {
          biLetterStats[combo] = 0;
        }
        biLetterStats[combo] = biLetterStats[combo] + 1;
      }
    });
  });

  var probabilities = {};
  var informationStats = {};
  var statKeys = Object.keys(letterStats);
  statKeys.map(function(letter) {
    var probability = letterStats[letter] / matched.length;
    probabilities[letter] = probability;
    var information = Math.log2(1/probability);
    informationStats[letter] = probability * information;
  });

  // frequency score for each match
  var matchStats = {};
  var probabilityStats = {}
  matched.map(function (match) {
    matchStats[match] = 0;
    probabilityStats[match] = 0;
  });

  maxStats = statKeys.map(function (letter) {
    matched.map(function (match) {
      if (match.indexOf(letter) !== -1) {
        matchStats[match] = matchStats[match] + letterStats[letter];
      }
    });
    return [letter, letterStats[letter]];
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

  maxStats.sort(function (a, b) {
    return b[1] - a[1];
  });

  var biMaxStats = Object.keys(biLetterStats).map(function (letter) {
    matched.map(function (match) {
      if (match.indexOf(letter) !== -1) {
        matchStats[match] = matchStats[match] + biLetterStats[letter];
      }
    });

    return [letter, biLetterStats[letter], new RegExp(letter)];
  });

  biMaxStats.sort(function (a, b) {
    return b[1] - a[1];
  });

  delete matchStats[''];

  var scores = Object.keys(matchStats).map(function (match) {
    return [match, matchStats[match]];
  });
  scores.sort(function (a, b) {
    return b[1] - a[1];
  });

  var joinedScores = scores
    .map(function (score, i) {
      return score[0] + ':&nbsp;' + score[1];
    })
    .join('\r\n');
  var scoreContent =
    '\r\n<h3>Top Words by Frequency Score</h3>\r\n<pre class="score">' +
    joinedScores +
    '</pre>';

  var probabilityScores = matched.map(function (match) {
    return [match, probabilityStats[match].toFixed(4)];
  });
  probabilityScores.sort(function (a, b) {
    return b[1] - a[1];
  });

  var joinedProbScores = probabilityScores
    .map(function (score, i) {
      return score[0] + ':&nbsp;' + score[1];
    })
    .join('\r\n');
  var probabilityScoreContent = [
    '\r\n',
    '<h3>Top Words by Probability Score</h3>' +
    '<p>A weight is generated for each letter in a word.<br />' +
    'The probabilty of the letter is multiplied by the likelyhood the letter will eliminate words in the set of possible words.<br />' +
    'Each word adds up their letter weights.  Double letters don\'t add to the weight</p>\r\n' +
    '<pre class="score">',
    joinedProbScores,
    '</pre>'
  ].join('');

  statContent = '';
  maxStats.map(function (stat) {
    var letter = stat[0];
    var count = stat[1];
    var letterContent = letter;
    var letterClass = 'stat-letter stat-letter-block';
    if (includedMap[letter]) {
      letterClass = letterClass + ' included-stat';
    } else if (notSpotMap[letter]) {
      letterClass = letterClass + ' included-stat-wrong-spot';
    }
    statContent =
      statContent +
      '<span class="' +
      letterClass +
      '">' +
      letterContent +
      '</span>&nbsp;' +
      count +
      '\n';
  });

  comboStatContent = '';
  if (biMaxStats.length > 0) {
    comboStatContent = comboStatContent + '\n';
    biMaxStats.map(function (stat) {
      var combo = stat[0];
      var count = stat[1];
      comboStatContent =
        comboStatContent +
        '<span class="stat-letter">' +
        combo +
        '</span>:&nbsp;' +
        count +
        '\n';
    });
  }

  var emptyMatch =
    '<p>No matches found.<br /><br />Please refine your matches and try again.</p>';
  var matchData =
    matched.length > 0 ? '<pre>' + matched.join('\r\n') + '</pre>' : emptyMatch;
  window['tabpanel-matches'].innerHTML = matchData;

  var comboData = '<pre>' + comboStatContent + '</pre>';

  var countContent = [
    '<h3>Letter Counts</h3><pre>',
    statContent,
    '</pre>',
    '<h3>Combo Counts</h3>',
    comboData
  ].join('');
  var statData =
    matched.length > 0
                   ? countContent
                   : emptyMatch;
  window['tabpanel-counts'].innerHTML = statData;

  window['tabpanel-score'].innerHTML = scoreContent;

  var probabilityData =
    matched.length > 0 ? probabilityScoreContent : emptyMatch;
  window['tabpanel-probs'].innerHTML = probabilityData;
  results.removeAttribute('hidden');
  gtag('event', 'submit', {
    event_category: 'user action',
  });

  return false;
}

reset.onclick = function () {
  includeLetters.value = '';
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
  results.setAttribute('hidden', '');
  gtag('event', 'reset', {
    event_category: 'user action',
  });
};

function changeTabs(e) {
  var target = e.target;
  var parent = target.parentNode;
  var grandparent = parent.parentNode;

  // Remove all current selected tabs
  parent.querySelectorAll('[aria-selected="true"]').forEach(function (t) {
    return t.setAttribute('aria-selected', false);
  });

  // Set this tab as selected
  target.setAttribute('aria-selected', true);

  // Hide all tab panels
  grandparent.querySelectorAll('[role="tabpanel"]').forEach(function (p) {
    return p.setAttribute('hidden', true);
  });

  // Show the selected panel
  var panel = grandparent.parentNode
    .querySelector('#' + target.getAttribute('aria-controls'));
  panel.removeAttribute('hidden');
  panel.parentNode.scrollTop = 0;
}

window.onload = function () {
  res
    .then(function (a) {
      return a.text();
    })
    .then(function (b) {
      words = b.trim().split('\n');
      window.words = words;
    });

  guessForm.onsubmit = guess;
  submit.onclick = guess;
  helpIcon.onclick = function helpClick() {
    dialog.style.display = '';
    gtag('event', 'help_click', {
      event_category: 'user action',
    });
  };

  var tabs = document.querySelectorAll('[role="tab"]');
  var tabList = document.querySelector('[role="tablist"]');

  // Add a click event handler to each tab
  tabs.forEach(function (tab) {
    tab.addEventListener('click', changeTabs);
  });
};
