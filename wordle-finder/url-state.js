/**
 * Shareable URL state for wordle-finder.
 *
 * Query params, all optional:
 *   mode=score|play|wordle   (aliases: solve/solver -> score, helper -> play,
 *                             game -> wordle)
 *   word=random|today        (alias: nyt -> today; Play Wordle only)
 *   date=YYYY-MM-DD          (NYT puzzle date; implies mode=wordle&word=today
 *                             when those params are absent)
 *   strategy=pure-entropy|entropy-popularity|frequency
 *
 * Pure string <-> state translation only; index.js owns the DOM. Date bounds
 * come from nyt-wordle.js, which owns puzzle-date semantics.
 */
(function () {
  var MODE_ALIASES = {
    score: 'score',
    solve: 'score',
    solver: 'score',
    play: 'play',
    helper: 'play',
    wordle: 'wordle',
    game: 'wordle'
  };
  var WORD_ALIASES = {
    random: 'random',
    today: 'today',
    nyt: 'today'
  };
  var STRATEGIES = {
    'pure-entropy': 1,
    'entropy-popularity': 1,
    frequency: 1
  };
  var DEFAULT_MODE = 'score';
  var DEFAULT_WORD = 'random';
  var DEFAULT_STRATEGY = 'pure-entropy';

  function todayString() {
    var nyt = window.wordleNyt;
    return nyt && typeof nyt.formatLocalDate === 'function' ? nyt.formatLocalDate(new Date()) : '';
  }

  /** Valid, in-range puzzle date, or null when the param is absent/garbage. */
  function normalizeDate(raw, today) {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    var nyt = window.wordleNyt;
    if (!nyt || typeof nyt.clampWordleDate !== 'function') return null;
    return nyt.clampWordleDate(raw, today || todayString());
  }

  /**
   * @param {string} search location.search (leading `?` optional)
   * @param {string} [today] YYYY-MM-DD override, for tests
   * @returns {{mode: string, word: string, date: (string|null), strategy: string}}
   */
  function parse(search, today) {
    var params = new URLSearchParams(search || '');
    var date = normalizeDate(params.get('date'), today);

    var mode = MODE_ALIASES[String(params.get('mode') || '').toLowerCase()];
    if (!mode) mode = date ? 'wordle' : DEFAULT_MODE;

    var word = WORD_ALIASES[String(params.get('word') || '').toLowerCase()];
    if (!word) word = date ? 'today' : DEFAULT_WORD;

    var strategy = String(params.get('strategy') || '').toLowerCase();
    if (!STRATEGIES[strategy]) strategy = DEFAULT_STRATEGY;

    return { mode: mode, word: word, date: date, strategy: strategy };
  }

  /**
   * Canonical query string for the current selections, without a leading `?`.
   * Defaults and controls the current mode hides are omitted so links stay
   * short — notably `date`, which is dropped when it is today so a shared
   * link keeps meaning "today's puzzle" tomorrow.
   *
   * @param {{mode: string, word: string, date: string, strategy: string}} state
   * @param {string} [today] YYYY-MM-DD override, for tests
   * @returns {string}
   */
  function toSearch(state, today) {
    var params = new URLSearchParams();
    var mode = MODE_ALIASES[String((state && state.mode) || '').toLowerCase()] || DEFAULT_MODE;
    if (mode !== DEFAULT_MODE) params.set('mode', mode);

    if (mode === 'wordle') {
      var word = WORD_ALIASES[String((state && state.word) || '').toLowerCase()] || DEFAULT_WORD;
      if (word !== DEFAULT_WORD) params.set('word', word);
      if (word === 'today') {
        var date = normalizeDate(state && state.date, today);
        if (date && date !== (today || todayString())) params.set('date', date);
      }
    } else {
      var strategy = String((state && state.strategy) || '').toLowerCase();
      if (STRATEGIES[strategy] && strategy !== DEFAULT_STRATEGY) params.set('strategy', strategy);
    }

    return params.toString();
  }

  window.wordleUrlState = {
    parse: parse,
    toSearch: toSearch
  };
})();
