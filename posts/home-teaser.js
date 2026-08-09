/**
 * Home-page "Latest note" band — fetches once (and lightly refreshes)
 * without loading the full Posts board.
 */

import { fetchLatestPost, formatWhen, previewText } from './feed.js';

const REFRESH_MS = 90_000;
const TEASER_MAX = 160;

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @param {import('./feed.js').FeedPost} post
 * @param {HTMLElement} root
 */
function renderTeaser(post, root) {
  const when = root.querySelector('[data-posts-when]');
  const body = root.querySelector('[data-posts-body]');
  const view = root.querySelector('[data-posts-view]');
  const board = root.querySelector('[data-posts-board]');
  const snippet =
    truncate(previewText(post.text), TEASER_MAX) ||
    (post.hasAttachment ? 'Shared an attachment' : 'New note on the board');

  if (when) when.textContent = formatWhen(post.ts);
  if (body) body.textContent = snippet;
  if (view instanceof HTMLAnchorElement) {
    view.href = `/posts/?post=${encodeURIComponent(post.id)}`;
    view.hidden = false;
  }
  if (board instanceof HTMLAnchorElement) {
    board.href = '/posts/';
  }
  root.hidden = false;
}

async function refreshTeaser(root) {
  try {
    const post = await fetchLatestPost();
    if (!post) {
      root.hidden = true;
      return;
    }
    renderTeaser(post, root);
  } catch (err) {
    console.warn('[posts/home-teaser] fetch failed', err);
    // Keep last successful render if any; otherwise stay hidden.
  }
}

function init() {
  const root = document.getElementById('posts-teaser');
  if (!(root instanceof HTMLElement)) return;
  void refreshTeaser(root);
  setInterval(() => {
    if (document.hidden) return;
    void refreshTeaser(root);
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshTeaser(root);
  });
}

init();
