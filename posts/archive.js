/**
 * Archive / Browse panel for the Posts board.
 * Factory takes injected deps so index stays the orchestrator.
 */

import { formatWhen, previewText } from './feed.js';

/**
 * @typedef {{
 *   id: string,
 *   ts: number,
 *   text: string,
 *   attachments: Array<string|{blob?: Blob, url: string, revoke?: boolean}>,
 *   email: string,
 *   x?: number,
 *   y?: number,
 *   draft?: boolean,
 *   pending?: boolean,
 *   pinning?: boolean
 * }} Post
 */

/**
 * @typedef {{
 *   els: {
 *     board: HTMLElement|null,
 *     archiveBtn: HTMLElement|null,
 *     archiveClose: HTMLElement|null,
 *     archivePanel: HTMLElement|null,
 *     archiveBackdrop: HTMLElement|null,
 *     archiveList: HTMLElement|null,
 *     archiveSearch: HTMLInputElement|null,
 *     jumpNewest: HTMLElement|null,
 *     tidyBtn: HTMLElement|null,
 *     lightbox: HTMLElement|null,
 *     lightboxImg: HTMLImageElement|null
 *   },
 *   partitionPosts: () => {
 *     board: Post[],
 *     archive: Post[],
 *     all: Post[],
 *     newestPublished: Post|null
 *   },
 *   livePost: (id: string) => Post|null,
 *   displayPosition: (post: Post) => { x: number, y: number },
 *   panCameraToNormalized: (x: number, y: number) => void,
 *   openLightbox: (src: string) => void,
 *   setStatus: (msg: string, isError?: boolean) => void,
 *   flashElement: (el: HTMLElement) => void,
 *   getLayoutMode: () => 'scatter'|'tidy',
 *   getPendingFocusPostId: () => string|null,
 *   setPendingFocusPostId: (id: string|null) => void
 * }} ArchiveDeps
 */

/**
 * @param {ArchiveDeps} deps
 */
export function createArchive(deps) {
  let archiveOpen = false;
  let archiveQuery = '';

  function isOpen() {
    return archiveOpen;
  }

  /**
   * @param {Post[]} all
   */
  function renderArchiveList(all) {
    if (!deps.els.archiveList) return;
    if (!archiveOpen) {
      deps.els.archiveList.replaceChildren();
      return;
    }
    deps.els.archiveList.replaceChildren();
    const matches = archiveQuery
      ? all.filter((post) => `${post.text} ${post.email}`.toLowerCase().includes(archiveQuery))
      : all;

    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'archive-empty';
      if (archiveQuery) empty.textContent = `No posts match “${archiveQuery}”.`;
      else empty.textContent = 'No posts yet.';
      deps.els.archiveList.append(empty);
      return;
    }

    for (const post of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'archive-item';
      btn.dataset.archiveId = post.id;
      btn.setAttribute('role', 'listitem');

      const thumb = document.createElement('div');
      const first = post.attachments.find((item) => typeof item === 'string');
      if (typeof first === 'string' && first.startsWith('data:audio/')) {
        thumb.className = 'archive-thumb audio';
        thumb.textContent = 'Audio';
      } else if (typeof first === 'string') {
        thumb.className = 'archive-thumb';
        const img = document.createElement('img');
        img.src = first;
        img.alt = '';
        img.loading = 'lazy';
        thumb.append(img);
      } else {
        thumb.className = 'archive-thumb blank';
        thumb.textContent = 'Note';
      }

      const body = document.createElement('div');
      body.className = 'archive-item-body';
      const when = document.createElement('span');
      when.className = 'archive-item-when';
      when.textContent = formatWhen(post.ts);
      const text = document.createElement('p');
      text.className = 'archive-item-text';
      text.textContent = previewText(post.text) || '(attachment only)';
      body.append(when, text);
      if (post.email) {
        const author = document.createElement('span');
        author.className = 'archive-item-author';
        author.textContent = post.email;
        body.append(author);
      }

      btn.append(thumb, body);
      btn.addEventListener('click', () => {
        const onBoard = deps.els.board?.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`);
        if (onBoard) focusBoardPost(post.id);
        else openArchiveReader(post);
      });
      deps.els.archiveList.append(btn);
    }
  }

  /**
   * @param {number} totalCount
   * @param {Post|null} newestPublished
   */
  function updateChromeActions(totalCount, newestPublished) {
    if (deps.els.archiveBtn) {
      deps.els.archiveBtn.hidden = totalCount === 0 && !archiveOpen;
      deps.els.archiveBtn.textContent = totalCount ? `Browse (${totalCount})` : 'Browse';
      deps.els.archiveBtn.setAttribute('aria-expanded', archiveOpen ? 'true' : 'false');
    }
    if (deps.els.jumpNewest) {
      deps.els.jumpNewest.hidden = !newestPublished;
    }
    if (deps.els.tidyBtn) {
      const tidy = deps.getLayoutMode() === 'tidy';
      deps.els.tidyBtn.textContent = tidy ? 'Scatter' : 'Tidy';
      deps.els.tidyBtn.setAttribute('aria-pressed', tidy ? 'true' : 'false');
      deps.els.tidyBtn.title = tidy
        ? 'Scatter the notes back across the cork'
        : 'Stack every note in a neat grid, newest first';
    }
  }

  function setupArchiveUi() {
    deps.els.archiveBtn?.addEventListener('click', () => {
      if (archiveOpen) closeArchive();
      else openArchive();
    });
    deps.els.archiveClose?.addEventListener('click', () => closeArchive());
    deps.els.archiveBackdrop?.addEventListener('click', () => closeArchive());
    deps.els.archiveSearch?.addEventListener('input', () => {
      archiveQuery = (deps.els.archiveSearch?.value || '').trim().toLowerCase();
      renderArchiveList(deps.partitionPosts().all);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && archiveOpen) closeArchive();
    });
  }

  function openArchive() {
    archiveOpen = true;
    if (deps.els.archivePanel) deps.els.archivePanel.hidden = false;
    if (deps.els.archiveBackdrop) deps.els.archiveBackdrop.hidden = false;
    if (deps.els.archiveBtn) deps.els.archiveBtn.setAttribute('aria-expanded', 'true');
    const all = deps.partitionPosts().all;
    renderArchiveList(all);
    window.trackEvent?.('posts_browse_open', 'Engagement', String(all.length));
  }

  function closeArchive() {
    archiveOpen = false;
    archiveQuery = '';
    if (deps.els.archivePanel) deps.els.archivePanel.hidden = true;
    if (deps.els.archiveBackdrop) deps.els.archiveBackdrop.hidden = true;
    if (deps.els.archiveBtn) deps.els.archiveBtn.setAttribute('aria-expanded', 'false');
    if (deps.els.archiveSearch) deps.els.archiveSearch.value = '';
    if (deps.els.archiveList) deps.els.archiveList.replaceChildren();
  }

  /** @param {Post} post */
  function openArchiveReader(post) {
    if (!deps.els.lightbox || !deps.els.lightboxImg) return;

    const urls = post.attachments.filter((item) => typeof item === 'string');
    const image = urls.find((src) => typeof src === 'string' && !src.startsWith('data:audio/'));
    if (typeof image === 'string') {
      deps.openLightbox(image);
    }

    const snippet = previewText(post.text);
    deps.setStatus(
      snippet
        ? `${formatWhen(post.ts)} — ${snippet.slice(0, 120)}${snippet.length > 120 ? '…' : ''}`
        : `Archived note from ${formatWhen(post.ts)}`
    );

    const url = new URL(window.location.href);
    url.searchParams.set('post', post.id);
    history.replaceState({}, '', `${url.pathname}?post=${encodeURIComponent(post.id)}`);
    window.trackEvent?.('posts_browse_read', 'Engagement', post.id);
  }

  function jumpToNewest() {
    const { newestPublished } = deps.partitionPosts();
    if (!newestPublished) {
      deps.setStatus('No pinned notes yet', true);
      return;
    }
    focusBoardPost(newestPublished.id);
  }

  function maybeFocusPendingPost() {
    const pending = deps.getPendingFocusPostId();
    if (!pending) return;
    deps.setPendingFocusPostId(null);
    focusBoardPost(pending);
  }

  /** @param {string} id */
  function focusBoardPost(id) {
    const onBoard = deps.els.board?.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    if (onBoard instanceof HTMLElement) {
      closeArchive();
      const post = deps.livePost(id);
      if (post) {
        const position = deps.displayPosition(post);
        deps.panCameraToNormalized(position.x, position.y);
      }
      deps.flashElement(onBoard);
      onBoard.focus({ preventScroll: true });
      deps.setStatus('Found that note');
      return true;
    }

    const archived = deps.partitionPosts().archive.find((post) => post.id === id);
    if (archived) {
      openArchive();
      requestAnimationFrame(() => {
        const row = deps.els.archiveList?.querySelector(`[data-archive-id="${CSS.escape(id)}"]`);
        if (row instanceof HTMLElement) {
          row.scrollIntoView({ block: 'nearest' });
          deps.flashElement(row);
          row.focus();
        }
      });
      deps.setStatus('That note is in Browse');
      return true;
    }

    deps.setStatus('Could not find that note', true);
    return false;
  }

  return {
    isOpen,
    setupArchiveUi,
    openArchive,
    closeArchive,
    renderArchiveList,
    updateChromeActions,
    openArchiveReader,
    jumpToNewest,
    maybeFocusPendingPost,
    focusBoardPost
  };
}
