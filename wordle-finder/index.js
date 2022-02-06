function analytics() {
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  gtag('js', new Date());

  gtag('config', 'G-Q62Q3E20Y0');
}
function gtag() {}
if (location.hostname !== 'localhost') {
  analytics();
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
  var spotLetters = spots.map(function (spot) {
    var letter = spot.value[0] && spot.value[0].toLowerCase();
    if (letter) {
      includedMap[letter] = true;
    }
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
  function addIncluded(letter) {
    if (letter) {
      allIncludedMap[letter] = true;
    }
  }

  includeLetters.value.split('').map(addIncluded);
  // don't forget to include spots
  notSpotLetters.map(function (letters) {
    letters.map(addIncluded);
  });
  spotLetters.map(addIncluded);
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

  var matchStats = {};
  matched.map(function (match) {
    matchStats[match] = 0;
  });

  maxStats = Object.keys(letterStats).map(function (letter) {
    matched.map(function (match) {
      if (match.indexOf(letter) !== -1) {
        matchStats[match] = matchStats[match] + letterStats[letter];
      }
    });
    return [letter, letterStats[letter]];
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
  var scoreContent =
    '\r\n<h3>Top Words by Frequency Score</h3>\r\n<pre class="score">' +
    scores
      .map(function (score, i) {
        return score[0] + ':&nbsp;' + score[1];
      })
      .join('\r\n') +
    '</pre>';

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
  var statData =
    matched.length > 0
      ? '<h3>Letter Counts</h3><pre>' + statContent + '</pre>' + scoreContent
      : emptyMatch;
  window['tabpanel-single'].innerHTML = statData;
  var comboData =
    matched.length > 0 ? '<pre>' + comboStatContent + '</pre>' : emptyMatch;
  window['tabpanel-combo'].innerHTML = comboData;
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
  grandparent.parentNode
    .querySelector('#' + target.getAttribute('aria-controls'))
    .removeAttribute('hidden');
}

window.onload = function () {
  res
    .then(function (a) {
      return a.text();
    })
    .then(function (b) {
      window.words = b.split('\n');
      words = window.words;
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
