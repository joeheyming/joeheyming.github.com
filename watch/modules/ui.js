/**
 * Shared UI primitives for /watch/ views.
 *
 * View modules (`shows-view`, `episodes-view`, `watch-view`) own their
 * own DOM trees; the helpers in this file are the reusable building
 * blocks they assemble from — season chips, episode cards, the
 * "now playing" marquee, the description card, and a flash message.
 *
 * Nothing here owns global elements; everything either creates new
 * nodes or accepts a container the caller already has a reference to.
 */

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./catalog.js').Catalog} Catalog */
/** @typedef {import('./catalog.js').Episode} Episode */
/** @typedef {import('./catalog.js').Season} Season */

/* ============================================================
 * Season chips + episode grid
 * ============================================================ */

/**
 * Render the row of season chips into `container`. Returns a setter
 * that updates which chip is marked as selected.
 *
 * @param {HTMLElement} container
 * @param {Season[]} seasons
 * @param {Episode|null} movie
 * @param {(seasonNumber: number) => void} onSelect   0 = movie / specials row.
 */
export function renderSeasonChips(container, seasons, movie, onSelect) {
  container.replaceChildren();
  if (movie) {
    container.appendChild(makeChip('🎬 Movie', 0, onSelect));
  }
  for (const s of seasons) {
    const label = s.number === 0 ? 'Specials' : `S${String(s.number).padStart(2, '0')}`;
    container.appendChild(makeChip(label, s.number, onSelect));
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
 * Render an episode grid into `container`.
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
    const imgSrc = ep.image || ep.thumbUrl;
    if (imgSrc) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = imgSrc;
      img.alt = '';
      // If the TVMaze still 404s, fall back to the archive thumb so
      // the card never shows a broken-image icon.
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
    epNum.textContent = ep.season === 0 ? 'Special' : `S${pad(ep.season)}E${pad(ep.episode)}`;

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

/* ============================================================
 * Marquee + summary
 * ============================================================ */

/**
 * Build a marquee element. Returns the root + setter helpers so the
 * watch view can update content as the user steps between episodes
 * without re-mounting the whole player.
 */
export function createMarquee() {
  const root = document.createElement('div');
  root.className = 'tv-marquee';
  root.setAttribute('aria-live', 'polite');

  const tag = document.createElement('span');
  tag.className = 'tv-now-tag';
  const dot = document.createElement('span');
  dot.className = 'tv-rec-dot';
  dot.setAttribute('aria-hidden', 'true');
  tag.appendChild(dot);
  tag.appendChild(document.createTextNode(' NOW PLAYING'));

  const stack = document.createElement('span');
  stack.className = 'tv-now-stack';
  const title = document.createElement('span');
  title.className = 'tv-title';
  title.textContent = '—';
  const subtitle = document.createElement('span');
  subtitle.className = 'tv-subtitle';
  subtitle.textContent = 'Tuning…';
  stack.appendChild(title);
  stack.appendChild(subtitle);

  root.appendChild(tag);
  root.appendChild(stack);

  return {
    root,
    /** @param {ShowConfig|null} show @param {Episode|null} ep */
    update(show, ep) {
      title.textContent = ep ? ep.title || `Episode ${ep.episode}` : '—';
      subtitle.textContent = formatSubtitle(show, ep);
    },
    flash(msg, restore) {
      const prev = title.textContent || '';
      root.classList.add('is-flashing');
      title.textContent = msg;
      window.clearTimeout(/** @type {any} */ (root)._flashT);
      /** @type {any} */ (root)._flashT = window.setTimeout(() => {
        root.classList.remove('is-flashing');
        title.textContent = restore ? restore() : prev;
      }, 1800);
    }
  };
}

/** @param {ShowConfig|null} show @param {Episode|null} ep */
function formatSubtitle(show, ep) {
  if (!ep) return 'No signal';
  if (ep.season === 0 && show?.movieDetector) return 'Feature film';
  if (ep.season === 0) return `Special · Episode ${ep.episode}`;
  const base = `Season ${ep.season} · Episode ${ep.episode}`;
  return ep.airdate ? `${base} · Aired ${formatAirdate(ep.airdate)}` : base;
}

/** Build a description card (TVMaze synopsis). Hidden until you call `update`. */
export function createSummaryCard() {
  const aside = document.createElement('aside');
  aside.className = 'tv-summary hidden';
  aside.setAttribute('aria-live', 'polite');
  const p = document.createElement('p');
  p.className = 'tv-summary-text';
  aside.appendChild(p);
  return {
    root: aside,
    /** @param {Episode|null} ep */
    update(ep) {
      const summary = (ep && ep.description) || '';
      if (!summary) {
        aside.classList.add('hidden');
        p.textContent = '';
        return;
      }
      p.textContent = summary;
      aside.classList.remove('hidden');
    }
  };
}

/* ============================================================
 * Misc helpers
 * ============================================================ */

/** Turn "1989-12-17" into "Dec 17, 1989". Falls back to raw on parse failure. */
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

/** Build a human label for an episode. Used by share-button + copy. */
export function describeEpisode(show, ep) {
  if (!ep) return show ? show.name : 'Watch';
  const showLabel = show ? show.name : 'Watch';
  if (ep.season === 0 && show?.movieDetector) {
    return show.movieTitle || `${showLabel} — movie`;
  }
  const tag = `S${pad(ep.season)}E${pad(ep.episode)}`;
  const inner = ep.title ? `${tag} — ${ep.title}` : tag;
  return `${showLabel} · ${inner}`;
}

/**
 * Copy text to the clipboard and flash a status into the supplied
 * marquee. Returns once the flash starts (does not await the timeout).
 *
 * @param {string} text
 * @param {{ flash: (m: string) => void }} marquee
 * @param {string} okMsg
 * @param {string} errMsg
 */
export async function copyToClipboard(text, marquee, okMsg, errMsg) {
  try {
    await navigator.clipboard.writeText(text);
    marquee.flash(okMsg);
  } catch {
    marquee.flash(errMsg);
  }
}

export function pad(n) {
  return String(n).padStart(2, '0');
}
