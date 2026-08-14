import * as THREE from 'three';
import { wrapText } from './util.js';

/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 */

/**
 * Live CRT canvas texture — idle “NOW PLAYING”, featured cycle, rewind gag, insert preview.
 * @returns {{
 *   material: THREE.MeshBasicMaterial,
 *   texture: THREE.CanvasTexture,
 *   update: (dt: number) => boolean,
 *   setFeaturedPool: (items: CatalogItem[]) => void,
 *   cycleFeatured: () => CatalogItem | null,
 *   getFeatured: () => CatalogItem | null,
 *   playRewind: (item: CatalogItem, onDone: () => void) => void,
 *   playPreview: (item: CatalogItem, onReadyToRent: () => void) => void,
 *   showRentPrompt: (item: CatalogItem) => void,
 *   getPreviewItem: () => CatalogItem | null,
 *   isBusy: () => boolean,
 *   resetIdle: () => void
 * }}
 */
export function createTvScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });

  /** @type {'idle'|'featured'|'rewind'|'preview'|'rentPrompt'} */
  let mode = 'idle';
  /** @type {CatalogItem[]} */
  let pool = [];
  /** @type {CatalogItem | null} */
  let featured = null;
  /** @type {CatalogItem | null} */
  let previewItem = null;
  let animT = 0;
  let featuredTimer = 0;
  /** @type {(() => void) | null} */
  let onRewindDone = null;
  /** @type {(() => void) | null} */
  let onPreviewReady = null;
  /** @type {HTMLImageElement | null} */
  let posterImg = null;
  let dirty = true;

  /** @param {CatalogItem[]} items */
  function setFeaturedPool(items) {
    pool = items.filter(Boolean);
    if (!featured && pool.length) {
      featured = pool[Math.floor(Math.random() * pool.length)];
      mode = 'featured';
      dirty = true;
      void loadPoster(featured);
    }
  }

  /** @returns {CatalogItem | null} */
  function cycleFeatured() {
    if (!pool.length) return null;
    const idx = featured ? pool.findIndex((i) => i.id === featured?.id) : -1;
    featured = pool[(idx + 1) % pool.length];
    mode = mode === 'idle' || mode === 'featured' ? 'featured' : mode;
    if (mode === 'featured') {
      featuredTimer = 0;
      dirty = true;
      void loadPoster(featured);
    }
    return featured;
  }

  /** @param {CatalogItem} item */
  async function loadPoster(item) {
    posterImg = null;
    let url = item.posterUrl || null;
    if (!url && item.tvmazeId) {
      try {
        const key = `heyming.watch.poster.${item.tvmazeId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached?.url) url = cached.url;
        }
      } catch {
        /* ignore */
      }
    }
    if (!url) {
      dirty = true;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (previewItem?.id === item.id || featured?.id === item.id) {
        posterImg = img;
        dirty = true;
      }
    };
    img.onerror = () => {
      dirty = true;
    };
    img.src = url;
  }

  /** @param {CatalogItem} item @param {() => void} onDone */
  function playRewind(item, onDone) {
    previewItem = item;
    mode = 'rewind';
    animT = 0;
    onRewindDone = onDone;
    dirty = true;
  }

  /** @param {CatalogItem} item @param {() => void} onReadyToRent */
  function playPreview(item, onReadyToRent) {
    previewItem = item;
    mode = 'preview';
    animT = 0;
    onPreviewReady = onReadyToRent;
    dirty = true;
    void loadPoster(item);
  }

  /** @param {CatalogItem} item */
  function showRentPrompt(item) {
    previewItem = item;
    mode = 'rentPrompt';
    animT = 0;
    dirty = true;
    void loadPoster(item);
  }

  function resetIdle() {
    mode = featured ? 'featured' : 'idle';
    previewItem = null;
    onRewindDone = null;
    onPreviewReady = null;
    dirty = true;
  }

  function drawScanlines(alpha = 0.18) {
    if (!ctx) return;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    for (let y = 0; y < 320; y += 4) ctx.fillRect(0, y, 512, 2);
  }

  function drawIdle() {
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 512, 320);
    g.addColorStop(0, '#0b1a33');
    g.addColorStop(1, '#123a6e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 320);
    drawScanlines();
    ctx.fillStyle = '#f5c518';
    ctx.font = '800 42px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOW PLAYING', 256, 130);
    ctx.fillStyle = '#d4e0f0';
    ctx.font = '600 22px Helvetica, Arial, sans-serif';
    ctx.fillText('Insert a tape to watch', 256, 185);
  }

  function drawFeatured() {
    if (!ctx || !featured) {
      drawIdle();
      return;
    }
    ctx.fillStyle = '#0a1428';
    ctx.fillRect(0, 0, 512, 320);
    if (posterImg) {
      const iw = posterImg.naturalWidth || 1;
      const ih = posterImg.naturalHeight || 1;
      const scale = Math.max(512 / iw, 320 / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(posterImg, (512 - dw) / 2, (320 - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = featured.accent || '#132844';
      ctx.fillRect(0, 0, 512, 320);
      ctx.font = '64px serif';
      ctx.textAlign = 'center';
      ctx.fillText(featured.emoji || '🎬', 256, 150);
    }
    drawScanlines(0.22);
    ctx.fillStyle = 'rgba(10,22,40,0.72)';
    ctx.fillRect(0, 220, 512, 100);
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 18px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FEATURED TONIGHT', 256, 242);
    ctx.fillStyle = '#f2ead8';
    ctx.font = '800 28px "Arial Black", Impact, sans-serif';
    const title = featured.shortName || featured.name;
    ctx.fillText(title.length > 22 ? `${title.slice(0, 20)}…` : title, 256, 278);
  }

  function drawRewind() {
    if (!ctx) return;
    const flicker = 0.5 + 0.5 * Math.sin(animT * 28);
    ctx.fillStyle = `rgb(${20 + flicker * 40}, ${12}, ${18})`;
    ctx.fillRect(0, 0, 512, 320);
    // Tangled “tape” scribble
    ctx.strokeStyle = `rgba(40,40,45,${0.7 + flicker * 0.3})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const x = 40 + ((i * 97 + animT * 180) % 430);
      const y = 40 + ((i * 53 + Math.sin(animT * 9 + i) * 40) % 240);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    drawScanlines(0.3);
    ctx.fillStyle = '#f5c518';
    ctx.font = '800 36px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BE KIND — REWIND', 256, 140);
    ctx.fillStyle = '#d4e0f0';
    ctx.font = '600 20px Helvetica, Arial, sans-serif';
    ctx.fillText('Tape is a little tangled…', 256, 195);
    // Progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(96, 250, 320, 10);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(96, 250, 320 * Math.min(1, animT / 2.6), 10);
  }

  function drawPreview() {
    if (!ctx || !previewItem) return;
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, 512, 320);
    if (posterImg) {
      const iw = posterImg.naturalWidth || 1;
      const ih = posterImg.naturalHeight || 1;
      const scale = Math.max(512 / iw, 320 / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      // Slow Ken Burns
      const zoom = 1 + Math.min(0.08, animT * 0.02);
      const ox = (512 - dw * zoom) / 2 + Math.sin(animT * 0.4) * 8;
      const oy = (320 - dh * zoom) / 2;
      ctx.drawImage(posterImg, ox, oy, dw * zoom, dh * zoom);
    } else {
      ctx.fillStyle = previewItem.accent || '#123a6e';
      ctx.fillRect(0, 0, 512, 320);
      ctx.font = '72px serif';
      ctx.textAlign = 'center';
      ctx.fillText(previewItem.emoji || '🎬', 256, 160);
    }
    // Rolling scan / snow flicker
    drawScanlines(0.15 + 0.08 * Math.sin(animT * 12));
    ctx.fillStyle = 'rgba(10,22,40,0.55)';
    ctx.fillRect(0, 0, 512, 48);
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 20px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶ PREVIEW', 256, 24);
    ctx.fillStyle = 'rgba(10,22,40,0.7)';
    ctx.fillRect(0, 260, 512, 60);
    ctx.fillStyle = '#f2ead8';
    ctx.font = '800 26px "Arial Black", Impact, sans-serif';
    const t = previewItem.shortName || previewItem.name;
    ctx.fillText(t.length > 24 ? `${t.slice(0, 22)}…` : t, 256, 290);
  }

  function drawRentPrompt() {
    if (!ctx || !previewItem) return;
    drawPreview();
    ctx.fillStyle = 'rgba(10,22,40,0.82)';
    ctx.fillRect(60, 100, 392, 120);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 3;
    ctx.strokeRect(60, 100, 392, 120);
    ctx.fillStyle = '#f5c518';
    ctx.font = '800 28px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('READY TO RENT', 256, 140);
    ctx.fillStyle = '#d4e0f0';
    ctx.font = '600 18px Helvetica, Arial, sans-serif';
    ctx.fillText('Press E · or click the TV', 256, 180);
  }

  function paint() {
    if (!ctx) return;
    if (mode === 'rewind') drawRewind();
    else if (mode === 'preview') drawPreview();
    else if (mode === 'rentPrompt') drawRentPrompt();
    else if (mode === 'featured') drawFeatured();
    else drawIdle();
    texture.needsUpdate = true;
    dirty = false;
  }

  /**
   * @param {number} dt
   * @returns {boolean} true if the texture changed (needs a render)
   */
  function update(dt) {
    let changed = dirty;
    if (mode === 'featured') {
      featuredTimer += dt;
      if (featuredTimer > 8 && pool.length > 1) {
        cycleFeatured();
        changed = true;
      }
    }
    if (mode === 'rewind') {
      animT += dt;
      changed = true;
      if (animT >= 2.6) {
        const cb = onRewindDone;
        onRewindDone = null;
        cb?.();
      }
    } else if (mode === 'preview') {
      animT += dt;
      changed = true;
      if (animT >= 3.2) {
        mode = 'rentPrompt';
        animT = 0;
        const cb = onPreviewReady;
        onPreviewReady = null;
        cb?.();
      }
    } else if (mode === 'rentPrompt') {
      animT += dt;
      // Gentle pulse
      if (Math.floor(animT * 2) !== Math.floor((animT - dt) * 2)) changed = true;
    }

    if (changed) paint();
    return changed;
  }

  paint();

  return {
    material,
    texture,
    update,
    setFeaturedPool,
    cycleFeatured,
    getFeatured() {
      return featured;
    },
    playRewind,
    playPreview,
    showRentPrompt,
    getPreviewItem() {
      return previewItem;
    },
    isBusy() {
      return mode === 'rewind' || mode === 'preview';
    },
    resetIdle
  };
}
