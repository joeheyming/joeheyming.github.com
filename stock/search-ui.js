// Stock Ticker — symbol search box + suggestions popover.
// Encapsulates its own debounce timer, request token, and keyboard cursor.

import { searchTickers } from './api.js';
import { escapeHtml } from './format.js';

/**
 * @param {{
 *   input: HTMLInputElement,
 *   suggestions: HTMLElement,
 *   onPick: (symbol: string, name?: string) => void
 * }} deps
 */
export function createSearchController({ input, suggestions, onPick }) {
  let searchToken = 0;
  let searchTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
  let suggestionIndex = -1;

  function close() {
    suggestions.classList.add('hidden');
    suggestions.innerHTML = '';
    suggestionIndex = -1;
  }

  function highlight() {
    suggestions.querySelectorAll('.suggestion-row').forEach((r, i) =>
      r.classList.toggle('hl', i === suggestionIndex)
    );
  }

  function render(hits, q) {
    const raw = q.toUpperCase();
    /** @type {{symbol:string,name:string,exchange:string,type:string}[]} */
    const rows = [];
    if (raw && !hits.some((h) => h.symbol.toUpperCase() === raw)) {
      rows.push({ symbol: raw, name: 'Add as ticker', exchange: '', type: '' });
    }
    rows.push(...hits.slice(0, 10));

    if (!rows.length) {
      suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-slate-400">No results.</div>`;
      suggestions.classList.remove('hidden');
      suggestionIndex = -1;
      return;
    }

    suggestions.innerHTML = '';
    rows.forEach((hit, idx) => {
      const row = document.createElement('div');
      row.className = 'suggestion-row';
      row.dataset.idx = String(idx);
      row.innerHTML = `
        <div class="min-w-0">
          <div class="sym">${escapeHtml(hit.symbol)}</div>
          <div class="name">${escapeHtml(hit.name)}</div>
        </div>
        <div class="ex">${escapeHtml(hit.exchange || hit.type || '')}</div>
      `;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onPick(hit.symbol, hit.name);
        input.value = '';
        close();
      });
      row.addEventListener('mouseenter', () => {
        suggestionIndex = idx;
        highlight();
      });
      suggestions.appendChild(row);
    });

    suggestionIndex = 0;
    highlight();
    suggestions.classList.remove('hidden');
  }

  async function run(q) {
    const myToken = ++searchToken;
    try {
      const hits = await searchTickers(q);
      if (myToken !== searchToken) return;
      render(hits, q);
    } catch (err) {
      if (myToken !== searchToken) return;
      suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-rose-300">Search failed: ${escapeHtml(
        err?.message || String(err)
      )}</div>`;
      suggestions.classList.remove('hidden');
    }
  }

  function handleInput() {
    const q = input.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) {
      close();
      return;
    }
    searchTimer = setTimeout(() => run(q), 200);
  }

  function handleKeydown(e) {
    const rows = suggestions.querySelectorAll('.suggestion-row');
    if (e.key === 'ArrowDown') {
      if (!rows.length) return;
      e.preventDefault();
      suggestionIndex = (suggestionIndex + 1) % rows.length;
      highlight();
    } else if (e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      suggestionIndex = (suggestionIndex - 1 + rows.length) % rows.length;
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows.length && suggestionIndex >= 0) {
        rows[suggestionIndex].dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        );
      } else if (input.value.trim()) {
        onPick(input.value.trim().toUpperCase());
        input.value = '';
        close();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  }

  return { handleInput, handleKeydown, close };
}
