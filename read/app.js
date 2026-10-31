import { Reader } from './reader.js';
import {
  saveToShelf,
  getRecentBooks,
  removeFromShelf,
  saveScrollPosition,
  getScrollPosition
} from './shelf.js';

const GUTENDEX_URL = 'https://gutendex.com/books/';

// Featured classic books by Gutenberg ID
const FEATURED_IDS = [1342, 1661, 2701, 84, 11, 76, 345, 1080, 98, 2554];

// DOM refs
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search-input'));
const searchClear = document.getElementById('search-clear');
const browseView = document.getElementById('browse-view');
const shelfSection = document.getElementById('shelf-section');
const shelfGrid = document.getElementById('shelf-grid');
const featuredGrid = document.getElementById('featured-grid');
const searchResultsSection = document.getElementById('search-results-section');
const searchResultsGrid = document.getElementById('search-results-grid');
const readerView = document.getElementById('reader-view');
const readerContainer = document.getElementById('reader-container');
const readerControls = document.getElementById('reader-controls');
const readerTitle = document.getElementById('reader-title');
const btnFontDec = document.getElementById('btn-font-dec');
const btnFontInc = document.getElementById('btn-font-inc');
const btnTheme = document.getElementById('btn-theme');
const btnFontFamily = document.getElementById('btn-font-family');
const btnCloseReader = document.getElementById('btn-close-reader');
const readingProgress = document.getElementById('reading-progress');
const readerProgressPct = document.getElementById('reader-progress-pct');
const toastStack = document.getElementById('toast-stack');

// TOC sheet refs
const tocSheet = document.getElementById('toc-sheet');
const tocSheetOverlay = document.getElementById('toc-sheet-overlay');
const tocSheetBookTitle = document.getElementById('toc-sheet-book-title');
const tocList = document.getElementById('toc-list');
const btnToc = document.getElementById('btn-toc');
const btnCloseToc = document.getElementById('btn-close-toc');

const reader = new Reader(readerContainer, readerControls);
reader.setupPageZones(document.getElementById('zone-prev'), document.getElementById('zone-next'));

const THEMES = ['sepia', 'light', 'dark'];
const THEME_LABELS = { dark: '🌙 Dark', sepia: '📜 Sepia', light: '☀️ Light' };

// Match the site's dark/light mode on first load. Honors an explicit
// `<html data-theme="…">` override first (set by the site's theme toggle),
// then falls back to the OS-level prefers-color-scheme.
function detectSiteDarkMode() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

const initialTheme = detectSiteDarkMode() ? 'dark' : 'sepia';
let themeIndex = THEMES.indexOf(initialTheme);
reader.setTheme(initialTheme);
btnTheme.textContent = THEME_LABELS[initialTheme];

// --- Gutendex API ---

async function fetchBooks(params) {
  const url = `${GUTENDEX_URL}?${new URLSearchParams(params)}`;
  return window.proxyService.fetchJson(url, { skipDirect: false });
}

function hasReadableText(book) {
  return Object.keys(book.formats || {}).some((mime) => mime.startsWith('text/'));
}

async function fetchFeaturedBooks() {
  const data = await fetchBooks({ ids: FEATURED_IDS.join(',') });
  return (data.results || []).filter(hasReadableText);
}

async function searchBooks(query) {
  const data = await fetchBooks({ search: query });
  return (data.results || []).filter(hasReadableText);
}

// --- URL persistence ---
// Track the open book in the query string so the reader survives refresh
// and can be linked to. Uses `replaceState` (matches the pattern in
// watch/) — refresh works, but the browser back button still leaves the
// site rather than closing the book.
//
// URL shape: `?book=<gutenberg-id>-<slug>` (e.g. `?book=45-anne-of-green-gables`).
// The Gutenberg ID is stable forever (like an ISBN); the slug is purely
// cosmetic — parsing takes the leading digits and ignores everything
// after, so a stale or missing slug still resolves to the right book.

function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function getBookIdFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('book');
  if (!raw) return null;
  const match = String(raw).match(/^(\d+)/);
  return match ? match[1] : null;
}

function setBookIdInUrl(bookId, title = null) {
  const url = new URL(window.location.href);
  if (bookId) {
    const slug = title ? slugifyTitle(title) : '';
    url.searchParams.set('book', slug ? `${bookId}-${slug}` : String(bookId));
  } else {
    url.searchParams.delete('book');
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// --- Helpers ---

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAuthor(authors) {
  if (!authors?.length) return 'Unknown';
  return authors.map((a) => a.name || '').join(', ');
}

function getCoverUrl(book) {
  const formats = book.formats || {};
  return (
    formats['image/jpeg'] ||
    formats['image/png'] ||
    Object.values(formats).find((u) => /\.(jpg|jpeg|png)$/i.test(u)) ||
    null
  );
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// --- Book cards ---

function createBookCard(book) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'book-card';

  const cover = getCoverUrl(book);
  const author = formatAuthor(book.authors);
  const lang = book.languages?.join(', ') || '';

  card.innerHTML = `
    <div class="book-cover" aria-hidden="true">
      ${
        cover
          ? `<img src="${cover}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="book-cover-placeholder">📚</div>`
      }
    </div>
    <div class="book-info">
      <p class="book-title">${escapeHtml(book.title)}</p>
      <p class="book-author">${escapeHtml(author)}</p>
      ${lang ? `<p class="book-meta">${escapeHtml(lang.toUpperCase())}</p>` : ''}
    </div>
  `;

  card.addEventListener('click', () => openBook(book));

  return card;
}

function focusIfIdle(el, force = false) {
  const focus = window.heymingRemote;
  if (focus && typeof focus.focusIfIdle === 'function') return focus.focusIfIdle(el, force);
  if (!el) return false;
  if (!force) {
    const active = document.activeElement;
    const idle =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      active.classList.contains('heyming-nav-toggle');
    if (!idle) return false;
  }
  el.focus({ preventScroll: true });
  return true;
}

function focusFirstCard(root, force = false) {
  let card = null;
  for (const candidate of root.querySelectorAll('button.book-card')) {
    if (candidate.closest('.hidden')) continue;
    card = candidate;
    break;
  }
  if (!card || !focusIfIdle(card, force)) return;
  if (typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function showGridMessage(grid, message, onRetry) {
  grid.replaceChildren();
  const p = document.createElement('p');
  p.className = 'empty-message';
  p.textContent = message;
  grid.appendChild(p);
  if (!onRetry) return;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'retry-btn';
  retry.textContent = 'Try again';
  retry.addEventListener('click', onRetry);
  grid.appendChild(retry);
  focusIfIdle(retry);
}

// --- Shelf ---

function renderShelf() {
  const books = getRecentBooks(8);
  if (!books.length) {
    shelfSection.classList.add('hidden');
    return;
  }
  shelfSection.classList.remove('hidden');
  shelfGrid.innerHTML = '';
  for (const entry of books) {
    const slot = document.createElement('div');
    slot.className = 'book-slot';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'book-card shelf-card';
    card.setAttribute('aria-keyshortcuts', 'Delete Backspace');

    card.innerHTML = `
      <div class="book-cover" aria-hidden="true">
        ${
          entry.coverUrl
            ? `<img src="${entry.coverUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="book-cover-placeholder">📚</div>`
        }
      </div>
      <div class="book-info">
        <p class="book-title">${escapeHtml(entry.title)}</p>
        <p class="book-author">${escapeHtml(entry.author)}</p>
        <p class="book-meta">Resume reading</p>
      </div>
    `;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'card-remove-btn';
    remove.tabIndex = -1;
    remove.setAttribute('aria-label', 'Remove from shelf');
    remove.title = 'Remove';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromShelf(entry.id);
      renderShelf();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      e.preventDefault();
      e.stopPropagation();
      remove.click();
    });

    card.addEventListener('click', async () => {
      try {
        const data = await fetchBooks({ ids: entry.id });
        const book = data.results?.[0];
        if (book) openBook(book);
        else openBookFromShelf(entry);
      } catch {
        openBookFromShelf(entry);
      }
    });

    slot.append(card, remove);
    shelfGrid.appendChild(slot);
  }
  focusFirstCard(shelfGrid);
}

function openBookFromShelf(entry) {
  // Re-construct a minimal book-like object from shelf data
  const book = {
    id: entry.id,
    title: entry.title,
    authors: [{ name: entry.author }],
    formats: entry.formats
  };
  openBook(book);
}

// --- Featured ---

async function renderFeatured() {
  featuredGrid.innerHTML = '<div class="grid-loading">Loading…</div>';
  try {
    const books = await fetchFeaturedBooks();
    featuredGrid.innerHTML = '';
    if (!books.length) {
      showGridMessage(featuredGrid, 'No books found.', () => renderFeatured());
      return;
    }
    for (const book of books) {
      featuredGrid.appendChild(createBookCard(book));
    }
  } catch {
    showGridMessage(featuredGrid, 'Could not load books. Check your connection.', () =>
      renderFeatured()
    );
    return;
  }
  focusFirstCard(featuredGrid);
}

// --- Search ---

let searchDebounce = null;

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (!query) {
    searchResultsSection.classList.add('hidden');
    return;
  }
  searchDebounce = setTimeout(() => runSearch(query), 400);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchResultsSection.classList.add('hidden');
  searchInput.focus();
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const query = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (!query) {
    focusFirstCard(featuredGrid);
    return;
  }
  runSearch(query).then(() => focusFirstCard(searchResultsGrid, true));
});

async function runSearch(query) {
  searchResultsSection.classList.remove('hidden');
  searchResultsGrid.innerHTML = '<div class="grid-loading">Searching…</div>';
  try {
    const books = await searchBooks(query);
    searchResultsGrid.innerHTML = '';
    if (!books.length) {
      showGridMessage(searchResultsGrid, `No results for "${query}".`);
      return;
    }
    for (const book of books) {
      searchResultsGrid.appendChild(createBookCard(book));
    }
  } catch {
    showGridMessage(searchResultsGrid, 'Search failed. Check your connection.', () =>
      runSearch(query)
    );
  }
}

// --- TOC sheet ---

function openTocSheet() {
  const entries = reader.toc;
  tocList.innerHTML = '';

  if (!entries.length) {
    tocList.innerHTML = '<p class="toc-empty">No chapters found in this book.</p>';
  } else {
    const ul = document.createElement('ul');
    ul.className = 'toc-items';
    for (const entry of entries) {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `toc-item toc-level-${entry.level}`;
      item.textContent = entry.text;
      item.addEventListener('click', () => {
        reader.scrollToHeading(entry.id);
        closeTocSheet();
      });
      li.appendChild(item);
      ul.appendChild(li);
    }
    tocList.appendChild(ul);
  }

  tocSheet.classList.remove('hidden');
  tocSheetOverlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    const first = tocList.querySelector('button.toc-item');
    (first || btnCloseToc).focus();
  });
}

function closeTocSheet() {
  const restore = tocSheet.contains(document.activeElement);
  tocSheet.classList.add('hidden');
  tocSheetOverlay.classList.add('hidden');
  if (restore) btnToc.focus();
}

btnToc.addEventListener('click', openTocSheet);
btnCloseToc.addEventListener('click', closeTocSheet);
tocSheetOverlay.addEventListener('click', closeTocSheet);
tocSheet.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTocSheet();
});

// --- Reader ---

async function openBook(book) {
  saveToShelf(book);
  setBookIdInUrl(book.id, book.title);
  readerTitle.textContent = book.title;
  tocSheetBookTitle.textContent = book.title;

  closeTocSheet();
  browseView.classList.add('hidden');
  readerView.classList.remove('hidden');
  window.scrollTo({ top: 0 });

  // Settings stay out of tab order until Aa is pressed. The next-page
  // button takes focus so Enter turns the page and arrows reach the bar.
  reader.hideControls(true);
  // The reader was display:none. Focus on the next frame so the chevron
  // actually receives it and Enter turns the page.
  requestAnimationFrame(() => {
    document.getElementById('zone-next')?.focus({ preventScroll: true });
  });

  const savedPos = getScrollPosition(book.id);

  reader.onPageChange = (page, total) => {
    const pct = total > 1 ? (page / (total - 1)) * 100 : 0;
    if (readingProgress) readingProgress.style.width = `${pct}%`;
    if (readerProgressPct)
      readerProgressPct.textContent = total > 0 ? `${page + 1} / ${total}` : '';
    if (total > 1 && page === total - 1) {
      window.heymingAchievements?.unlockForCurrentApp('last-page');
    }
  };

  try {
    await reader.loadBook(book, savedPos);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  } catch (err) {
    showToast(err.message || 'Failed to load book', 'error');
  }
}

reader.onScrollSave = (bookId, position) => {
  saveScrollPosition(bookId, position);
};

// --- Reader controls ---

btnCloseReader.addEventListener('click', () => {
  closeTocSheet();
  readerView.classList.add('hidden');
  browseView.classList.remove('hidden');
  setBookIdInUrl(null);
  renderShelf();
});

document.getElementById('btn-reader-text').addEventListener('click', () => {
  reader.showControls();
  btnFontDec.focus();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!tocSheet.classList.contains('hidden')) return;
  if (readerControls.classList.contains('controls-hidden')) return;
  if (!readerControls.contains(document.activeElement)) return;
  reader.hideControls(true);
  document.getElementById('btn-reader-text').focus();
});

btnFontDec.addEventListener('click', () => reader.setFontSize(-2));
btnFontInc.addEventListener('click', () => reader.setFontSize(2));

btnTheme.addEventListener('click', () => {
  themeIndex = (themeIndex + 1) % THEMES.length;
  const theme = THEMES[themeIndex];
  reader.setTheme(theme);
  btnTheme.textContent = THEME_LABELS[theme];
});

btnFontFamily.addEventListener('click', () => {
  const isSerif = readerContainer.style
    .getPropertyValue('--reader-font-family')
    .includes('Georgia');
  if (isSerif) {
    reader.setFontFamily('sans');
    btnFontFamily.textContent = 'Sans';
  } else {
    reader.setFontFamily('serif');
    btnFontFamily.textContent = 'Serif';
  }
});

// --- Init ---

async function restoreBookFromUrl() {
  const bookId = getBookIdFromUrl();
  if (!bookId) return;
  try {
    const data = await fetchBooks({ ids: bookId });
    const book = data.results?.[0];
    if (book) {
      openBook(book);
    } else {
      // Unknown ID — drop the param so it doesn't stick on refresh.
      setBookIdInUrl(null);
    }
  } catch {
    // Network hiccup — leave the URL alone so a retry (refresh) still works.
  }
}

renderShelf();
renderFeatured();
restoreBookFromUrl();
