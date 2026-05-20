import { Reader } from './reader.js';
import { saveToShelf, getRecentBooks, removeFromShelf, saveScrollPosition, getScrollPosition } from './shelf.js';

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
reader.setupPageZones(
  document.getElementById('zone-prev'),
  document.getElementById('zone-next')
);

const THEMES = ['dark', 'sepia', 'light'];
let themeIndex = 0;

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
  const card = document.createElement('div');
  card.className = 'book-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;

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
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openBook(book);
  });

  return card;
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
    const card = document.createElement('div');
    card.className = 'book-card shelf-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

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
      <button class="card-remove-btn" aria-label="Remove from shelf" title="Remove">✕</button>
    `;

    card.querySelector('.card-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromShelf(entry.id);
      renderShelf();
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
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') card.click();
    });

    shelfGrid.appendChild(card);
  }
}

function openBookFromShelf(entry) {
  // Re-construct a minimal book-like object from shelf data
  const book = {
    id: entry.id,
    title: entry.title,
    authors: [{ name: entry.author }],
    formats: entry.formats,
  };
  openBook(book);
}

// --- Featured ---

async function renderFeatured() {
  featuredGrid.innerHTML = '<div class="grid-loading">Loading…</div>';
  try {
    const books = await fetchFeaturedBooks();
    featuredGrid.innerHTML = '';
    for (const book of books) {
      featuredGrid.appendChild(createBookCard(book));
    }
  } catch {
    featuredGrid.innerHTML = '<p class="empty-message">Could not load books. Check your connection.</p>';
  }
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

async function runSearch(query) {
  searchResultsSection.classList.remove('hidden');
  searchResultsGrid.innerHTML = '<div class="grid-loading">Searching…</div>';
  try {
    const books = await searchBooks(query);
    searchResultsGrid.innerHTML = '';
    if (!books.length) {
      searchResultsGrid.innerHTML = `<p class="empty-message">No results for "<em>${escapeHtml(query)}</em>".</p>`;
      return;
    }
    for (const book of books) {
      searchResultsGrid.appendChild(createBookCard(book));
    }
  } catch {
    searchResultsGrid.innerHTML = '<p class="empty-message">Search failed. Check your connection.</p>';
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
      li.className = `toc-item toc-level-${entry.level}`;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.textContent = entry.text;
      li.addEventListener('click', () => {
        reader.scrollToHeading(entry.id);
        closeTocSheet();
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          reader.scrollToHeading(entry.id);
          closeTocSheet();
        }
      });
      ul.appendChild(li);
    }
    tocList.appendChild(ul);
  }

  tocSheet.classList.remove('hidden');
  tocSheetOverlay.classList.remove('hidden');
  requestAnimationFrame(() => tocSheet.focus());
}

function closeTocSheet() {
  tocSheet.classList.add('hidden');
  tocSheetOverlay.classList.add('hidden');
}

btnToc.addEventListener('click', openTocSheet);
btnCloseToc.addEventListener('click', closeTocSheet);
tocSheetOverlay.addEventListener('click', closeTocSheet);
tocSheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTocSheet(); });

// --- Reader ---

async function openBook(book) {
  saveToShelf(book);
  readerTitle.textContent = book.title;
  tocSheetBookTitle.textContent = book.title;

  closeTocSheet();
  browseView.classList.add('hidden');
  readerView.classList.remove('hidden');
  window.scrollTo({ top: 0 });

  // Start with settings toolbar hidden — nav bar is always visible
  readerControls.classList.add('controls-hidden');

  const savedPos = getScrollPosition(book.id);

  reader.onPageChange = (page, total) => {
    const pct = total > 1 ? (page / (total - 1)) * 100 : 0;
    if (readingProgress) readingProgress.style.width = `${pct}%`;
    if (readerProgressPct) readerProgressPct.textContent = total > 0 ? `${page + 1} / ${total}` : '';
  };

  try {
    await reader.loadBook(book, savedPos);
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
  renderShelf();
});

btnFontDec.addEventListener('click', () => reader.setFontSize(-2));
btnFontInc.addEventListener('click', () => reader.setFontSize(2));

btnTheme.addEventListener('click', () => {
  themeIndex = (themeIndex + 1) % THEMES.length;
  const theme = THEMES[themeIndex];
  reader.setTheme(theme);
  const labels = { dark: '🌙 Dark', sepia: '📜 Sepia', light: '☀️ Light' };
  btnTheme.textContent = labels[theme];
});

btnFontFamily.addEventListener('click', () => {
  const isSerif = readerContainer.style.getPropertyValue('--reader-font-family').includes('Georgia');
  if (isSerif) {
    reader.setFontFamily('sans');
    btnFontFamily.textContent = 'Sans';
  } else {
    reader.setFontFamily('serif');
    btnFontFamily.textContent = 'Serif';
  }
});

// --- Init ---

renderShelf();
renderFeatured();
