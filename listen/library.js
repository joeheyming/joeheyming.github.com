const STORAGE_KEY = 'heyming.audiobooks.v1';

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLibrary(lib) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    // quota or private mode — ignore
  }
}

export function saveProgress(bookId, sectionIndex, position, bookMeta) {
  const lib = loadLibrary();
  lib[String(bookId)] = {
    sectionIndex,
    position,
    lastPlayed: Date.now(),
    title: bookMeta?.title || '',
    author: bookMeta?.author || '',
    coverUrl: bookMeta?.coverUrl || '',
    totalSections: bookMeta?.totalSections || 0,
  };
  saveLibrary(lib);
}

export function getBookProgress(bookId) {
  return loadLibrary()[String(bookId)] || null;
}

export function getRecentBooks(limit = 8) {
  const lib = loadLibrary();
  return Object.entries(lib)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, limit);
}

export function clearProgress(bookId) {
  const lib = loadLibrary();
  delete lib[String(bookId)];
  saveLibrary(lib);
}
