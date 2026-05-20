const SHELF_KEY = 'heyming.books.shelf.v1';
const SCROLL_KEY = 'heyming.books.scroll.v1';

function loadShelfData() {
  try {
    return JSON.parse(localStorage.getItem(SHELF_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveShelfData(data) {
  try {
    localStorage.setItem(SHELF_KEY, JSON.stringify(data));
  } catch {
    // quota or private mode
  }
}

export function saveToShelf(book) {
  const shelf = loadShelfData();
  const id = String(book.id);
  shelf[id] = {
    id,
    title: book.title || '',
    author: (book.authors || []).map((a) => a.name || '').join(', '),
    coverUrl: getCoverUrl(book),
    formats: book.formats || {},
    lastOpened: Date.now(),
  };
  saveShelfData(shelf);
}

export function getRecentBooks(limit = 12) {
  const shelf = loadShelfData();
  return Object.values(shelf)
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, limit);
}

export function removeFromShelf(bookId) {
  const shelf = loadShelfData();
  delete shelf[String(bookId)];
  saveShelfData(shelf);
}

export function saveScrollPosition(bookId, position) {
  try {
    const data = JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}');
    data[String(bookId)] = { position, savedAt: Date.now() };
    localStorage.setItem(SCROLL_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function getScrollPosition(bookId) {
  try {
    const data = JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}');
    return data[String(bookId)]?.position ?? 0;
  } catch {
    return 0;
  }
}

function getCoverUrl(book) {
  const formats = book.formats || {};
  const coverKey = Object.keys(formats).find(
    (k) => k.startsWith('image/') || k === 'image/jpeg' || k === 'image/png'
  );
  return coverKey ? formats[coverKey] : null;
}
