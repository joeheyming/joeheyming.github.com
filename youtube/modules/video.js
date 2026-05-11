/**
 * Video stage lifecycle. Each "stage" is a DOM container that swaps between:
 *   - thumbnail (lightweight, cheap)
 *   - iframe (heavy, only for the currently-viewed slide)
 *
 * The carousel calls loadIframe(slide) when it becomes the current slide,
 * and unloadIframe(slide) when navigating away.
 */

/** YouTube serves hqdefault.jpg (480x360) for every video — free + no API key. */
export function getThumbnailUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Build the slide DOM for a single video, with a clickable thumbnail.
 * Returns the .carousel-slide element.
 *
 * @param {{ videoId: string, title: string, url: string }} video
 * @param {number} index
 */
export function createSlide(video, index) {
  const slide = document.createElement('div');
  slide.className = 'carousel-slide';
  slide.dataset.videoId = video.videoId;
  slide.dataset.videoUrl = video.url;
  slide.dataset.videoTitle = video.title;
  slide.dataset.videoIndex = String(index);

  const stage = document.createElement('div');
  stage.className = 'video-stage';
  stage.setAttribute('role', 'button');
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('aria-label', `Play ${video.title}`);

  const img = document.createElement('img');
  img.className = 'video-thumb';
  img.src = getThumbnailUrl(video.videoId);
  img.alt = video.title;
  img.loading = 'lazy';
  img.decoding = 'async';

  const overlay = document.createElement('div');
  overlay.className = 'play-overlay';

  const playBtn = document.createElement('div');
  playBtn.className = 'play-button';
  playBtn.textContent = '▶';

  overlay.appendChild(playBtn);
  stage.appendChild(img);
  stage.appendChild(overlay);
  slide.appendChild(stage);

  return slide;
}

/**
 * Swap the slide's thumbnail for an autoplaying YouTube iframe.
 * Idempotent — calling twice does nothing.
 *
 * @param {HTMLElement} slide
 * @param {{ autoplay?: boolean }} [opts]
 */
export function loadIframe(slide, opts = {}) {
  if (!slide) return;
  const stage = slide.querySelector('.video-stage');
  if (!stage || stage.querySelector('iframe')) return;

  const videoId = slide.dataset.videoId;
  const title = slide.dataset.videoTitle || 'YouTube video';
  if (!videoId) return;

  const autoplay = opts.autoplay !== false ? 1 : 0;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=${autoplay}&mute=0`;
  iframe.title = title;
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  // Required when the host page sets COEP: credentialless
  iframe.setAttribute('credentialless', '');

  const host = document.createElement('div');
  host.className = 'video-iframe-host';
  host.appendChild(iframe);

  stage.replaceChildren(host);
  stage.removeAttribute('role');
  stage.removeAttribute('tabindex');
  stage.style.cursor = 'default';
}

/**
 * Revert the slide back to the thumbnail+play-button state, killing the iframe
 * so the video stops playing and audio mutes.
 *
 * @param {HTMLElement} slide
 */
export function unloadIframe(slide) {
  if (!slide) return;
  const stage = slide.querySelector('.video-stage');
  if (!stage || !stage.querySelector('iframe')) return;

  const videoId = slide.dataset.videoId;
  const title = slide.dataset.videoTitle || '';
  if (!videoId) return;

  const img = document.createElement('img');
  img.className = 'video-thumb';
  img.src = getThumbnailUrl(videoId);
  img.alt = title;
  img.loading = 'lazy';
  img.decoding = 'async';

  const overlay = document.createElement('div');
  overlay.className = 'play-overlay';
  const playBtn = document.createElement('div');
  playBtn.className = 'play-button';
  playBtn.textContent = '▶';
  overlay.appendChild(playBtn);

  stage.replaceChildren(img, overlay);
  stage.setAttribute('role', 'button');
  stage.setAttribute('tabindex', '0');
  stage.style.cursor = '';
}
