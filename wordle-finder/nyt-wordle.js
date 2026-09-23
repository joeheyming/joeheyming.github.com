/**
 * Official Wordle via NYT's public puzzle JSON + /proxy.js.
 *
 * Used by Play Wordle mode when Word = "NYT Wordle". Fetches
 * https://www.nytimes.com/svc/wordle/v2/YYYY-MM-DD.json through
 * window.proxyService.fetchJson (CORS). Does not spoil the answer in the UI —
 * it only seeds the in-browser play clone.
 */
(function () {
  var CACHE_PREFIX = 'heyming.wordle.wotd.';
  var NYT_BASE = 'https://www.nytimes.com/svc/wordle/v2/';
  var WORDLE_LAUNCH = '2021-06-19';

  function formatLocalDate(d) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function clampWordleDate(dateStr, todayStr) {
    var today = todayStr || formatLocalDate(new Date());
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return today;
    }
    if (dateStr < WORDLE_LAUNCH) return WORDLE_LAUNCH;
    if (dateStr > today) return today;
    return dateStr;
  }

  function parseLocalDate(dateStr) {
    var parts = String(dateStr).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function statusLabelForDate(dateStr) {
    var today = formatLocalDate(new Date());
    if (dateStr === today) return "Today's Wordle";
    var d = parseLocalDate(dateStr);
    return (
      'Wordle — ' +
      d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    );
  }

  function syncDateInputBounds() {
    var input = document.getElementById('wordleDate');
    if (!input) return formatLocalDate(new Date());
    var today = formatLocalDate(new Date());
    input.min = WORDLE_LAUNCH;
    input.max = today;
    input.value = clampWordleDate(input.value, today);
    return input.value;
  }

  function selectedPuzzleDate() {
    var input = document.getElementById('wordleDate');
    var today = formatLocalDate(new Date());
    var raw = input && input.value ? input.value : today;
    return clampWordleDate(raw, today);
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

  async function fetchPuzzleForDate(dateStr) {
    var cached = readCache(dateStr);
    if (cached) return cached;

    if (!window.proxyService || typeof window.proxyService.fetchJson !== 'function') {
      throw new Error('Proxy unavailable');
    }

    var data = await window.proxyService.fetchJson(NYT_BASE + dateStr + '.json', {
      skipDirect: true,
      friendlyError: "Couldn't read that day's Wordle from the New York Times."
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

    var dateStr = syncDateInputBounds();
    var loading =
      dateStr === formatLocalDate(new Date())
        ? "Loading today's puzzle…"
        : 'Loading Wordle for ' + dateStr + '…';

    // Reset immediately so changing Word / date never leaves prior guesses up.
    if (typeof window.clearWordleBoard === 'function') {
      window.clearWordleBoard(loading);
    } else {
      setStatusMessage(loading);
    }
    try {
      var data = await fetchPuzzleForDate(dateStr);
      var word = String(data.solution).toLowerCase();
      window.startWordleGame(word);
      setStatusMessage(statusLabelForDate(dateStr));
    } catch (err) {
      console.warn('[wordle] WOTD fetch failed', err);
      setStatusMessage("Couldn't load that puzzle — using random");
      window.startWordleGame();
    }
  };

  window.fetchTodaysWordle = function fetchTodaysWordle() {
    return fetchPuzzleForDate(formatLocalDate(new Date()));
  };
  window.wordleNyt = {
    WORDLE_LAUNCH: WORDLE_LAUNCH,
    formatLocalDate: formatLocalDate,
    clampWordleDate: clampWordleDate,
    statusLabelForDate: statusLabelForDate,
    syncDateInputBounds: syncDateInputBounds
  };
})();
