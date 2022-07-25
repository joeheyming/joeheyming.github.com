var emptyMatch = '<p>No matches found.<br /><br />Please refine your matches and try again.</p>';

function renderFrequencyScoreTab(stats) {
  var frequencyScore = stats.frequencyScore;

  var joinedScores = frequencyScore
    .map(function (score, i) {
      return score[0] + ':&nbsp;' + score[1];
    })
    .join('\r\n');
  var scoreContent = [
    '<h3>Top Words by Frequency Score</h3>',
    '<p>Letters are counted over all the matched words.<br />',
    'Then each word gets a score based on adding the counts per letter.<br />',
    '<pre class="score">',
    joinedScores,
    '</pre>'
  ].join('');
  updateTabContent('tabpanel-score', frequencyScore.length > 0 ? scoreContent : emptyMatch);
}

function renderEntropyScore(filtered, stats) {
  var joinedProbScores = stats.entropyScore
    .map(function (score, i) {
      return score[0] + ':&nbsp;' + score[1];
    })
    .join('\r\n');
  var probabilityScoreContent = [
    '<h3>Top Words by Probability Score</h3>',
    '<p>A weight is generated for each letter in a word.<br />',
    'The probability of the letter is multiplied by the likelihood the letter will eliminate words in the set of possible words.<br />',
    "Each word adds up their letter weights.  Double letters don't add to the weight</p>",
    '<pre class="score">',
    joinedProbScores,
    '</pre>'
  ].join('');
  var probabilityData = stats.entropyScore.length > 0 ? probabilityScoreContent : emptyMatch;
  updateTabContent('tabpanel-probs', probabilityData);
}

function renderMatches(filtered) {
  var matched = filtered.matched;
  var matchData = matched.length > 0 ? '<pre>' + matched.join('\r\n') + '</pre>' : emptyMatch;
  updateTabContent('tabpanel-matches', matchData);
}

function renderCombos(filtered, stats) {
  var includedMap = filtered.includedMap;
  var notSpotMap = filtered.notSpotMap;

  var statContent = '';
  stats.maxStats.map(function (stat) {
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
  if (stats.biMaxStats.length > 0) {
    comboStatContent = comboStatContent + '\n';
    stats.biMaxStats.map(function (stat) {
      var combo = stat[0];
      var count = stat[1];
      comboStatContent =
        comboStatContent + '<span class="stat-letter">' + combo + '</span>:&nbsp;' + count + '\n';
    });
  }

  var comboData = '<pre>' + comboStatContent + '</pre>';

  var countContent = [
    '<h3>Letter Counts</h3><pre>',
    statContent,
    '</pre>',
    '<h3>Combo Counts</h3>',
    comboData
  ].join('');
  var statData = stats.maxStats.length > 0 ? countContent : emptyMatch;
  updateTabContent('tabpanel-counts', statData);
}

function renderMatchCount(filtered) {
  window['match-count'].innerHTML = `Matches: <strong>${filtered.matched.length}</strong>`;
  window['match-count'].removeAttribute('hidden');
}
