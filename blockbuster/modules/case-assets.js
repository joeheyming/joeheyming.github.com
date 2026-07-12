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
  const backMat = new THREE.MeshStandardMaterial({
    color: accent.clone().multiplyScalar(0.4),
    roughness: 0.85
  });
  const frontMat = new THREE.MeshBasicMaterial({ map: makeTitleTexture(item) });

  // +x / -x sides, +y / -y, +z front, -z back
  const mats = [spineMat, sideMat, sideMat, sideMat, frontMat, backMat];
  return new THREE.Mesh(geo, mats);
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
