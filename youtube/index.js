/**
 * JoeTube entry module.
 *
 * Loaded as `<script type="module">` from index.html.  Responsibilities:
 *   1. Pull the latest video list from YouTube via the proxy.
 *   2. Hand the videos to the Carousel.
 *   3. Wire UI side-effects (marquee, copy buttons, share, error states).
 *   4. Bind keyboard + button event listeners.
 */

import { loadVideos } from './modules/channel.js';
import { Carousel } from './modules/carousel.js';
import {
  setLoadingVisible,
  setStaticVisible,
  showNoSignal,
  bindMarquee,
  bindCopyButtons,
  bindShareButton
} from './modules/ui.js';

function $(id) {
  return document.getElementById(id);
}

async function main() {
  setLoadingVisible(true);
  setStaticVisible(true);

  // Build the carousel up front so its DOM elements exist even if fetch fails
  const carousel = new Carousel({
    track: $('carousel-track'),
    channelValue: $('crt-channel-value'),
    channelTotal: $('crt-channel-total'),
    knob: $('crt-knob')
  });

  // Wire UI side-effects that don't depend on having videos yet
  bindMarquee(carousel);
  bindCopyButtons(carousel);
  bindShareButton(carousel);

  // Mirror current channel to the small bezel chip
  const bezelChip = $('crt-bezel-channel');
  if (bezelChip) {
    carousel.onChange((_v, i) => {
      bezelChip.textContent = `CH ${String(i + 1).padStart(2, '0')}`;
    });
  }

  // Wire buttons
  $('crt-prev')?.addEventListener('click', () => carousel.prev());
  $('crt-next')?.addEventListener('click', () => carousel.next());
  $('crt-ch-up')?.addEventListener('click', () => carousel.next());
  $('crt-ch-down')?.addEventListener('click', () => carousel.prev());
  $('crt-shuffle')?.addEventListener('click', () => carousel.shuffle());
  $('crt-knob')?.addEventListener('click', () => carousel.shuffle());

  // Keyboard nav (ignored when typing in form fields)
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    }
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        carousel.prev();
        break;
      case 'ArrowRight':
        e.preventDefault();
        carousel.next();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        carousel.shuffle();
        break;
    }
  });

  let videos;
  try {
    videos = await loadVideos();
  } catch (err) {
    showNoSignal(
      `Could not reach the channel — ${err && err.message ? err.message : 'unknown error'}`
    );
    return;
  }

  if (!videos || videos.length === 0) {
    showNoSignal('Channel loaded, but no videos were found.');
    return;
  }

  carousel.setVideos(videos);
  setLoadingVisible(false);
  setStaticVisible(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
