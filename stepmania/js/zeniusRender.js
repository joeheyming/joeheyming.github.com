import {
  getRecentSongs,
  getFavorites,
  isFavoriteSimfileId,
  toggleFavorite
} from './zeniusLibraryStorage.js';
import { fetchTopSimfilesFromListUrl } from './zeniusFetch.js';
import { SPOTLIGHT_TOP_N } from './zeniusParsers.js';

function trackZeniusBrowserEvent(eventName, label, value) {
  if (typeof window.trackEvent === 'function') {
    window.trackEvent(eventName, 'StepMania', label, value);
  }
}

function resetZeniusMainScroll(browser) {
  const pane = browser.shadowRoot.getElementById('zenius-main-scroll');
  if (pane) {
    pane.scrollTop = 0;
  }
}

export function isZeniusSearchHome(browser) {
  return (
    browser._searchMode === 'zenius' &&
    browser.currentPath === '' &&
    !browser._favoritesViewActive &&
    browser._lastListPath !== 'search'
  );
}

export function updateZeniusBrowserLayout(browser) {
  const body = browser.shadowRoot.querySelector('.modal-body');
  const searchHome = browser.shadowRoot.getElementById('zenius-search-home');
  const stats = browser.shadowRoot.getElementById('stats');
  const browseBtn = browser.shadowRoot.getElementById('zenius-browse-categories-btn');
  const isHome = isZeniusSearchHome(browser);

  if (body) {
    body.classList.toggle('is-search-home', isHome);
  }
  if (searchHome) {
    searchHome.hidden = !isHome;
  }
  if (stats) {
    stats.classList.toggle('hidden', isHome);
  }
  if (browseBtn && typeof browser.getCurrentUrl === 'function') {
    const content = browser.cache.get(browser.getCurrentUrl());
    const count = content?.items?.length ?? 0;
    browseBtn.textContent =
      count > 0 ? `📂 Browse all collections (${count})` : '📂 Browse all collections';
  }
}

export const ZENIUS_BROWSER_SHADOW_HTML = `      <style>
        /* Critical FOUC guard — must keep the modal OUT OF FLOW before
           adoptSharedStyles() finishes. opacity/visibility alone still
           size the host (~460px) and crush #sm-micro (lab CLS ~0.57). */
        :host { display: inline-block; vertical-align: middle; }
        .zenius-browser-container { display: flex; }
        .modal {
          position: fixed;
          inset: 0;
          display: flex;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 100;
        }
        .modal.show {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }
      </style>
      <div class="zenius-browser-container">
        <button class="zenius-browser-btn" id="open-zenius-browser">
          <span class="icon-only">🎵</span>
          <span class="text-label">Songs</span>
        </button>
      </div>
      
      <div class="modal" id="zenius-browser-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Song Library Browser</h2>
          </div>
          
          <div class="modal-body">
            <div class="search-container">
              <div class="search-tabs">
                <button class="search-tab active" id="zenius-search-tab" data-mode="zenius">Search</button>
                <button class="search-tab" id="local-search-tab" data-mode="local">Category</button>
              </div>
              <div class="search-fields hidden" id="local-search-fields">
                <div class="breadcrumb" id="breadcrumb">
                  <span class="breadcrumb-item" data-path="">🏠 Home</span>
                </div>
                <p class="category-filter-hint" id="category-filter-hint">
                  Filter applies only to <strong>pages you have already opened</strong> this session. Use Search for the full site index.
                </p>
                <input 
                  type="text" 
                  class="search-input" 
                  id="search-input" 
                  placeholder="Filter loaded songs and folders in cache…"
                >
              </div>
              <div class="search-fields" id="zenius-search-fields">
                <input 
                  type="text" 
                  class="search-input" 
                  id="zenius-song-title" 
                  placeholder="Song title..."
                >
                <input 
                  type="text" 
                  class="search-input" 
                  id="zenius-song-artist" 
                  placeholder="Artist (optional)..."
                >
                <button class="search-btn" id="zenius-search-btn">🔍 Search</button>
              </div>
            </div>

            <div class="zenius-main-scroll" id="zenius-main-scroll">
              <div class="list-toolbar hidden" id="list-toolbar" aria-label="List options">
                <label class="list-toolbar-label" for="zenius-sort-select">Sort</label>
                <select class="zenius-sort-select" id="zenius-sort-select" title="Sort current list">
                  <option value="name-asc">A–Z</option>
                  <option value="name-desc">Z–A</option>
                  <option value="video-first">Video first</option>
                </select>
              </div>

              <div class="stats" id="stats">
                <span id="item-count">0 items</span>
                <span id="current-path">Home</span>
              </div>

              <div class="zenius-search-home" id="zenius-search-home" hidden>
                <p class="zenius-search-home-lead">
                  Search above, or pick from the latest lists and recent plays below.
                </p>
                <button type="button" class="zenius-browse-categories-btn" id="zenius-browse-categories-btn">
                  📂 Browse all collections
                </button>
              </div>

              <div class="content-grid" id="content-grid">
                <!-- Content will be populated here -->
              </div>

              <div class="loading-indicator" id="loading-indicator">
                <div class="spinner"></div>
                <p class="loading-text" id="loading-text">Loading content...</p>
                <div class="loading-progress">
                  <div class="loading-progress-bar" id="loading-progress-bar"></div>
                </div>
              </div>
            </div>

            <div class="zenius-helper-panel" id="zenius-helper-panel">
              <div class="zenius-spotlight" id="zenius-spotlight" hidden>
                <p class="zenius-spotlight-hint" id="zenius-spotlight-hint" hidden>Loading lists…</p>
                <div id="zenius-spotlight-sections" class="zenius-spotlight-sections"></div>
              </div>

              <div class="zenius-secondary-row" id="zenius-secondary-row">
                <div class="zenius-recent-block" id="zenius-recent-block">
                  <span class="zenius-recent-label">Recent</span>
                  <div class="zenius-recent-chips" id="zenius-recent-chips" role="list"></div>
                </div>
                <button type="button" class="zenius-saved-btn" id="zenius-saved-btn" title="Songs you starred">
                  Saved
                </button>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <div class="action-buttons">
              <button class="close-btn" id="close-zenius-browser">Close</button>
            </div>
          </div>
        </div>
      </div>`;

export function createZeniusContentCard(browser, item, currentPath) {
  if (item.type === 'simfile') {
    const fullZeniusUrl = item.url.startsWith('http')
      ? item.url
      : `https://zenius-i-vanisher.com/v5.2/${item.url}`;
    const qs = new URLSearchParams();
    qs.set('zenius', fullZeniusUrl);
    const gameUrl = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;

    const card = document.createElement('div');
    card.className = 'content-item simfile-card';

    // Check cached metadata for this simfile (set when song was loaded)
    const cachedMeta = browser.constructor.getSimfileMetadata(item.simfileId);

    // Use cached data if available, otherwise use what we parsed from the category page
    const hasVideo = cachedMeta?.hasVideo || item.hasVideo;
    const difficulties =
      cachedMeta?.difficulties && cachedMeta.difficulties.length > 0
        ? cachedMeta.difficulties
        : item.difficulties;
    const icon = hasVideo ? '🎬' : '🎵';

    // Build badges for video and difficulties
    let badges = '';
    if (hasVideo) {
      badges += '<span class="badge badge-video" title="Has Video">🎬 Video</span>';
    }
    if (difficulties && difficulties.length > 0) {
      const diffBadges = difficulties
        .map((d) => {
          const shortCode = d.short ? d.short.toLowerCase() : 'u';
          const tooltip = d.name ? `${d.name} (${d.rating})` : `Level ${d.rating}`;
          return `<span class="badge badge-diff badge-diff-${shortCode}" title="${tooltip}">${d.rating}</span>`;
        })
        .join('');
      badges += diffBadges;
    }

    // Build subtitle with artist and category (for search results)
    let subtitle = '';
    if (item.artist || item.category) {
      const parts = [];
      if (item.artist) parts.push(`🎤 ${item.artist}`);
      if (item.category) parts.push(`📁 ${item.category}`);
      subtitle = `<p class="simfile-subtitle">${parts.join(' • ')}</p>`;
    }

    const mainLink = document.createElement('a');
    mainLink.href = gameUrl;
    mainLink.className = 'content-item-body';
    mainLink.innerHTML = `
    <div class="content-icon">${icon}</div>
    <div class="content-info">
      <h3>${item.name}</h3>
      ${subtitle}
      <div class="simfile-badges">${badges}</div>
    </div>
  `;

    const showZeniusLink = currentPath !== 'spotlight';
    let ext = null;
    if (showZeniusLink) {
      const extEl = document.createElement('a');
      extEl.href = fullZeniusUrl;
      extEl.target = '_blank';
      extEl.rel = 'noopener noreferrer';
      extEl.className = 'simfile-external-link';
      extEl.title = 'View on Zenius-I-Vanisher';
      extEl.textContent = '🔗';
      extEl.addEventListener('click', (e) => e.stopPropagation());
      ext = extEl;
    }

    mainLink.addEventListener('click', () => {
      if (currentPath === 'spotlight') {
        trackZeniusBrowserEvent('zenius_spotlight_song_click', item.name);
      } else {
        trackZeniusBrowserEvent('song_browser_song_select', item.name);
      }
      if (browser.currentPath.startsWith('categoryid=')) {
        browser.lastBrowsedCategoryId = browser.currentPath.replace('categoryid=', '');
        browser.lastBrowsedCategoryName = browser.currentCategoryName;
      } else if (item.categoryId) {
        browser.lastBrowsedCategoryId = item.categoryId;
        browser.lastBrowsedCategoryName = item.category || 'Category';
      }
    });

    const favorited = isFavoriteSimfileId(item.simfileId);
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'fav-btn';
    favBtn.setAttribute('aria-label', favorited ? 'Remove from saved' : 'Save song');
    favBtn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
    favBtn.textContent = favorited ? '★' : '☆';
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nowOn = toggleFavorite({
        simfileId: item.simfileId,
        zeniusUrl: fullZeniusUrl,
        title: item.name
      });
      favBtn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
      favBtn.setAttribute('aria-label', nowOn ? 'Remove from saved' : 'Save song');
      favBtn.textContent = nowOn ? '★' : '☆';
      updateZeniusSavedButtonLabel(browser);
    });
    card.appendChild(mainLink);
    if (ext) {
      card.appendChild(ext);
    }
    card.appendChild(favBtn);

    return card;
  } else {
    const itemEl = document.createElement('div');
    itemEl.className = 'content-item';

    itemEl.innerHTML = `
    <div class="content-icon">${item.icon}</div>
    <div class="content-info">
      <h3>${item.name}</h3>
      <p>Collection</p>
    </div>
  `;

    itemEl.addEventListener('click', () => {
      if (item.type === 'directory') {
        if (typeof window.trackEvent === 'function') {
          window.trackEvent('song_browser_category_click', 'StepMania', item.name);
        }

        itemEl.classList.add('loading');
        itemEl.innerHTML = `
        <div class="content-icon">⏳</div>
        <div class="content-info">
          <h3>${item.name}</h3>
          <p>Loading...</p>
        </div>
      `;

        if (item.categoryId) {
          browser.currentCategoryName = item.name;
          browser.navigateToPath(`categoryid=${item.categoryId}`);
        }
      }
    });

    return itemEl;
  }
}

export async function runZeniusSpotlight(browser, sourceLinks) {
  const wrap = browser.shadowRoot.getElementById('zenius-spotlight');
  const sections = browser.shadowRoot.getElementById('zenius-spotlight-sections');
  const hint = browser.shadowRoot.getElementById('zenius-spotlight-hint');
  if (!wrap || !sections) {
    return;
  }
  browser._spotlightAbort?.abort();
  browser._spotlightAbort = new AbortController();
  const { signal } = browser._spotlightAbort;

  const toLoad = sourceLinks;
  if (!toLoad || toLoad.length === 0) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  sections.innerHTML = '';
  if (hint) {
    hint.hidden = false;
    hint.textContent = 'Loading latest & top lists…';
  }
  try {
    const results = await Promise.all(
      toLoad.map(async ({ href, label }) => {
        const items = await fetchTopSimfilesFromListUrl(href, SPOTLIGHT_TOP_N, signal);
        return { href, label, items };
      })
    );
    if (signal.aborted) {
      return;
    }
    if (hint) {
      hint.hidden = true;
    }
    for (const { href, label, items } of results) {
      const sec = document.createElement('section');
      sec.className = 'zenius-spotlight-section';
      const h = document.createElement('h3');
      h.className = 'zenius-spotlight-title';
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zenius-spotlight-title-link';
      link.textContent = label;
      link.addEventListener('click', () => {
        trackZeniusBrowserEvent('zenius_spotlight_link_click', label);
      });
      h.appendChild(link);
      sec.appendChild(h);
      if (items.length === 0) {
        const p = document.createElement('p');
        p.className = 'zenius-spotlight-empty';
        p.textContent = 'No rows parsed for this list.';
        sec.appendChild(p);
      } else {
        const grid = document.createElement('div');
        grid.className = 'zenius-spotlight-grid';
        for (const item of items) {
          if (item && item.type === 'simfile') {
            grid.appendChild(
              createZeniusContentCard(
                browser,
                /** @type {Record<string, unknown>} */ (item),
                'spotlight'
              )
            );
          }
        }
        sec.appendChild(grid);
      }
      sections.appendChild(sec);
      trackZeniusBrowserEvent('zenius_spotlight_list', label);
    }
  } catch (e) {
    if (e && /** @type {Error} */ (e).name === 'AbortError') {
      return;
    }
    console.error('Simfile spotlight load failed', e);
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Some Zenius lists could not load. Try again later.';
    }
  }
}

export function displayZeniusGridContent(browser, content, path) {
  if (
    path === '' &&
    content &&
    content.spotlightSourceLinks &&
    content.spotlightSourceLinks.length > 0
  ) {
    browser._lastSpotlightSourceLinks = content.spotlightSourceLinks;
    void browser.startSimfileSpotlight(browser._lastSpotlightSourceLinks);
  } else if (path === '') {
    const s = browser.shadowRoot.getElementById('zenius-spotlight');
    if (s) {
      s.hidden = true;
    }
  }

  const gridEl = browser.shadowRoot.getElementById('content-grid');
  gridEl.innerHTML = '';

  // Defensive check for missing or empty content
  const items = content?.items || [];
  if (items.length === 0) {
    browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    gridEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📂</div>
      <h3>No content found</h3>
      <p>This directory appears to be empty or the content couldn't be parsed.</p>
    </div>
  `;
    browser.updateStats();
    return;
  }

  const onlySimfiles = items.every((i) => i.type === 'simfile');
  const onlyDirs = items.length > 0 && items.every((i) => i.type === 'directory');

  if (path === '' && onlyDirs && browser._searchMode === 'zenius') {
    gridEl.innerHTML = '';
    browser._lastSimfileListForSort = [];
    browser._lastListPath = '';
    browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    updateZeniusBrowserLayout(browser);
    browser.updateStats();
    return;
  }

  if (onlySimfiles) {
    browser._lastSimfileListForSort = items.map((i) => ({ ...i }));
    browser._lastListPath = path;
    browser.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
    const sorted = browser.applySortToSimfiles(browser._lastSimfileListForSort);
    sorted.forEach((item) => {
      gridEl.appendChild(createZeniusContentCard(browser, item, path));
    });
  } else {
    browser._lastSimfileListForSort = [];
    browser._lastListPath = path;
    browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    const sortedItems = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    sortedItems.forEach((item) => {
      gridEl.appendChild(createZeniusContentCard(browser, item, path));
    });
  }

  if (!onlyDirs) {
    browser.initGridRovingTabIndex();
  }
  browser.updateStats();
  updateZeniusBrowserLayout(browser);
}

export function displayZeniusSearchResultsGrid(browser, results, itemPath = '') {
  browser._favoritesViewActive = false;
  browser._lastSimfileListForSort = results.map((r) => ({ ...r }));
  browser._lastListPath = itemPath && itemPath.length > 0 ? itemPath : 'search';
  const gridEl = browser.shadowRoot.getElementById('content-grid');
  gridEl.innerHTML = '';

  if (results.length === 0) {
    browser.setZeniusSpotlightUiVisible(false);
    browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    gridEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <h3>No results found</h3>
      <p>Try adjusting your search terms.</p>
    </div>
  `;
    browser.initGridRovingTabIndex();
    resetZeniusMainScroll(browser);
    updateZeniusBrowserLayout(browser);
    return;
  }

  browser.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
  const sortedResults = browser.applySortToSimfiles(browser._lastSimfileListForSort);
  sortedResults.forEach((item) => {
    const itemEl = createZeniusContentCard(browser, item, itemPath);
    gridEl.appendChild(itemEl);
  });
  browser.initGridRovingTabIndex();
  browser.setZeniusSpotlightUiVisible(false);
  resetZeniusMainScroll(browser);
  updateZeniusBrowserLayout(browser);
}

export function showZeniusLoadingOverlay(browser, text) {
  const loadingEl = browser.shadowRoot.getElementById('loading-indicator');
  const textEl = browser.shadowRoot.getElementById('loading-text');
  const progressBar = browser.shadowRoot.getElementById('loading-progress-bar');

  textEl.textContent = text;
  loadingEl.classList.add('show');
  progressBar.style.width = '0%';
}

export function hideZeniusLoadingOverlay(browser) {
  browser.shadowRoot.getElementById('loading-indicator').classList.remove('show');
}

export function showZeniusGridError(browser, message, retryCallback = null) {
  const gridEl = browser.shadowRoot.getElementById('content-grid');

  let errorHtml = `
  <div class="error-message">
    <strong>Error:</strong> ${message}
`;

  if (retryCallback) {
    errorHtml += `
    <div style="margin-top: 1rem;">
      <button class="retry-btn" id="retry-btn">
        🔄 Retry
      </button>
    </div>
  `;
  }

  errorHtml += `</div>`;

  gridEl.innerHTML = errorHtml;

  if (retryCallback) {
    const retryBtn = gridEl.querySelector('#retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', retryCallback);
    }
  }
}

export function showZeniusSearchEmptyState(browser, message) {
  browser.setZeniusSpotlightUiVisible(false);
  browser._lastSimfileListForSort = [];
  browser._lastListPath = 'search';
  browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
  const gridEl = browser.shadowRoot.getElementById('content-grid');
  gridEl.innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">🔍</div>
    <h3>No results</h3>
    <p class="search-empty-msg"></p>
  </div>
`;
  const p = gridEl.querySelector('.search-empty-msg');
  if (p) p.textContent = message;
  browser.initGridRovingTabIndex();
  resetZeniusMainScroll(browser);
  updateZeniusBrowserLayout(browser);
}

export function displayZeniusFavoritesGrid(browser) {
  browser._favoritesViewActive = true;
  browser.setZeniusSpotlightUiVisible(false);
  browser.setSearchMode('zenius');
  const favs = getFavorites();
  browser._lastSimfileListForSort = favs.map((f) => ({
    type: 'simfile',
    name: f.title,
    url: f.zeniusUrl,
    icon: '🎵',
    simfileId: f.simfileId,
    hasVideo: false,
    difficulties: []
  }));
  browser._lastListPath = 'favorites';
  browser.shadowRoot.getElementById('item-count').textContent = `${favs.length} items`;
  browser.shadowRoot.getElementById('current-path').textContent = 'Saved';
  browser.shadowRoot.getElementById('content-grid').innerHTML = '';
  browser.shadowRoot.getElementById('breadcrumb').innerHTML =
    '<span class="breadcrumb-item" data-path="">🏠 Home</span>';

  if (favs.length === 0) {
    browser.shadowRoot.getElementById('list-toolbar').classList.add('hidden');
    browser.shadowRoot.getElementById('content-grid').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⭐</div>
      <h3>No saved songs</h3>
      <p>Click the star on a song to add it to Saved. It stays on this device only.</p>
    </div>
  `;
    browser.initGridRovingTabIndex();
    updateZeniusBrowserLayout(browser);
    return;
  }

  browser.shadowRoot.getElementById('list-toolbar').classList.remove('hidden');
  const gridEl = browser.shadowRoot.getElementById('content-grid');
  browser.applySortToSimfiles(browser._lastSimfileListForSort).forEach((item) => {
    gridEl.appendChild(createZeniusContentCard(browser, item, ''));
  });
  browser.initGridRovingTabIndex();
  updateZeniusBrowserLayout(browser);
}

export function renderZeniusRecentChips(browser) {
  const wrap = browser.shadowRoot.getElementById('zenius-recent-chips');
  const block = browser.shadowRoot.getElementById('zenius-recent-block');
  if (!wrap || !block) {
    return;
  }
  const recent = getRecentSongs();
  wrap.innerHTML = '';
  if (recent.length === 0) {
    block.classList.add('empty');
  } else {
    block.classList.remove('empty');
    for (const r of recent) {
      const a = document.createElement('a');
      a.className = 'zenius-recent-chip';
      const qs = new URLSearchParams();
      qs.set('zenius', r.zeniusUrl);
      a.href = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;
      a.textContent = r.title;
      a.setAttribute('role', 'listitem');
      a.title = r.title;
      a.addEventListener('click', (ev) => {
        trackZeniusBrowserEvent('zenius_recent_click', r.title);
        ev.stopPropagation();
      });
      wrap.appendChild(a);
    }
  }
  updateZeniusSavedButtonLabel(browser);
}

export function updateZeniusSavedButtonLabel(browser) {
  const n = getFavorites().length;
  const btn = browser.shadowRoot.getElementById('zenius-saved-btn');
  if (btn) {
    btn.textContent = n > 0 ? `Saved (${n})` : 'Saved';
  }
}
