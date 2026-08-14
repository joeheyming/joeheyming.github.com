import * as THREE from 'three';
import { BOX } from './constants.js';
import { wrapText } from './util.js';

/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 */

const loader = new THREE.TextureLoader();

/**
 * @param {CatalogItem} item
 * @returns {THREE.Mesh}
 */
export function makeCaseMesh(item) {
  const geo = new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d);
  const accent = new THREE.Color(item.accent || '#f5c518');
  const sideMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.5,
    metalness: 0.08,
    emissive: accent.clone().multiplyScalar(0.12)
  });
  const spineMat = new THREE.MeshStandardMaterial({
    color: accent.clone().multiplyScalar(0.7),
    roughness: 0.55
  });
  const backMat = new THREE.MeshBasicMaterial({ map: makeBackTexture(item) });
  const frontMat = new THREE.MeshBasicMaterial({ map: makeTitleTexture(item) });

  // +x / -x sides, +y / -y, +z front, -z back
  const mats = [spineMat, sideMat, sideMat, sideMat, frontMat, backMat];
  const mesh = new THREE.Mesh(geo, mats);
  maybeAddSticker(mesh);
  return mesh;
}

/**
 * Occasional shelf sticker on the cover (survives poster swaps — child plane).
 * @param {THREE.Mesh} mesh
 */
function maybeAddSticker(mesh) {
  const roll = Math.random();
  if (roll > 0.32) return;
  const kind = roll < 0.16 ? 'new' : 'rewind';
  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(kind === 'new' ? 0.14 : 0.16, kind === 'new' ? 0.14 : 0.07),
    new THREE.MeshBasicMaterial({
      map: kind === 'new' ? makeNewReleaseSticker() : makeRewindSticker(),
      transparent: true,
      depthWrite: false
    })
  );
  // Front face, slightly proud; jitter so they don't look stamped identically
  sticker.position.set(
    (Math.random() - 0.5) * 0.12,
    BOX.h * (0.28 + Math.random() * 0.12),
    BOX.d / 2 + 0.002
  );
  sticker.rotation.z = (Math.random() - 0.5) * 0.35;
  mesh.add(sticker);
}

function makeNewReleaseSticker() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = '#c41e3a';
    ctx.fill();
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 22px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEW', 64, 52);
    ctx.font = '700 16px Helvetica, Arial, sans-serif';
    ctx.fillText('RELEASE', 64, 78);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRewindSticker() {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, 192, 64);
    ctx.fillStyle = '#0a1628';
    ctx.font = '800 18px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BE KIND — REWIND', 96, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {CatalogItem} item
 * @param {THREE.Mesh} mesh
 */
export async function resolvePoster(item, mesh) {
  let url = item.posterUrl || null;
  if (!url && item.tvmazeId) {
    url = await fetchTvmazePoster(item.tvmazeId);
  }
  if (!url) return;
  loader.load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mats = /** @type {THREE.Material[]} */ (mesh.material);
      const front = /** @type {THREE.MeshBasicMaterial} */ (mats[4]);
      front.map = tex;
      front.needsUpdate = true;
    },
    undefined,
    () => {}
  );
}

/** @param {number} tvmazeId */
export async function fetchTvmazePoster(tvmazeId) {
  const key = `heyming.watch.poster.${tvmazeId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Date.now() - cached.ts < 30 * 24 * 60 * 60 * 1000) {
        return cached.url || null;
      }
    }
  } catch {
    /* refetch */
  }
  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const posterUrl = data?.image?.medium || data?.image?.original || null;
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), url: posterUrl }));
    } catch {
      /* quota */
    }
    return posterUrl;
  } catch {
    return null;
  }
}

/** @param {CatalogItem} item */
export function makeTitleTexture(item) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = item.accent || '#132844';
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 270, 256, 114);
    ctx.fillStyle = '#f2ead8';
    ctx.font = 'bold 26px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    wrapText(ctx, item.shortName || item.name, 128, 310, 220, 28);
    ctx.font = '48px serif';
    ctx.fillText(item.emoji || (item.kind === 'show' ? '📺' : '🎬'), 128, 150);
    if (item.kind === 'show') {
      ctx.fillStyle = '#f5c518';
      ctx.font = 'bold 18px Helvetica, Arial, sans-serif';
      ctx.fillText('TV SERIES', 128, 220);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Back-of-box blurb — tagline, genre tags, kind badge.
 * @param {CatalogItem} item
 */
export function makeBackTexture(item) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const ctx = c.getContext('2d');
  if (ctx) {
    const accent = item.accent || '#132844';
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(12, 12, 232, 360);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 3;
    ctx.strokeRect(18, 18, 220, 348);

    ctx.fillStyle = '#f5c518';
    ctx.font = '700 14px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.kind === 'show' ? 'TV SERIES' : 'HOME VIDEO', 128, 48);

    ctx.fillStyle = '#f2ead8';
    ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
    wrapText(ctx, item.shortName || item.name, 128, 78, 200, 24);

    ctx.fillStyle = '#9bb0c9';
    ctx.font = '13px Helvetica, Arial, sans-serif';
    const blurb = item.tagline || 'A Blockbuster favorite. Be kind — rewind.';
    wrapText(ctx, blurb, 128, 150, 200, 18);

    const tags = (item.tags || []).slice(0, 4);
    if (tags.length) {
      ctx.fillStyle = '#f5c518';
      ctx.font = '600 12px Helvetica, Arial, sans-serif';
      ctx.fillText(tags.map((t) => t.replace(/-/g, ' ').toUpperCase()).join(' · '), 128, 320);
    }

    ctx.fillStyle = '#d4e0f0';
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.fillText('BLOCKBUSTER VIDEO', 128, 350);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
