/**
 * Strum-bar action popovers — "+" (add by name) and "↧" (load song).
 *
 * Both popovers anchor to the strum-bar header buttons and are mutually
 * exclusive: opening one closes the other so the two never overlap
 * visually. They also share the same click-outside-to-dismiss treatment
 * (one listener each — kept separate so a click on the "+" button
 * doesn't accidentally re-toggle the load popover, and vice versa).
 *
 * "+"   popover: prefix-search autocomplete over the 84 displayable
 *               chord names (12 roots × 7 qualities), plus a parsed-
 *               name fast path so power users can type "em ↵ a ↵ d ↵"
 *               without clicking suggestions.
 * "🔍" popover: typing a query runs a debounced search against
 *               e-chords' /api/search (live results, click-to-load).
 *               Replaces the strum bar with the song's chord palette
 *               (pinChordToBar in song order) and surfaces a
 *               clickable link back to the source page in the bar
 *               header so the player can pop the original lyrics /
 *               structure / capo notes.
 */
import {
  ROOTS,
  QUALITIES,
  formatChordName,
  parseChordName,
} from './chords.js';
import {
  fetchEchordsSong,
  searchEchords,
} from './echords-source.js';

/**
 * @param {object} deps
 * @param {HTMLElement} deps.strumPopoverEl       "+" popover container.
 * @param {HTMLButtonElement} deps.strumAddBtn    "+" toggle button.
 * @param {HTMLInputElement} deps.strumInputEl    "+" chord-name input.
 * @param {HTMLElement} deps.strumSuggestionsEl   "+" suggestions list.
 * @param {HTMLElement} deps.strumLoadPopoverEl   "↧" popover container.
 * @param {HTMLButtonElement} deps.strumLoadBtn   "↧" toggle button.
 * @param {HTMLInputElement} deps.strumLoadInputEl  "↧" search / URL input.
 * @param {HTMLElement} deps.strumLoadResultsEl   "↧" search-results list.
 * @param {HTMLElement} deps.strumLoadStatusEl    "↧" status line.
 * @param {{ rootPc: number, qualityId: string }[]} deps.strumBar  Shared bar array (mutated).
 * @param {(rootPc: number, qualityId: string, voicingIdx?: number) => void} deps.pinChordToBar
 * @param {(rootPc: number, qualityId: string, voicingIdx?: number) => void} deps.playChordAtPad
 * @param {(t: null | {rootPc: number, qualityId: string}) => void} deps.setEditTarget
 * @param {(song: null | {url: string, title: string, artist: string}) => void} deps.setLoadedSong
 * @param {() => void} deps.savePrefs
 */
export function createStrumPopovers({
  strumPopoverEl,
  strumAddBtn,
  strumInputEl,
  strumSuggestionsEl,
  strumLoadPopoverEl,
  strumLoadBtn,
  strumLoadInputEl,
  strumLoadResultsEl,
  strumLoadStatusEl,
  strumBar,
  pinChordToBar,
  playChordAtPad,
  setEditTarget,
  setLoadedSong,
  savePrefs,
}) {
  // ── "+" popover state ──────────────────────────────────────────────

  // Pre-compute the full set of displayable chord names ONCE — 12 roots
  // × 7 qualities = 84 entries, used for both autocomplete suggestions
  // and the parsed-name fast path.
  const ALL_CHORDS = [];
  for (const r of ROOTS) {
    for (const q of QUALITIES) {
      ALL_CHORDS.push({
        name: formatChordName(r.pc, q.id),
        rootPc: r.pc,
        qualityId: q.id,
      });
    }
  }

  let suggestionIdx = -1; // keyboard-highlighted suggestion (-1 = none)

  const setStrumPopover = (open) => {
    if (!strumPopoverEl || !strumAddBtn) return;
    strumPopoverEl.hidden = !open;
    strumAddBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      // Close the sibling load-song popover so the two never overlap
      // visually — they share the same anchor row.
      setStrumLoadPopover(false);
      strumInputEl.value = '';
      refreshSuggestions();
      // Defer focus a tick so iOS Safari opens the keyboard reliably.
      setTimeout(() => strumInputEl?.focus(), 0);
    } else {
      suggestionIdx = -1;
    }
  };

  const normalizeForMatch = (s) =>
    s.toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');

  const refreshSuggestions = () => {
    if (!strumSuggestionsEl) return;
    const raw = (strumInputEl?.value || '').trim();
    const needle = normalizeForMatch(raw);
    const matches = needle
      ? // Prefix match, then prefer shorter names so "c" surfaces
        // C / Cm / C7 above C♯ / C♯m / C♯7 (typed "c" usually means
        // the natural C, not C-sharp).
        ALL_CHORDS.filter((c) => normalizeForMatch(c.name).startsWith(needle))
          .sort((a, b) => a.name.length - b.name.length)
          .slice(0, 12)
      : // No input yet: surface a handful of common starter chords so
        // the popover isn't a wall of nothing.
        ['C', 'G', 'D', 'A', 'E', 'F', 'Em', 'Am', 'Dm']
          .map((n) => ALL_CHORDS.find((c) => c.name === n))
          .filter(Boolean);
    strumSuggestionsEl.innerHTML = '';
    matches.forEach((m, i) => {
      const li = document.createElement('li');
      li.className = 'strum-bar-suggestion';
      li.dataset.rootPc = String(m.rootPc);
      li.dataset.quality = m.qualityId;
      li.textContent = m.name;
      li.setAttribute('role', 'option');
      if (i === suggestionIdx) li.setAttribute('aria-selected', 'true');
      strumSuggestionsEl.appendChild(li);
    });
  };

  const commitTypedChord = () => {
    // Prefer the keyboard-highlighted suggestion when one is selected;
    // otherwise parse whatever the player typed and add that. Pin first
    // (so the pad exists), then play it.
    let target = null;
    if (suggestionIdx >= 0) {
      const li = strumSuggestionsEl?.children[suggestionIdx];
      if (li) {
        target = { rootPc: Number(li.dataset.rootPc), qualityId: li.dataset.quality };
      }
    }
    if (!target) {
      const parsed = parseChordName(strumInputEl?.value || '');
      if (parsed) target = parsed;
    }
    if (!target) {
      // Soft visual error: shake the input briefly so the player knows
      // the typed name didn't parse, without nagging modal dialogs.
      strumInputEl?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 220 }
      );
      return;
    }
    setStrumPopover(false);
    // Typed-name shortcut always lands on voicingIdx 0 (the default
    // shape) — there's no UI to specify a voicing in the input box.
    // The player can switch shapes via the matrix afterwards and
    // their selection will pin a separate `Cⁿ` pad.
    setEditTarget(null);
    playChordAtPad(target.rootPc, target.qualityId, 0);
  };

  strumAddBtn?.addEventListener('click', () => {
    const open = strumAddBtn.getAttribute('aria-expanded') === 'true';
    setStrumPopover(!open);
  });

  strumInputEl?.addEventListener('input', () => {
    suggestionIdx = -1;
    refreshSuggestions();
  });

  strumInputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTypedChord();
    } else if (event.key === 'Escape') {
      setStrumPopover(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = strumSuggestionsEl?.children.length || 0;
      if (!count) return;
      suggestionIdx =
        event.key === 'ArrowDown'
          ? (suggestionIdx + 1) % count
          : (suggestionIdx - 1 + count) % count;
      refreshSuggestions();
    }
  });

  strumSuggestionsEl?.addEventListener('click', (event) => {
    const li = event.target.closest('.strum-bar-suggestion');
    if (!li) return;
    setStrumPopover(false);
    setEditTarget(null);
    playChordAtPad(Number(li.dataset.rootPc), li.dataset.quality, 0);
  });

  // Click-outside-to-dismiss. Also covers the "tapped on the pads while
  // the popover was open" case which felt fiddly without it.
  document.addEventListener('pointerdown', (event) => {
    if (strumPopoverEl?.hidden) return;
    if (strumPopoverEl.contains(event.target)) return;
    if (strumAddBtn?.contains(event.target)) return;
    setStrumPopover(false);
  });

  // ── "↧" popover state ─────────────────────────────────────────────

  let loadInFlight = false;
  // Debounce + race-control state for the live-search input.
  let searchTimer = null;
  // Monotonic id; results from a stale request get dropped if the user
  // has typed again since.
  let searchSeq = 0;
  let currentResults = [];
  let resultIdx = -1; // keyboard-highlighted result, -1 = none

  function setStrumLoadPopover(open) {
    if (!strumLoadPopoverEl || !strumLoadBtn) return;
    strumLoadPopoverEl.hidden = !open;
    strumLoadBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      setStrumPopover(false);
      setLoadStatus(null);
      renderSearchResults([]);
      setTimeout(() => strumLoadInputEl?.focus(), 0);
    } else {
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      resultIdx = -1;
    }
  }

  // Status helper: tone is one of 'info' | 'error' | 'success' | null
  // (null hides the line entirely). aria-live is set on the element so
  // screen readers announce the state changes without needing focus.
  function setLoadStatus(text, tone = 'info') {
    if (!strumLoadStatusEl) return;
    if (!text) {
      strumLoadStatusEl.hidden = true;
      strumLoadStatusEl.textContent = '';
      strumLoadStatusEl.classList.remove('is-error', 'is-success');
      return;
    }
    strumLoadStatusEl.hidden = false;
    strumLoadStatusEl.textContent = text;
    strumLoadStatusEl.classList.toggle('is-error', tone === 'error');
    strumLoadStatusEl.classList.toggle('is-success', tone === 'success');
  }

  // Render the search-results list. A friendly "K plays" badge gives
  // the player a sense of how popular each chart is, which doubles as
  // a quality signal — e-chords transcriptions vary, and the most-played
  // version of a song is usually the one most other people trust.
  function renderSearchResults(hits) {
    if (!strumLoadResultsEl) return;
    currentResults = hits;
    resultIdx = -1;
    strumLoadResultsEl.innerHTML = '';
    if (!hits.length) {
      strumLoadResultsEl.hidden = true;
      return;
    }
    strumLoadResultsEl.hidden = false;
    hits.forEach((h, i) => {
      const li = document.createElement('li');
      li.className = 'strum-bar-load-result';
      li.dataset.idx = String(i);
      li.setAttribute('role', 'option');

      const main = document.createElement('span');
      main.className = 'strum-bar-load-result-main';
      const title = document.createElement('span');
      title.className = 'strum-bar-load-result-title';
      title.textContent = h.title || '(untitled)';
      const artist = document.createElement('span');
      artist.className = 'strum-bar-load-result-artist';
      artist.textContent = h.artist || '';
      main.appendChild(title);
      if (h.artist) main.appendChild(artist);

      const meta = document.createElement('span');
      meta.className = 'strum-bar-load-result-meta';
      meta.textContent = formatPlays(h.popularity);

      li.appendChild(main);
      li.appendChild(meta);
      strumLoadResultsEl.appendChild(li);
    });
  }

  // Compact play-count formatter: 1234 → "1.2K", 1234567 → "1.2M".
  // Tiny counts are a useful "this is a deep cut, not a top hit"
  // signal so we don't round those up to "1K".
  function formatPlays(n) {
    const v = Number(n) || 0;
    if (v < 1000) return `${v} plays`;
    if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K plays`;
    return `${(v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0)}M plays`;
  }

  function highlightResult(i) {
    resultIdx = i;
    if (!strumLoadResultsEl) return;
    Array.from(strumLoadResultsEl.children).forEach((el, idx) => {
      el.toggleAttribute('aria-selected', idx === i);
      el.classList.toggle('is-highlighted', idx === i);
    });
    // Keep highlighted item in view inside the scroll container.
    if (i >= 0) {
      const el = strumLoadResultsEl.children[i];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  async function runSearch(query) {
    const seq = ++searchSeq;
    setLoadStatus('Searching\u2026');
    let hits = [];
    try {
      hits = await searchEchords(query, { limit: 12 });
    } catch (err) {
      if (seq !== searchSeq) return;
      setLoadStatus(
        err && err.message ? `Search failed: ${err.message}` : 'Search failed.',
        'error'
      );
      renderSearchResults([]);
      return;
    }
    if (seq !== searchSeq) return; // stale; user kept typing
    renderSearchResults(hits);
    setLoadStatus(
      hits.length ? null : 'No songs matched. Try a different artist or title.',
      hits.length ? 'info' : 'error'
    );
  }

  async function loadSongFromUrl(url) {
    if (loadInFlight) return;
    loadInFlight = true;
    strumLoadInputEl.disabled = true;
    setLoadStatus('Fetching song\u2026');

    let song;
    try {
      song = await fetchEchordsSong(url);
    } catch (err) {
      setLoadStatus(err && err.message ? err.message : 'Could not fetch that song.', 'error');
      loadInFlight = false;
      strumLoadInputEl.disabled = false;
      return;
    }

    if (!song.barEntries.length) {
      setLoadStatus(
        `No playable chords found on that page${song.skipped.length ? ` (skipped: ${song.skipped.join(', ')})` : ''}.`,
        'error'
      );
      loadInFlight = false;
      strumLoadInputEl.disabled = false;
      return;
    }

    // Loading a fresh song means the player isn't editing a previous
    // pad anymore — drop the edit target so it doesn't lurk on a pad
    // that may have just shifted positions.
    setEditTarget(null);

    // A fresh song-load REPLACES the bar — keeping leftover chords
    // from a prior song would just confuse the palette. (The user can
    // still build up mixed bars manually with the `+` button.)
    strumBar.length = 0;

    // Pin in song-palette order. pinChordToBar is LRU-prepend — walk
    // the palette in REVERSE so the FIRST chord lands at the leftmost
    // position after all the unshifts.
    for (let i = song.barEntries.length - 1; i >= 0; i--) {
      const e = song.barEntries[i];
      pinChordToBar(e.rootPc, e.qualityId, 0);
    }

    // Surface the source link in the strum-bar header so the player
    // can pop the original chord page open for lyrics / structure.
    setLoadedSong({
      url: song.url || url,
      title: song.title || '',
      artist: song.artist || '',
    });
    savePrefs();

    const summary = `${song.title || 'Song'}${song.artist ? ` — ${song.artist}` : ''}: pinned ${
      song.barEntries.length
    } chord${song.barEntries.length === 1 ? '' : 's'}${
      song.skipped.length ? ` (skipped: ${song.skipped.join(', ')})` : ''
    }.`;
    setLoadStatus(summary, 'success');

    loadInFlight = false;
    strumLoadInputEl.disabled = false;
    // Auto-dismiss so the bar pads are immediately playable. Errors
    // stay open so the player can adjust input without reopening.
    setTimeout(() => {
      if (!loadInFlight) setStrumLoadPopover(false);
    }, 2200);
  }

  // Enter handler — picks a highlighted result if one's selected,
  // otherwise runs an immediate search (skipping the debounce).
  function commitLoadInput() {
    const raw = (strumLoadInputEl?.value || '').trim();
    if (!raw) {
      setLoadStatus('Type a song or artist to search.', 'error');
      return;
    }
    // If a search result is keyboard-highlighted, ENTER picks that
    // result (gmail-style). This is the most useful binding for
    // "type, arrow-down, enter" power use.
    if (resultIdx >= 0 && currentResults[resultIdx]) {
      loadSongFromUrl(currentResults[resultIdx].url);
      return;
    }
    if (searchTimer) clearTimeout(searchTimer);
    runSearch(raw);
  }

  strumLoadBtn?.addEventListener('click', () => {
    const open = strumLoadBtn.getAttribute('aria-expanded') === 'true';
    setStrumLoadPopover(!open);
  });

  // Live search as the player types. Very short queries (< 2 chars)
  // are ignored to avoid hammering the API with single-letter typos;
  // a 280ms debounce gives the player room to keep typing without
  // every keystroke firing a network request.
  strumLoadInputEl?.addEventListener('input', () => {
    const raw = (strumLoadInputEl?.value || '').trim();
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (!raw || raw.length < 2) {
      setLoadStatus(null);
      renderSearchResults([]);
      return;
    }
    searchTimer = setTimeout(() => {
      runSearch(raw);
    }, 280);
  });

  strumLoadInputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitLoadInput();
    } else if (event.key === 'Escape') {
      setStrumLoadPopover(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!currentResults.length) return;
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? (resultIdx + 1) % currentResults.length
          : (resultIdx - 1 + currentResults.length) % currentResults.length;
      highlightResult(next);
    }
  });

  // Click on a result row → load that song. Listener is on the <ul>
  // (event delegation) so we don't have to wire one per row each
  // render.
  strumLoadResultsEl?.addEventListener('click', (event) => {
    const li = event.target.closest('.strum-bar-load-result');
    if (!li) return;
    const i = Number(li.dataset.idx);
    const hit = currentResults[i];
    if (!hit) return;
    loadSongFromUrl(hit.url);
  });

  // Click-outside-to-dismiss for the load popover. Same shape as the
  // chord-name popover above; kept as a separate listener so a click
  // on the chord-name button doesn't accidentally re-toggle the load
  // popover (and vice versa).
  document.addEventListener('pointerdown', (event) => {
    if (strumLoadPopoverEl?.hidden) return;
    if (strumLoadPopoverEl.contains(event.target)) return;
    if (strumLoadBtn?.contains(event.target)) return;
    setStrumLoadPopover(false);
  });
}
