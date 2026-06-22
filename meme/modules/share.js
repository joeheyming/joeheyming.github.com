// modules/share.js
//
// Encode the current meme state into a URL hash so the page can be
// re-opened with the same meme on screen. Custom-uploaded images
// can't fit in a URL, so for those we fall back to "open the page
// blank but keep the text/boxes".

import * as store from './state.js';

const VERSION = 1;

/** Serialize state to a URL-hash-safe base64 string. */
export function encode() {
  const s = store.get();
  // We only encode template-based memes (uploaded images would balloon the URL).
  // For custom images, the receiver gets the meme structure without the photo.
  const payload = {
    v: VERSION,
    t: s.template?.id || null,
    bl: s.bgBlur,
    b: s.boxes.map((b) => [
      b.text,
      round(b.x),
      round(b.y),
      round(b.w),
      round(b.h),
      Math.round(b.rotation),
      b.fontFamily,
      round(b.fontSize),
      b.color,
      b.strokeColor,
      round(b.strokeWidth),
      b.align,
      (b.bold ? 1 : 0) | (b.italic ? 2 : 0) | (b.uppercase ? 4 : 0)
    ]),
    s: s.stickers.map((st) => [
      st.emoji,
      round(st.x),
      round(st.y),
      round(st.w),
      round(st.h),
      Math.round(st.rotation)
    ])
  };
  // base64url so the hash stays clean (no `+`, `/`, `=`). Encode through
  // TextEncoder so the emoji bytes in sticker text survive a round trip
  // — deprecated `unescape`/`escape` mangle non-ASCII codepoints.
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of encode(). Returns a partial-state object or null. */
export function decode(hash) {
  try {
    const padded = hash.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const p = JSON.parse(json);
    if (p.v !== VERSION) return null;
    return {
      templateId: p.t,
      bgBlur: p.bl ?? 0,
      boxes: p.b.map((arr) => ({
        text: arr[0] || '',
        x: arr[1],
        y: arr[2],
        w: arr[3],
        h: arr[4],
        rotation: arr[5],
        fontFamily: arr[6],
        fontSize: arr[7],
        color: arr[8],
        strokeColor: arr[9],
        strokeWidth: arr[10],
        align: arr[11],
        bold: !!(arr[12] & 1),
        italic: !!(arr[12] & 2),
        uppercase: !!(arr[12] & 4),
        id: 'box-' + Math.random().toString(36).slice(2, 8)
      })),
      stickers: (p.s || []).map((arr) => ({
        emoji: arr[0],
        x: arr[1],
        y: arr[2],
        w: arr[3],
        h: arr[4],
        rotation: arr[5],
        id: 'stk-' + Math.random().toString(36).slice(2, 8)
      }))
    };
  } catch (err) {
    console.warn('Failed to decode share hash:', err);
    return null;
  }
}

/** Build a shareable URL for the current meme. */
export function buildShareUrl() {
  const hash = encode();
  const base = location.origin + location.pathname;
  return `${base}#m=${hash}`;
}

/** If the URL contains a share hash, parse it. Returns the decoded payload or null. */
export function readHashPayload() {
  const m = /[#&]m=([^&]+)/.exec(location.hash);
  if (!m) return null;
  return decode(m[1]);
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}
