import { Player, getCoverUrl, formatCreator } from './player.js';
import { saveProgress, getBookProgress, getRecentBooks, clearProgress } from './library.js';

const IA_SEARCH = 'https://archive.org/advancedsearch.php';
const IA_METADATA = 'https://archive.org/metadata';
const IA_DOWNLOAD = 'https://archive.org/download';
const PROGRESS_INTERVAL_MS = 5000;

// DOM refs
const audioEl = /** @type {HTMLAudioElement} */ (document.getElementById('audio-element'));
const browseView = document.getElementById('browse-view');
const detailView = document.getElementById('book-detail');
const browseGrid = document.getElementById('browse-grid');
const continueSection = document.getElementById('continue-section');
const continueList = document.getElementById('continue-list');
const searchResultsSection = document.getElementById('search-results-section');
const searchResultsGrid = document.getElementById('search-results-grid');
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search-input'));
const searchClear = document.getElementById('search-clear');
const backBtn = document.getElementById('back-to-browse');
const detailNavTitle = document.getElementById('detail-nav-title');
const bookDetailHeader = document.getElementById('book-detail-header');
const chapterList = document.getElementById('chapter-list');

// Chapter sheet refs
const chapterSheet = document.getElementById('chapter-sheet');
const chapterSheetOverlay = document.getElementById('chapter-sheet-overlay');
const chapterSheetBookTitle = document.getElementById('chapter-sheet-book-title');
const btnOpenChapters = document.getElementById('btn-open-chapters');
const btnCloseChapters = document.getElementById('btn-close-chapters');
const btnChaptersPlayer = document.getElementById('btn-chapters');

// Player bar refs
const playerBar = document.getElementById('player-bar');
const playerTitle = document.getElementById('player-title');
const playerChapter = document.getElementById('player-chapter');
const seekBar = /** @type {HTMLInputElement} */ (document.getElementById('seek-bar'));
const timeDisplay = document.getElementById('time-display');
const btnPrev = document.getElementById('btn-prev');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnNext = document.getElementById('btn-next');
const speedSelect = /** @type {HTMLSelectElement} */ (document.getElementById('speed-select'));
const loadingOverlay = document.getElementById('loading-overlay');
const toastStack = document.getElementById('toast-stack');

const player = new Player(audioEl);
/** @type {object|null} */
let currentBook = null;
let progressTimer = null;
let isSeeking = false;

// --- Internet Archive API (CORS-ok, no proxy needed) ---

async function iaSearch(params) {
  const url = `${IA_SEARCH}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`Archive.org search failed: ${resp.status}`);
  return resp.json();
}

async function iaMetadata(identifier) {
  const resp = await fetch(`${IA_METADATA}/${identifier}`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Could not load book data (${resp.status})`);
  return resp.json();
}

async function fetchRecentBooks() {
  const data = await iaSearch({
    q: 'collection:librivoxaudio',
    'sort[]': 'addeddate desc',
    output: 'json',
    'fl[]': ['identifier', 'title', 'creator', 'description'],
    rows: 16,
    page: 1
  });
  return (data?.response?.docs || []).map(normalizeBook);
}

async function searchBooks(query) {
  const q = `collection:librivoxaudio AND (title:(${query}) OR creator:(${query}))`;
  const data = await iaSearch({
    q,
    output: 'json',
    'fl[]': ['identifier', 'title', 'creator', 'description'],
    rows: 20,
    page: 1
  });
  return (data?.response?.docs || []).map(normalizeBook);
}

async function fetchBookSections(identifier) {
  const data = await iaMetadata(identifier);
  const meta = data.metadata || {};
  const files = data.files || [];

  // Only original source MP3s (not 64kb re-encodes etc.)
  const mp3s = files
    .filter((f) => f.name?.endsWith('.mp3') && (f.source === 'original' || !f.source))
    .map((f) => ({
      title: f.title || f.name?.replace(/\.mp3$/i, '') || '',
      listen_url: `${IA_DOWNLOAD}/${identifier}/${f.name}`,
      playtime: parseFloat(f.length) || 0,
      _trackSort: trackSortKey(f)
    }))
    .sort((a, b) => a._trackSort.localeCompare(b._trackSort));

  return {
    sections: mp3s,
    description: Array.isArray(meta.description)
      ? meta.description.join(' ')
      : String(meta.description || '')
  };
}

function trackSortKey(file) {
  if (file.track) {
    const num = parseInt(String(file.track).split('/')[0], 10);
    return String(num).padStart(6, '0');
  }
  return file.name || '';
}

function normalizeBook(doc) {
  return {
    id: doc.identifier,
    identifier: doc.identifier,
    title: Array.isArray(doc.title) ? doc.title[0] : doc.title || 'Untitled',
    creator: Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator || 'Unknown',
    description: Array.isArray(doc.description) ? doc.description[0] : doc.description || '',
    sections: null // loaded on demand
  };
}

// --- URL persistence ---
// Track the open book in the query string so refresh keeps you on the
// same audiobook (its saved chapter/position lives in localStorage).
// Uses `replaceState` — refresh works, back button still leaves the site.

function getBookIdFromUrl() {
  return new URLSearchParams(window.location.search).get('book') || null;
}

function setBookIdInUrl(bookId) {
  const url = new URL(window.location.href);
  if (bookId) {
    url.searchParams.set('book', String(bookId));
  } else {
    url.searchParams.delete('book');
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// --- UI helpers ---

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function setLoading(show) {
  if (loadingOverlay) loadingOverlay.classList.toggle('hidden', !show);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Book cards ---

function createBookCard(book, resumeData = null) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'book-card';

  const cover = getCoverUrl(book);

  card.innerHTML = `
    <div class="book-cover" aria-hidden="true">
      ${
        cover
          ? `<img src="${cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=book-cover-placeholder>📖</div>'">`
          : `<div class="book-cover-placeholder">📖</div>`
      }
    </div>
    <div class="book-info">
      <p class="book-title">${escapeHtml(book.title)}</p>
      <p class="book-author">${escapeHtml(book.creator)}</p>
      ${resumeData ? `<p class="book-resume">Ch. ${resumeData.sectionIndex + 1}</p>` : ''}
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
  for (const candidate of root.querySelectorAll('button.book-card, button.continue-item')) {
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

// --- Continue listening ---

function renderContinueSection() {
  const recent = getRecentBooks(4);
  if (!recent.length) {
    continueSection.classList.add('hidden');
    return;
  }
  continueSection.classList.remove('hidden');
  continueList.innerHTML = '';
  for (const entry of recent) {
    const slot = document.createElement('div');
    slot.className = 'continue-slot';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'continue-item';
    item.setAttribute('aria-keyshortcuts', 'Delete Backspace');

    const pct =
      entry.totalSections > 1
        ? Math.round((entry.sectionIndex / (entry.totalSections - 1)) * 100)
        : 0;

    item.innerHTML = `
      <div class="continue-cover">
        ${
          entry.coverUrl
            ? `<img src="${entry.coverUrl}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="book-cover-placeholder small">📖</div>`
        }
      </div>
      <div class="continue-info">
        <p class="continue-title">${escapeHtml(entry.title)}</p>
        <p class="continue-author">${escapeHtml(entry.author)}</p>
        <p class="continue-pos">Ch. ${entry.sectionIndex + 1}</p>
        <div class="continue-progress-bar">
          <div class="continue-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'card-remove-btn';
    remove.tabIndex = -1;
    remove.setAttribute('aria-label', 'Remove from continue listening');
    remove.title = 'Remove';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      clearProgress(entry.id);
      renderContinueSection();
    });

    item.addEventListener('keydown', (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      e.preventDefault();
      e.stopPropagation();
      remove.click();
    });

    item.addEventListener('click', () =>
      fetchAndResumeBook(entry.id, entry.sectionIndex, entry.position)
    );

    slot.append(item, remove);
    continueList.appendChild(slot);
  }
  focusFirstCard(continueList);
}

async function fetchAndResumeBook(identifier, sectionIndex, position) {
  setLoading(true);
  try {
    const data = await iaMetadata(identifier);
    const meta = data.metadata || {};
    const book = normalizeBook({
      identifier,
      title: meta.title || identifier,
      creator: meta.creator,
      description: meta.description
    });
    openBook(book, sectionIndex, position);
  } catch {
    showToast('Could not load book. Check your connection.', 'error');
  } finally {
    setLoading(false);
  }
}

// --- Browse ---

async function renderBrowse() {
  browseGrid.innerHTML = '<div class="grid-loading">Loading…</div>';
  try {
    const books = await fetchRecentBooks();
    browseGrid.innerHTML = '';
    if (!books.length) {
      showGridMessage(browseGrid, 'No books found.', () => renderBrowse());
      return;
    }
    for (const book of books) {
      browseGrid.appendChild(createBookCard(book));
    }
  } catch {
    showGridMessage(browseGrid, "Couldn't load books. Check your connection.", () =>
      renderBrowse()
    );
    return;
  }
  focusFirstCard(browseGrid);
}

// --- Search ---

let searchDebounce = null;

function handleSearchInput() {
  const query = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (!query) {
    searchResultsSection.classList.add('hidden');
    return;
  }
  searchDebounce = setTimeout(() => runSearch(query), 400);
}

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
  } catch (err) {
    showGridMessage(searchResultsGrid, 'Search failed. Check your connection.', () =>
      runSearch(query)
    );
    console.error('Search error:', err);
  }
}

// --- Book detail view ---

async function openBook(book, startSectionIndex = null, startPosition = 0) {
  setLoading(true);
  try {
    // Load sections if not already present
    if (!book.sections) {
      const { sections, description } = await fetchBookSections(book.identifier);
      book.sections = sections;
      if (!book.description && description) book.description = description;
    } else if (typeof window.yieldToMain === 'function') {
      // Cache hit — no network `await` above, so nothing has yielded yet
      // and the click handler would otherwise run showDetailView +
      // renderChapterList (up to 100+ chapter <li>s) inside the click's
      // INP window. Yield once so the "Loading…" state paints first.
      await window.yieldToMain();
    }

    if (!book.sections.length) {
      showToast('No audio files found for this book.', 'error');
      return;
    }

    const saved = getBookProgress(book.id);
    const sectionIndex = startSectionIndex ?? saved?.sectionIndex ?? 0;
    const position = startSectionIndex !== null ? startPosition : saved?.position ?? 0;

    currentBook = book;
    setBookIdInUrl(book.identifier);
    showDetailView(book, sectionIndex);
    loadBookIntoPlayer(book, sectionIndex, position);
    // The player bar was display:none. Focus Play on the next frame.
    requestAnimationFrame(() => {
      if (!playerBar.classList.contains('hidden')) btnPlayPause.focus({ preventScroll: true });
    });
  } catch (err) {
    showToast(err.message || 'Could not load book.', 'error');
  } finally {
    setLoading(false);
  }
}

function showDetailView(book, activeSectionIndex) {
  browseView.classList.add('hidden');
  detailView.classList.remove('hidden');
  detailNavTitle.textContent = book.title;
  chapterSheetBookTitle.textContent = book.title;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const cover = getCoverUrl(book);
  const desc = (book.description || '').replace(/<[^>]+>/g, '').trim();

  bookDetailHeader.innerHTML = `
    <div class="detail-header">
      <div class="detail-cover">
        ${
          cover
            ? `<img src="${cover}" alt="${escapeHtml(book.title)} cover" loading="lazy">`
            : `<div class="book-cover-placeholder large">📖</div>`
        }
      </div>
      <div class="detail-meta">
        <h2 class="detail-title">${escapeHtml(book.title)}</h2>
        <p class="detail-author">${escapeHtml(book.creator)}</p>
        ${
          desc
            ? `<p class="detail-desc">${escapeHtml(desc.slice(0, 300))}${
                desc.length > 300 ? '…' : ''
              }</p>`
            : ''
        }
      </div>
    </div>
  `;

  renderChapterList(book.sections || [], activeSectionIndex);
}

function renderChapterList(sections, activeIndex) {
  chapterList.innerHTML = '';
  if (!sections.length) {
    chapterList.innerHTML = '<p class="empty-message">No chapters available.</p>';
    return;
  }

  const header = document.createElement('h2');
  header.className = 'chapters-heading';
  header.textContent = `Chapters (${sections.length})`;
  chapterList.appendChild(header);

  const ul = document.createElement('ul');
  ul.className = 'chapter-items';

  sections.forEach((section, i) => {
    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chapter-item' + (i === activeIndex ? ' active' : '');
    item.dataset.index = String(i);

    item.innerHTML = `
      <span class="chapter-number">${i + 1}</span>
      <span class="chapter-name">${escapeHtml(section.title || `Chapter ${i + 1}`)}</span>
      ${
        section.playtime
          ? `<span class="chapter-duration">${formatTime(section.playtime)}</span>`
          : ''
      }
    `;

    item.addEventListener('click', () => {
      player.goToChapter(i);
      highlightActiveChapter(i);
      closeChapterSheet();
    });

    li.appendChild(item);
    ul.appendChild(li);
  });

  chapterList.appendChild(ul);
}

function highlightActiveChapter(index) {
  chapterList.querySelectorAll('.chapter-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  const active = chapterList.querySelector(`.chapter-item[data-index="${index}"]`);
  active?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- Player setup ---

function loadBookIntoPlayer(book, sectionIndex, startTime) {
  player.load(book, book.sections || [], sectionIndex, startTime);
  showPlayerBar(book);
  startProgressSaving();
}

function showPlayerBar(book) {
  playerBar.classList.remove('hidden');
  playerTitle.textContent = book.title;
}

function saveCurrentProgress() {
  if (!currentBook) return;
  saveProgress(currentBook.id, player.currentIndex, player.currentTime, {
    title: currentBook.title,
    author: currentBook.creator,
    coverUrl: getCoverUrl(currentBook),
    totalSections: player.sections.length
  });
}

function startProgressSaving() {
  clearInterval(progressTimer);
  progressTimer = setInterval(saveCurrentProgress, PROGRESS_INTERVAL_MS);
}

// --- Player bar event handlers ---

// Click, not pointerdown. Keyboard activation calls click().
btnPlayPause.addEventListener('click', () => {
  player.togglePlayPause();
});

btnPrev.addEventListener('click', () => {
  player.prevChapter();
});

btnNext.addEventListener('click', () => {
  player.nextChapter();
});

seekBar.addEventListener('pointerdown', () => {
  isSeeking = true;
});
seekBar.addEventListener('pointerup', () => {
  isSeeking = false;
});
seekBar.addEventListener('pointercancel', () => {
  isSeeking = false;
});
seekBar.addEventListener('input', () => {
  const t = (parseFloat(seekBar.value) / 1000) * player.duration;
  timeDisplay.textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
});
seekBar.addEventListener('change', () => {
  isSeeking = false;
  player.seek((parseFloat(seekBar.value) / 1000) * player.duration);
});

speedSelect.addEventListener('change', () => {
  player.setSpeed(parseFloat(speedSelect.value));
});

// --- Player callbacks ---

player.onStateChange = ({ playing, currentTime, duration }) => {
  if (playing) window.heymingAchievements?.unlockForCurrentApp('first-action');
  btnPlayPause.textContent = playing ? '⏸' : '▶';
  btnPlayPause.setAttribute('aria-label', playing ? 'Pause' : 'Play');

  if (!isSeeking) {
    seekBar.value = duration > 0 ? String(Math.round((currentTime / duration) * 1000)) : '0';
    timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }
};

player.onChapterChange = (index) => {
  const section = player.currentSection;
  playerChapter.textContent = section?.title || `Chapter ${index + 1}`;
  highlightActiveChapter(index);
  // Persist immediately so a refresh right after skipping to a new
  // chapter (before the 5s interval fires) still restores correctly.
  saveCurrentProgress();
};

// Only fires when the final chapter ends — the player advances itself
// through every earlier chapter without emitting this.
player.onEnded = () => {
  if (!currentBook) return;
  clearProgress(currentBook.id);
  showToast('Audiobook finished!', 'success');
  window.heymingAchievements?.unlockForCurrentApp('book-finished');
};

// Save progress on pause
audioEl.addEventListener('pause', () => {
  saveCurrentProgress();
  renderContinueSection();
});

// Flush save on tab close / navigate away / iOS background. The 5s
// interval + pause-event save wouldn't catch a refresh mid-chapter
// while audio is playing. Three overlapping signals cover the browsers
// that only fire one of pagehide/beforeunload/visibilitychange reliably.
window.addEventListener('pagehide', saveCurrentProgress);
window.addEventListener('beforeunload', saveCurrentProgress);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrentProgress();
});

// --- Chapter sheet ---

function openChapterSheet() {
  chapterSheet.classList.remove('hidden');
  chapterSheetOverlay.classList.remove('hidden');
  // Scroll the active chapter into view inside the sheet
  requestAnimationFrame(() => {
    const active = chapterList.querySelector('.chapter-item.active');
    (active || btnCloseChapters).focus({ preventScroll: true });
    active?.scrollIntoView?.({ block: 'center' });
  });
}

function closeChapterSheet() {
  const restore = chapterSheet.contains(document.activeElement);
  chapterSheet.classList.add('hidden');
  chapterSheetOverlay.classList.add('hidden');
  if (restore) (playerBar.classList.contains('hidden') ? btnOpenChapters : btnPlayPause).focus();
}

btnOpenChapters.addEventListener('click', openChapterSheet);
btnCloseChapters.addEventListener('click', closeChapterSheet);
btnChaptersPlayer.addEventListener('click', openChapterSheet);
chapterSheetOverlay.addEventListener('click', closeChapterSheet);
chapterSheet.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeChapterSheet();
});

// --- View navigation ---

backBtn.addEventListener('click', () => {
  closeChapterSheet();
  detailView.classList.add('hidden');
  browseView.classList.remove('hidden');
  setBookIdInUrl(null);
  renderContinueSection();
});

searchInput.addEventListener('input', handleSearchInput);

searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const query = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (!query) {
    focusFirstCard(document.getElementById('browse-view'));
    return;
  }
  runSearch(query).then(() => focusFirstCard(searchResultsGrid, true));
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchResultsSection.classList.add('hidden');
  searchInput.focus();
});

// --- Init ---

async function restoreBookFromUrl() {
  const identifier = getBookIdFromUrl();
  if (!identifier) return;
  setLoading(true);
  try {
    const data = await iaMetadata(identifier);
    const meta = data.metadata || {};
    const book = normalizeBook({
      identifier,
      title: meta.title || identifier,
      creator: meta.creator,
      description: meta.description
    });
    await openBook(book);
  } catch {
    // Bad ID or offline — drop the param so a stale link doesn't stick.
    setBookIdInUrl(null);
    showToast('Could not open that book.', 'error');
  } finally {
    setLoading(false);
  }
}

renderContinueSection();
renderBrowse();
restoreBookFromUrl();
