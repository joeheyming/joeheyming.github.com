const ZENIUS_V52 = 'https://zenius-i-vanisher.com/v5.2/';

/**
 * Links under the "Menu" heading on the simfiles home page (simfiles.php).
 * @param {Document} doc
 * @returns {Array<{ label: string, href: string }>}
 */
function extractSimfilesMenuLinks(doc) {
  const headings = doc.querySelectorAll('h2');
  /** @type {Element|null} */
  let menuH = null;
  for (const h of headings) {
    const t = h.textContent.replace(/\s+/g, ' ').trim();
    if (t.match(/^Menu\b/i)) {
      menuH = h;
      break;
    }
  }
  if (!menuH) {
    return [];
  }

  const out = [];
  const seen = new Set();
  const FLAG_FOLLOW = Node.DOCUMENT_POSITION_FOLLOWING;

  const tryAddAnchor = (a) => {
    if (!(a instanceof HTMLAnchorElement)) {
      return;
    }
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      return;
    }
    const label = a.textContent.replace(/\s+/g, ' ').trim();
    if (!label) {
      return;
    }
    let abs;
    try {
      abs = new URL(href, ZENIUS_V52);
    } catch {
      return;
    }
    if (!abs.hostname.includes('zenius-i-vanisher.com')) {
      return;
    }
    if (seen.has(abs.href)) {
      return;
    }
    seen.add(abs.href);
    out.push({ label, href: abs.href });
  };

  let el = menuH.nextElementSibling;
  while (el) {
    if (el.tagName === 'H2' || el.tagName === 'H1') {
      break;
    }
    const anchors =
      el.tagName === 'A' && el.getAttribute('href') ? [el] : el.querySelectorAll('a[href]');
    for (const a of anchors) {
      tryAddAnchor(/** @type {Element} */ (a));
    }
    el = el.nextElementSibling;
  }

  // Table layout: links often sit in the same cell as the “Menu” heading
  if (out.length === 0 && menuH.parentElement) {
    for (const a of menuH.parentElement.querySelectorAll('a[href]')) {
      if (menuH.compareDocumentPosition(a) & FLAG_FOLLOW) {
        tryAddAnchor(/** @type {Element} */ (a));
      }
    }
  }

  return out;
}

/** @param {Document} doc */
function extractSimfilesCategoryLinksFromPage(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="simfiles.php?category="]')) {
    if (!(a instanceof HTMLAnchorElement)) {
      continue;
    }
    const href = a.getAttribute('href');
    if (!href) {
      continue;
    }
    let abs;
    try {
      abs = new URL(href, ZENIUS_V52);
    } catch {
      continue;
    }
    if (!abs.hostname.includes('zenius-i-vanisher.com')) {
      continue;
    }
    const cat = abs.searchParams.get('category') || '';
    if (!cat || cat === 'simfiles' || cat === 'help') {
      continue;
    }
    if (seen.has(abs.href)) {
      continue;
    }
    const label = a.textContent.replace(/\s+/g, ' ').trim() || cat;
    seen.add(abs.href);
    out.push({ label, href: abs.href });
  }
  return out;
}

/**
 * @param {Array<{ label: string, href: string }>} menuFirst
 * @param {Array<{ label: string, href: string }>} fromAnchors
 * @returns {Array<{ label: string, href: string }>}
 */
function mergeMenuAndCategoryLinkLabels(menuFirst, fromAnchors) {
  const byHref = new Map();
  for (const x of fromAnchors) {
    byHref.set(x.href, { label: x.label, href: x.href });
  }
  for (const x of menuFirst) {
    const prev = byHref.get(x.href);
    if (!prev || (x.label && x.label.length > (prev.label || '').length)) {
      byHref.set(x.href, { label: x.label, href: x.href });
    }
  }
  return Array.from(byHref.values());
}

/** @param {string} label */
function isSpotlightListLabel(label) {
  const t = label.replace(/\s+/g, ' ').toLowerCase();
  if (t.length < 6) {
    return false;
  }
  if (t === 'help' || /^\s*help(\s+|$)/.test(t)) {
    return false;
  }
  if (
    (t.includes('view simfile') && !t.includes('latest') && !t.includes('top')) ||
    t === 'view simfiles'
  ) {
    return false;
  }
  const hasLatest = t.includes('latest');
  const hasTop = /\btop\b/.test(t);
  const hasOfficial = t.includes('official');
  const hasUser = /\buser\b/.test(t);
  return (hasLatest || hasTop) && (hasOfficial || hasUser);
}

/**
 * @param {string} label
 * @returns {number}
 */
function spotlightRankForSort(label) {
  const t = label.toLowerCase();
  if (t.includes('latest') && t.includes('official')) {
    return 0;
  }
  if (t.includes('latest') && t.includes('user')) {
    return 1;
  }
  if (t.includes('top') && t.includes('official')) {
    return 2;
  }
  if (t.includes('top') && t.includes('user')) {
    return 3;
  }
  return 10;
}

/**
 * @param {string} href
 * @returns {number}
 */
function spotlightRankFromHref(href) {
  const u = href.toLowerCase();
  const m = u.match(/[?&]category=([^&]+)/);
  const c = m ? m[1] : '';
  if (c.includes('latest') && c.includes('official')) {
    return 0;
  }
  if (c.includes('latest') && c.includes('user')) {
    return 1;
  }
  if (c.includes('top') && c.includes('official')) {
    return 2;
  }
  if (c.includes('top') && c.includes('user')) {
    return 3;
  }
  return 10;
}

/**
 * @param {Array<{ label: string, href: string }>} links
 */
function selectSpotlightSourceLinks(links) {
  const picked = links.filter((l) => isSpotlightListLabel(l.label));
  picked.sort((a, b) => {
    const d = spotlightRankForSort(a.label) - spotlightRankForSort(b.label);
    if (d !== 0) {
      return d;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  const byRank = new Map();
  for (const p of picked) {
    const r = spotlightRankForSort(p.label);
    if (r < 4 && r >= 0 && !byRank.has(r)) {
      byRank.set(r, p);
    }
  }
  let inOrder = [0, 1, 2, 3].map((r) => byRank.get(r)).filter(Boolean);
  if (inOrder.length < 3) {
    const byH = new Map();
    for (const p of links) {
      const r = spotlightRankFromHref(p.href);
      if (r < 4 && r >= 0 && !byH.has(r)) {
        byH.set(r, p);
      }
    }
    inOrder = [0, 1, 2, 3].map((r) => byH.get(r)).filter(Boolean);
  }
  return inOrder;
}

export const SPOTLIGHT_TOP_N = 10;

/**
 * @param {Document} doc
 * @param {{ type: string, items: Array<Record<string, unknown>> }} content
 */
export function appendSimfileTableItemsToContent(doc, content) {
  const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');
  if (simfileLinks.length === 0) {
    return;
  }
  content.type = 'simfiles';

  const difficultyNames = ['Beginner', 'Basic', 'Difficult', 'Expert', 'Challenge'];
  const difficultyShort = ['B', 'L', 'S', 'H', 'C'];

  simfileLinks.forEach((link) => {
    const href = link.getAttribute('href');
    const text = link.textContent.trim();
    if (href && text && !text.includes('Download') && !text.includes('MB')) {
      const urlParams = new URLSearchParams(href.split('?')[1] || '');
      const simfileId = urlParams.get('simfileid');

      if (simfileId) {
        const row = link.closest('tr');
        let hasVideo = false;
        let difficulties = [];

        if (row) {
          const rowHtml = row.innerHTML;
          hasVideo =
            rowHtml.includes('Vid Exist') ||
            rowHtml.includes('[V]') ||
            rowHtml.toLowerCase().includes('.avi');

          const cells = row.querySelectorAll('td');
          let diffIndex = 0;

          cells.forEach((cell) => {
            const cellText = cell.textContent.trim();
            const numMatch = cellText.match(/^(\d{1,2})$/);
            if (numMatch) {
              const rating = parseInt(numMatch[1]);
              if (rating >= 1 && rating <= 20) {
                let diffName = difficultyNames[diffIndex % 5] || 'Unknown';
                let diffShort = difficultyShort[diffIndex % 5] || '?';

                const title = cell.getAttribute('title') || '';
                for (let i = 0; i < difficultyNames.length; i++) {
                  if (title.toLowerCase().includes(difficultyNames[i].toLowerCase())) {
                    diffName = difficultyNames[i];
                    diffShort = difficultyShort[i];
                    break;
                  }
                }

                const img = cell.querySelector('img');
                if (img) {
                  const src = img.getAttribute('src') || '';
                  if (src.includes('beginner')) {
                    diffName = 'Beginner';
                    diffShort = 'B';
                  } else if (src.includes('light') || src.includes('basic')) {
                    diffName = 'Basic';
                    diffShort = 'L';
                  } else if (src.includes('standard') || src.includes('difficult')) {
                    diffName = 'Difficult';
                    diffShort = 'S';
                  } else if (src.includes('heavy') || src.includes('expert')) {
                    diffName = 'Expert';
                    diffShort = 'H';
                  } else if (src.includes('challenge') || src.includes('oni')) {
                    diffName = 'Challenge';
                    diffShort = 'C';
                  }
                }

                difficulties.push({
                  rating: rating,
                  name: diffName,
                  short: diffShort
                });
                diffIndex++;
              }
            }
          });
        }

        content.items.push({
          type: 'simfile',
          name: text,
          url: href,
          icon: hasVideo ? '🎬' : '🎵',
          simfileId: simfileId,
          hasVideo: hasVideo,
          difficulties: difficulties
        });
      }
    }
  });
}

export function parseZeniusHtmlContent(html, currentPath) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const content = {
    type: 'unknown',
    items: [],
    /** @type {Array<{ label: string, href: string }>|undefined} */
    menuLinks: undefined,
    /** @type {Array<{ label: string, href: string }>|undefined} */
    spotlightSourceLinks: undefined
  };

  if (currentPath === '') {
    content.menuLinks = extractSimfilesMenuLinks(doc);
    const merged = mergeMenuAndCategoryLinkLabels(
      content.menuLinks,
      extractSimfilesCategoryLinksFromPage(doc)
    );
    content.spotlightSourceLinks = selectSpotlightSourceLinks(merged);
    const options = doc.querySelectorAll('option');
    options.forEach((option) => {
      const value = option.getAttribute('value');
      const text = option.textContent.trim();

      if (
        value &&
        text &&
        text.length > 0 &&
        value !== 'simfiles' &&
        text !== 'Select Simfile Category'
      ) {
        content.items.push({
          type: 'directory',
          name: text,
          url: `viewsimfilecategory.php?categoryid=${value}`,
          icon: '📁',
          categoryId: value
        });
      }
    });

    if (content.items.length > 0) {
      content.type = 'directories';
    }
  } else {
    appendSimfileTableItemsToContent(doc, content);
  }

  return content;
}

export function parseZeniusSearchResults(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results = [];

  // Zenius AJAX search results are in tables
  // Columns: Name (0), SP difficulties (1), DP difficulties (2), Category (3)
  // The link title attribute contains "Song Name / Artist"
  const simfileLinks = doc.querySelectorAll('a[href*="viewsimfile.php"]');

  simfileLinks.forEach((link) => {
    const href = link.getAttribute('href');
    const text = link.textContent.trim();
    const title = link.getAttribute('title') || '';

    // Skip download links and file size text
    if (href && text && !text.includes('Download') && !text.includes('MB') && text.length > 0) {
      const urlParams = new URLSearchParams(href.split('?')[1] || '');
      const simfileId = urlParams.get('simfileid');

      if (simfileId) {
        // Extract artist from title attribute (format: "Song Name / Artist")
        let artist = '';
        if (title && title.includes(' / ')) {
          const parts = title.split(' / ');
          if (parts.length >= 2) {
            artist = parts.slice(1).join(' / '); // Handle artists with " / " in name
          }
        }

        // Get data from the parent row
        const row = link.closest('tr');
        let category = '';
        let spDifficulties = '';
        let dpDifficulties = '';

        let categoryId = '';

        if (row) {
          const cells = row.querySelectorAll('td');
          // Columns: Name (0), SP (1), DP (2), Category (3)
          if (cells.length >= 2) {
            spDifficulties = cells[1]?.textContent?.trim() || '';
          }
          if (cells.length >= 3) {
            dpDifficulties = cells[2]?.textContent?.trim() || '';
          }
          if (cells.length >= 4) {
            const categoryLink = cells[3]?.querySelector('a[href*="viewsimfilecategory"]');
            if (categoryLink) {
              category = categoryLink.textContent.trim();
              // Extract category ID from the href
              const categoryHref = categoryLink.getAttribute('href') || '';
              const categoryParams = new URLSearchParams(categoryHref.split('?')[1] || '');
              categoryId = categoryParams.get('categoryid') || '';
            }
          }
        }

        results.push({
          type: 'simfile',
          name: text,
          artist: artist,
          category: category,
          categoryId: categoryId,
          spDifficulties: spDifficulties,
          dpDifficulties: dpDifficulties,
          url: href,
          icon: '🎵',
          simfileId: simfileId,
          hasVideo: false,
          difficulties: []
        });
      }
    }
  });

  return results;
}
