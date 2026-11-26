// Cross-console name search for the emulator hub. Loaded when the picker
// is on screen, not with the console landers. Column B of the games sheet
// is the name; the query is capped so the whole catalog stays on the server.
(function () {
  'use strict';

  /**
   * @param {unknown} term
   * @returns {string}
   */
  function searchSql(term) {
    const sheet = window.emulatorGamesSheet;
    const escape = sheet && sheet.escapeSqlValue ? sheet.escapeSqlValue : (value) => String(value);
    const q = String(term == null ? '' : term)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
    if (q.length < 2) return '';
    return `select * where lower(B) contains '${escape(q)}' limit 40`;
  }

  /**
   * @param {unknown} term
   * @returns {Promise<object[]>}
   */
  function searchGames(term) {
    const sheet = window.emulatorGamesSheet;
    const sql = searchSql(term);
    if (!sql) return Promise.resolve([]);
    if (!sheet || typeof sheet.query !== 'function') {
      return Promise.reject(new Error('games sheet is not configured'));
    }
    return sheet.query(sql).then((rows) => {
      /** @type {object[]} */
      const games = [];
      for (const row of rows) {
        const game = sheet.gameFromRow(row);
        if (game) games.push(game);
      }
      return games.slice(0, 40);
    });
  }

  /**
   * @param {Array<{ console?: string }>} games
   */
  function groupByConsole(games) {
    /** @type {Array<{ console: string, games: object[] }>} */
    const groups = [];
    /** @type {Map<string, { console: string, games: object[] }>} */
    const index = new Map();
    for (const game of games || []) {
      const id = String(game && game.console ? game.console : '').trim();
      if (!id) continue;
      let group = index.get(id);
      if (!group) {
        group = { console: id, games: [] };
        index.set(id, group);
        groups.push(group);
      }
      group.games.push(game);
    }
    return groups;
  }

  /**
   * @param {unknown} consoleId
   * @param {unknown} name
   * @returns {string}
   */
  function finderHref(consoleId, name) {
    const id = String(consoleId == null ? '' : consoleId).trim();
    const rom = String(name == null ? '' : name).trim();
    if (!id || !rom) return '';
    return `/emulator/${encodeURIComponent(id)}/?rom=${encodeURIComponent(rom)}`;
  }

  /**
   * @param {string} value
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {HTMLElement} results
   * @param {object[]} games
   * @param {string} queryText
   */
  function paint(results, games, queryText) {
    const q = String(queryText || '').trim();
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }
    if (!games || !games.length) {
      results.innerHTML = '<p class="game-finder-status">No games match.</p>';
      return;
    }
    const consoles = window.EMULATOR_CONSOLES || {};
    results.innerHTML = groupByConsole(games)
      .map((group) => {
        const cfg = consoles[group.console];
        const title = cfg ? cfg.title : group.console;
        const items = group.games
          .map((game) => {
            const href = finderHref(group.console, game.name || game.title);
            if (!href) return '';
            return `<li><a href="${escapeHtml(href)}">${escapeHtml(
              game.title || game.name
            )}</a></li>`;
          })
          .join('');
        return `<section class="game-finder-group"><h3>${escapeHtml(
          title
        )}</h3><ul>${items}</ul></section>`;
      })
      .join('');
  }

  /**
   * Paint matches for `queryText` into `results`. The hub calls this after
   * the visitor types, so the script stays off the first paint.
   * @param {HTMLElement} results
   * @param {string} queryText
   */
  function searchInto(results, queryText) {
    const q = String(queryText || '');
    if (q.trim().length < 2) {
      results.replaceChildren();
      return Promise.resolve();
    }
    results.innerHTML = '<p class="game-finder-status">Searching…</p>';
    const sheet = window.emulatorGamesSheet;
    const ready = sheet
      ? Promise.resolve(sheet)
      : import('/shared/lazy.js')
          .then((lazy) => lazy.loadScript('/emulator/games-sheet.js'))
          .then(() => window.emulatorGamesSheet);
    return ready
      .then(() => searchGames(q))
      .then((games) => {
        paint(results, games || [], q);
      });
  }

  /**
   * @param {ParentNode} slot
   */
  function mount(slot) {
    if (!slot || slot.querySelector('#game-finder')) return;
    slot.innerHTML = `
      <form class="game-finder" id="game-finder" role="search">
        <label class="game-finder-label" for="game-finder-input">Find a game</label>
        <input
          id="game-finder-input"
          class="game-finder-input"
          type="search"
          placeholder="Mario, Tetris, Sonic…"
          autocomplete="off"
          enterkeyhint="search"
        />
        <div id="game-finder-results" class="game-finder-results" aria-live="polite"></div>
      </form>
    `;
    const form = slot.querySelector('#game-finder');
    const input = /** @type {HTMLInputElement | null} */ (slot.querySelector('#game-finder-input'));
    const results = /** @type {HTMLElement | null} */ (slot.querySelector('#game-finder-results'));
    if (!form || !input || !results) return;
    let timer = 0;
    let token = 0;
    const run = () => {
      const q = input.value;
      const mine = ++token;
      if (q.trim().length < 2) {
        results.replaceChildren();
        return;
      }
      results.innerHTML = '<p class="game-finder-status">Searching…</p>';
      const sheet = window.emulatorGamesSheet;
      const ready = sheet
        ? Promise.resolve(sheet)
        : import('/shared/lazy.js')
            .then((lazy) => lazy.loadScript('/emulator/games-sheet.js'))
            .then(() => window.emulatorGamesSheet);
      ready
        .then(() => {
          if (mine !== token) return [];
          return searchGames(q);
        })
        .then((games) => {
          if (mine !== token) return;
          paint(results, games || [], input.value);
        })
        .catch(() => {
          if (mine !== token) return;
          results.innerHTML =
            '<p class="game-finder-status">The library did not load. Try again.</p>';
        });
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      if (input.value.trim().length < 2) {
        token += 1;
        results.replaceChildren();
        return;
      }
      timer = setTimeout(run, 300);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearTimeout(timer);
      run();
    });
  }

  window.emulatorGameFinder = {
    searchSql,
    searchGames,
    groupByConsole,
    finderHref,
    searchInto,
    showResults: paint,
    mount
  };
})();
