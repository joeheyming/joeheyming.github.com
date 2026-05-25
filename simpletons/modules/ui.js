/**
 * UI side-effects for Simpleton TV.
 *
 * Pure DOM wiring — keeps the entry script slim. Knows about:
 *   - loading + no-signal overlays
 *   - the title + "now playing" marquee
 *   - copy + share buttons
 *   - season-chip + episode-grid rendering and selection
 */

/** @typedef {import('./catalog.js').Catalog} Catalog */
/** @typedef {import('./catalog.js').Episode} Episode */
/** @typedef {import('./catalog.js').Season} Season */

/** @param {boolean} visible */
export function setLoadingVisible(visible) {
  const el = document.getElementById('tv-loading');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/** @param {string} message */
export function showNoSignal(message) {
  setLoadingVisible(false);
  const el = document.getElementById('tv-no-signal');
  if (!el) return;
  el.classList.remove('hidden');
  const detail = el.querySelector('.tv-overlay-detail');
  if (detail && message) detail.textContent = message;
}

/** @param {boolean} visible */
export function setNoSignalVisible(visible) {
  const el = document.getElementById('tv-no-signal');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/**
 * Render the row of season chips. Returns a setter that updates which chip
 * is marked as selected.
 *
 * @param {HTMLElement} container
 * @param {Season[]} seasons
 * @param {Episode|null} movie
 * @param {(seasonNumber: number) => void} onSelect  0 means the movie row.
 */
export function renderSeasonChips(container, seasons, movie, onSelect) {
  container.replaceChildren();

  if (movie) {
    container.appendChild(makeChip('🎬 Movie', 0, onSelect));
  }
  for (const s of seasons) {
    container.appendChild(makeChip(`S${String(s.number).padStart(2, '0')}`, s.number, onSelect));
  }

  /** @param {number} seasonNumber */
  return function setActiveSeason(seasonNumber) {
    for (const btn of container.querySelectorAll('.tv-chip')) {
      const n = Number(btn.getAttribute('data-season'));
      btn.classList.toggle('is-active', n === seasonNumber);
      if (n === seasonNumber) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  };
}

/**
 * @param {string} label
 * @param {number} seasonNumber
 * @param {(seasonNumber: number) => void} onSelect
 */
function makeChip(label, seasonNumber, onSelect) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tv-chip';
  btn.setAttribute('data-season', String(seasonNumber));
  btn.textContent = label;
  btn.addEventListener('click', () => onSelect(seasonNumber));
  return btn;
}

/**
 * Render the episode grid for one season (or the single movie row).
 *
 * @param {HTMLElement} container
 * @param {Episode[]} episodes
 * @param {(ep: Episode) => void} onSelect
 */
export function renderEpisodes(container, episodes, onSelect) {
  container.replaceChildren();

  for (const ep of episodes) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tv-ep-card';
    card.setAttribute('data-season', String(ep.season));
    card.setAttribute('data-episode', String(ep.episode));

    const thumb = document.createElement('div');
    thumb.className = 'tv-ep-thumb';
    // Prefer the TVMaze still (curated promo frame) over the archive's
    // auto-sampled thumbnail. Both can legitimately be missing — we fall
    // back to a 📺 glyph so the card never shows a broken-image icon.
    const imgSrc = ep.image || ep.thumbUrl;
    if (imgSrc) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = imgSrc;
      img.alt = '';
      // If TVMaze 404s the image, fall back to the archive.org thumb so
      // the slot doesn't go empty mid-session.
      if (ep.image && ep.thumbUrl && ep.image !== ep.thumbUrl) {
        img.addEventListener(
          'error',
          () => {
            if (img.src !== ep.thumbUrl) img.src = ep.thumbUrl;
          },
          { once: true }
        );
      }
      thumb.appendChild(img);
    } else {
      thumb.classList.add('is-empty');
      thumb.textContent = '📺';
    }

    const playGlyph = document.createElement('span');
    playGlyph.className = 'tv-ep-play';
    playGlyph.textContent = '▶';
    thumb.appendChild(playGlyph);

    const meta = document.createElement('div');
    meta.className = 'tv-ep-meta';

    const epNum = document.createElement('span');
    epNum.className = 'tv-ep-num';
    epNum.textContent = ep.season === 0 ? 'Movie' : `S${pad(ep.season)}E${pad(ep.episode)}`;

    const title = document.createElement('span');
    title.className = 'tv-ep-title';
    title.textContent = ep.title || `Episode ${ep.episode}`;

    meta.appendChild(epNum);
    meta.appendChild(title);

    card.appendChild(thumb);
    card.appendChild(meta);

    card.addEventListener('click', () => onSelect(ep));

    container.appendChild(card);
  }

  // Note: we deliberately do not scrollIntoView the active card. When the
  // user taps a card it's already on screen, and when they hit Next/Prev
  // we want the page to scroll up to the video (handled in index.js),
  // not down to the newly-active card.
  /** @param {Episode|null} ep */
  return function setActiveEpisode(ep) {
    for (const card of container.querySelectorAll('.tv-ep-card')) {
      const isActive =
        ep != null &&
        Number(card.getAttribute('data-season')) === ep.season &&
        Number(card.getAttribute('data-episode')) === ep.episode;
      card.classList.toggle('is-active', isActive);
    }
  };
}

/**
 * Update the "now playing" marquee, TV label, and the description card.
 *
 * @param {Episode|null} ep
 */
export function updateMarquee(ep) {
  const titleEl = document.getElementById('tv-title');
  const subEl = document.getElementById('tv-subtitle');
  const chip = document.getElementById('tv-channel-chip');
  if (titleEl) titleEl.textContent = ep ? ep.title || `Episode ${ep.episode}` : '—';
  if (subEl) subEl.textContent = formatSubtitle(ep);
  if (chip) {
    chip.textContent = ep && ep.season > 0 ? `S${pad(ep.season)}E${pad(ep.episode)}` : 'MOV';
  }
  updateSummary(ep);
}

/** @param {Episode|null} ep */
function formatSubtitle(ep) {
  if (!ep) return 'No signal';
  if (ep.season === 0) return 'Feature film · The Simpsons Movie';
  const base = `Season ${ep.season} · Episode ${ep.episode}`;
  return ep.airdate ? `${base} · Aired ${formatAirdate(ep.airdate)}` : base;
}

/**
 * Show / hide the description card under the marquee depending on whether
 * we have a TVMaze summary for this episode.
 *
 * @param {Episode|null} ep
 */
function updateSummary(ep) {
  const card = document.getElementById('tv-summary');
  const text = document.getElementById('tv-summary-text');
  if (!card || !text) return;
  const summary = (ep && ep.description) || '';
  if (!summary) {
    card.classList.add('hidden');
    text.textContent = '';
    return;
  }
  text.textContent = summary;
  card.classList.remove('hidden');
}

/**
 * Turn "1989-12-17" into "Dec 17, 1989". Falls back to the raw string on
 * any parse failure so we don't end up showing "Invalid Date" in the UI.
 *
 * @param {string} iso
 */
function formatAirdate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return iso;
  }
}

/**
 * Hook up the copy-link / copy-title buttons.
 *
 * @param {() => Episode|null} getCurrent
 */
export function bindCopyButtons(getCurrent) {
  const linkBtn = document.getElementById('tv-copy-link');
  const titleBtn = document.getElementById('tv-copy-title');

  linkBtn?.addEventListener('click', async () => {
    const ep = getCurrent();
    if (!ep) return;
    await copy(ep.archiveUrl, 'LINK COPIED', 'COPY FAILED');
  });
  titleBtn?.addEventListener('click', async () => {
    const ep = getCurrent();
    if (!ep) return;
    const label = describeEpisode(ep);
    await copy(label, 'TITLE COPIED', 'COPY FAILED');
  });
}

/**
 * Wire the global <share-button> custom element. The custom element may not
 * yet be defined at this point — we set the textGenerator callback eagerly
 * and the element pulls from it whenever the user hits Share.
 *
 * @param {() => Episode|null} getCurrent
 */
export function bindShareButton(getCurrent) {
  const shareBtn = document.querySelector('share-button');
  if (!shareBtn) return;
  shareBtn.textGenerator = () => {
    const ep = getCurrent();
    if (!ep) return 'Simpleton TV — stream the Simpletons archive in your browser';
    return `Watching ${describeEpisode(ep)} on Simpleton TV — ${location.href}`;
  };
}

/**
 * Flash a short message in the marquee, then restore via the callback.
 *
 * @param {string} msg
 * @param {() => string} [restore]
 */
function flashMarquee(msg, restore) {
  const marquee = document.getElementById('tv-marquee');
  const titleEl = document.getElementById('tv-title');
  if (!marquee || !titleEl) return;
  const previous = titleEl.textContent || '';
  marquee.classList.add('is-flashing');
  titleEl.textContent = msg;
  window.clearTimeout(flashMarquee._t);
  flashMarquee._t = window.setTimeout(() => {
    marquee.classList.remove('is-flashing');
    titleEl.textContent = restore ? restore() : previous;
  }, 1800);
}

/** @param {string} text @param {string} okMsg @param {string} errMsg */
async function copy(text, okMsg, errMsg) {
  try {
    await navigator.clipboard.writeText(text);
    flashMarquee(okMsg);
  } catch {
    flashMarquee(errMsg);
  }
}

/** @param {Episode} ep */
function describeEpisode(ep) {
  if (ep.season === 0) return 'The Simpsons Movie';
  const tag = `S${pad(ep.season)}E${pad(ep.episode)}`;
  return ep.title ? `${tag} — ${ep.title}` : tag;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export { describeEpisode, flashMarquee };
