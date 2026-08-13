/**
 * Today's Wordle via NYT's public puzzle JSON + /proxy.js.
 *
 * Used by Play Wordle mode when Word = "Today's Wordle". Fetches
 * https://www.nytimes.com/svc/wordle/v2/YYYY-MM-DD.json through
 * window.proxyService.fetchJson (CORS). Does not spoil the answer in the UI —
 * it only seeds the in-browser play clone.
 */
(function () {
  var CACHE_PREFIX = 'heyming.wordle.wotd.';
  var NYT_BASE = 'https://www.nytimes.com/svc/wordle/v2/';

  function nytDateString() {
    // NYT Wordle in the browser uses the player's local calendar date, not
    // a fixed Eastern rollover. At 11pm PT that is still "yesterday" in NY,
    // and players expect the same puzzle as nytimes.com/games/wordle.
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function readCache(dateStr) {
    try {
      var raw = sessionStorage.getItem(CACHE_PREFIX + dateStr);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed.solution === 'string' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(dateStr, data) {
    try {
      sessionStorage.setItem(
        CACHE_PREFIX + dateStr,
        JSON.stringify({
          solution: data.solution,
          id: data.id,
          days_since_launch: data.days_since_launch,
          print_date: data.print_date
        })
      );
    } catch (_) {
      /* private mode / quota */
    }
  }

  async function fetchTodaysPuzzle() {
    var dateStr = nytDateString();
    var cached = readCache(dateStr);
    if (cached) return cached;

    if (!window.proxyService || typeof window.proxyService.fetchJson !== 'function') {
      throw new Error('Proxy unavailable');
    }

    var data = await window.proxyService.fetchJson(NYT_BASE + dateStr + '.json', {
      skipDirect: true,
      friendlyError: "Couldn't read today's Wordle from the New York Times."
    });

    if (!data || typeof data.solution !== 'string' || data.solution.length !== 5) {
      throw new Error('Unexpected Wordle response');
    }

    writeCache(dateStr, data);
    return data;
  }

  function selectedSource() {
    var sel = document.getElementById('wordleSource');
    return sel && sel.value === 'today' ? 'today' : 'random';
  }

  function setStatusMessage(text) {
    var statusEl = document.querySelector('#wordle-game .wg-status');
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'wg-status';
  }

  /**
   * Start (or restart) Play Wordle using the Word dropdown selection.
   * @returns {Promise<void>}
   */
  window.startWordleFromSource = async function startWordleFromSource() {
    if (typeof window.startWordleGame !== 'function') return;

    if (selectedSource() !== 'today') {
      window.startWordleGame();
      return;
    }

    setStatusMessage("Loading today's puzzle…");
    try {
      var data = await fetchTodaysPuzzle();
      var word = String(data.solution).toLowerCase();
      currentAnswer = word;
      window.startWordleGame(word);
      setStatusMessage("Today's Wordle");
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('wordle_play_today', 'Wordle', data.print_date || nytDateString());
      }
    } catch (err) {
      console.warn('[wordle] WOTD fetch failed', err);
      setStatusMessage("Couldn't load today's puzzle — using random");
      window.startWordleGame();
    }
  };

  window.fetchTodaysWordle = fetchTodaysPuzzle;
})();
