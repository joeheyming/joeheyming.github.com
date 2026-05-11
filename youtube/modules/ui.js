/**
 * UI side-effects: loading states, marquee title, copy buttons, share button.
 * Keeps the entry script slim and the carousel module pure.
 */

/** @param {boolean} visible */
export function setLoadingVisible(visible) {
  const el = document.getElementById('crt-loading');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/** @param {boolean} visible */
export function setStaticVisible(visible) {
  const el = document.getElementById('crt-static');
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/**
 * Display a "No signal" style error overlay on the screen.
 * @param {string} message
 */
export function showNoSignal(message) {
  setLoadingVisible(false);
  setStaticVisible(false);
  const el = document.getElementById('crt-no-signal');
  if (!el) return;
  el.classList.remove('hidden');
  const detail = el.querySelector('.crt-no-signal-detail');
  if (detail && message) {
    detail.textContent = message;
  }
}

/**
 * Bind the marquee to the carousel's current video.
 * @param {import('./carousel.js').Carousel} carousel
 */
export function bindMarquee(carousel) {
  const titleEl = document.getElementById('crt-title');
  const youtubeLink = document.getElementById('crt-youtube-link');
  if (!titleEl) return;

  carousel.onChange((video) => {
    titleEl.textContent = video.title;
    if (youtubeLink) youtubeLink.href = video.url;
    // Mirror to window for share-button + analytics consumers
    window.currentVideoData = { url: video.url, title: video.title };
    window.currentSlide = carousel.currentIndex;
  });
}

/**
 * Wire the copy-link and copy-title buttons.
 * @param {import('./carousel.js').Carousel} carousel
 */
export function bindCopyButtons(carousel) {
  const linkBtn = document.getElementById('crt-copy-link');
  const titleBtn = document.getElementById('crt-copy-title');

  linkBtn?.addEventListener('click', async () => {
    const v = carousel.currentVideo;
    if (!v) return;
    await copyToClipboard(v.url, 'LINK COPIED', 'COPY FAILED');
  });

  titleBtn?.addEventListener('click', async () => {
    const v = carousel.currentVideo;
    if (!v) return;
    await copyToClipboard(v.title, 'TITLE COPIED', 'COPY FAILED');
  });
}

/**
 * Wire the global <share-button> custom element to the current video title.
 * Custom element may not yet be defined — wire defensively.
 */
export function bindShareButton(carousel) {
  const shareBtn = document.querySelector('share-button');
  if (!shareBtn) return;
  shareBtn.textGenerator = () => {
    const v = carousel.currentVideo;
    return v
      ? `Check out "${v.title}" on JoeTube — ${v.url}`
      : 'Check out JoeTube — a retro YouTube carousel by Joe Heyming';
  };
}

/**
 * Flash a green message in the marquee for a few seconds, then restore the
 * current video title. Useful for "LINK COPIED" toasts etc.
 *
 * @param {string} message
 * @param {() => string} restore Callback returning the title to restore after.
 */
export function flashMarquee(message, restore) {
  const marquee = document.getElementById('crt-marquee');
  const titleEl = document.getElementById('crt-title');
  if (!marquee || !titleEl) return;

  const previous = titleEl.textContent;
  marquee.classList.add('is-flashing');
  titleEl.textContent = message;

  window.clearTimeout(flashMarquee._timer);
  flashMarquee._timer = window.setTimeout(() => {
    marquee.classList.remove('is-flashing');
    titleEl.textContent = restore ? restore() : previous || '';
  }, 1800);
}

/** @param {string} text @param {string} okMsg @param {string} errMsg */
async function copyToClipboard(text, okMsg, errMsg) {
  try {
    await navigator.clipboard.writeText(text);
    flashMarquee(okMsg);
  } catch {
    flashMarquee(errMsg);
  }
}
