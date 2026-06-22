// modules/export.js
//
// Render the current meme to an off-screen canvas at the source
// image's natural resolution, then download as PNG or copy to the
// clipboard. The DOM overlay used by the live editor is for
// interaction only; this module is the authoritative renderer.

import * as store from './state.js';

/** Build a freshly-rendered canvas matching the current state. */
export async function renderToCanvas() {
  const s = store.get();
  if (!s.imageSrc || !s.naturalSize.w) {
    throw new Error('Nothing to export — pick a template or upload an image first.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = s.naturalSize.w;
  canvas.height = s.naturalSize.h;
  const ctx = canvas.getContext('2d');

  // 1. Background image (with optional blur)
  const img = await loadImage(s.imageSrc);
  if (s.bgBlur > 0) {
    ctx.filter = `blur(${s.bgBlur}px)`;
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';

  // 2. Stickers (under text, like Imgflip)
  for (const sticker of s.stickers) {
    drawSticker(ctx, sticker, canvas.width, canvas.height);
  }

  // 3. Text boxes
  for (const box of s.boxes) {
    drawTextBox(ctx, box, canvas.width, canvas.height);
  }

  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawSticker(ctx, sticker, W, H) {
  const x = sticker.x * W;
  const y = sticker.y * H;
  const w = sticker.w * W;
  const h = sticker.h * H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Most emoji glyphs fill ~80% of their em box; using h*0.9 matches
  // the live-editor sizing in stickers.js.
  const fontPx = h * 0.9;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.font = `${fontPx}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sticker.emoji, 0, 0);
  ctx.restore();
}

function drawTextBox(ctx, box, W, H) {
  if (!box.text) return;
  const x = box.x * W;
  const y = box.y * H;
  const w = box.w * W;
  const h = box.h * H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const fontPx = box.fontSize * H;
  const strokePx = box.strokeWidth * H;

  let fontFamily = box.fontFamily;
  let style = '';
  if (box.italic) style += 'italic ';
  const weight = box.bold ? '900 ' : '';
  const text = box.uppercase ? box.text.toUpperCase() : box.text;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.font = `${style}${weight}${fontPx}px ${fontFamily}`;
  ctx.textAlign = box.align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = box.color;
  ctx.strokeStyle = box.strokeColor;
  ctx.lineWidth = strokePx;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Word-wrap to box width, vertically center the resulting line stack.
  const lines = wrapText(ctx, text, w);
  const lineHeight = fontPx * 1.1;
  const totalH = lines.length * lineHeight;
  let yOffset = -totalH / 2 + lineHeight / 2;

  // X anchor relative to box center
  let ax = 0;
  if (box.align === 'left') ax = -w / 2;
  else if (box.align === 'right') ax = w / 2;

  for (const line of lines) {
    if (strokePx > 0) ctx.strokeText(line, ax, yOffset);
    ctx.fillText(line, ax, yOffset);
    yOffset += lineHeight;
  }
  ctx.restore();
}

/** Greedy word-wrap. Also splits on hard newlines from the source. */
function wrapText(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------- Output ----------

export async function downloadPng() {
  const canvas = await renderToCanvas();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas export failed.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = makeFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Free the blob URL after the click has been dispatched. A small
      // delay avoids canceling the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, 'image/png');
  });
}

export async function copyToClipboard() {
  if (!('ClipboardItem' in window)) {
    throw new Error('Your browser does not support copying images to the clipboard.');
  }
  const canvas = await renderToCanvas();
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Canvas export failed.'));
        return;
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 'image/png');
  });
}

function makeFilename() {
  const t = store.get().template;
  const base = t?.id || 'meme';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}-${stamp}.png`;
}
