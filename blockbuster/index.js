/**
 * Blockbuster — first-person video store.
 *
 * Catalog comes from Watch's sheet-backed data-source (movies + shows).
 * Pick up a case (hand grab → inspect → carry), place on an empty shelf
 * slot, or press E while holding to open `/watch/?movie=` / `?show=`.
 */

import * as THREE from 'three';
import { EYE_HEIGHT, MOUSE_SENS, ROOM } from './modules/constants.js';
import { loadCatalog, buildSections } from './modules/catalog.js';
import { buildRoom } from './modules/room.js';
import { createInventory } from './modules/inventory.js';
import { createHand } from './modules/hand.js';
import { createHud } from './modules/hud.js';
import { createPlayer } from './modules/player.js';
import { createPickup } from './modules/pickup.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('store-canvas'));
const loadStatus = /** @type {HTMLElement} */ (document.getElementById('load-status'));

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1628);
scene.fog = new THREE.Fog(0x0a1628, 18, 48);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(0, EYE_HEIGHT, ROOM.d / 2 - 1.6);
scene.add(camera);

const hand = createHand();
camera.add(hand);

const inventory = createInventory({ scene });
const hud = createHud();

/** @type {{ wallTvHit: THREE.Mesh | null, tvInsertPos: THREE.Vector3 }} */
let wallTv = { wallTvHit: null, tvInsertPos: new THREE.Vector3() };

/** @type {ReturnType<typeof createPickup> | null} */
let pickup = null;

const playerCtrl = createPlayer({
  camera,
  getBlockers: () => inventory.blockers,
  isLocked: () => pickup?.isLocked() ?? false
});

pickup = createPickup({
  scene,
  camera,
  hand,
  inventory,
  hud,
  getWallTv: () => ({ hit: wallTv.wallTvHit, insertPos: wallTv.tvInsertPos }),
  onRent(item) {
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('blockbuster_rent', 'entertainment', `${item.kind}:${item.id}`);
    }
    const param = item.kind === 'show' ? 'show' : 'movie';
    window.location.href = `/watch/?${param}=${encodeURIComponent(item.id)}`;
  },
  clearKeys: () => playerCtrl.clearKeys(),
  getWalk: () => playerCtrl.getWalk()
});

let pointerLocked = false;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  // Drop straight into the store — build the empty room first so the
  // first paint isn't a splash, then stock shelves as the catalog lands.
  wallTv = buildRoom(scene);
  animate();
  camera.position.set(playerCtrl.player.x, EYE_HEIGHT, playerCtrl.player.z);
  camera.rotation.order = 'YXZ';

  /** @type {import('./modules/catalog.js').CatalogItem[]} */
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loadStatus.textContent = `Could not load catalog: ${msg}`;
    return;
  }

  if (catalog.length === 0) {
    loadStatus.textContent = 'Nothing in the Watch catalog yet.';
    return;
  }

  const sections = buildSections(catalog);
  inventory.stockStore(sections);
  loadStatus.hidden = true;
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('blockbuster_enter', 'entertainment', String(catalog.length));
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  playerCtrl.update(dt);
  pickup?.update(dt);
  pickup?.updateAim(raycaster, camera);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

canvas.addEventListener('click', () => {
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  pickup?.onInteract();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || pickup?.isLocked()) return;
  playerCtrl.yaw -= e.movementX * MOUSE_SENS;
  playerCtrl.pitch -= e.movementY * MOUSE_SENS;
});

/** @param {KeyboardEvent} e */
function onKey(e, down) {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') playerCtrl.setKey('w', down);
  if (k === 'a' || k === 'arrowleft') playerCtrl.setKey('a', down);
  if (k === 's' || k === 'arrowdown') playerCtrl.setKey('s', down);
  if (k === 'd' || k === 'arrowright') playerCtrl.setKey('d', down);
  if (down && (k === 'e' || k === 'enter')) {
    pickup?.onRentOrGrabKey();
  }
}

window.addEventListener('keydown', (e) => {
  if (
    ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(
      e.key.toLowerCase()
    )
  ) {
    e.preventDefault();
  }
  onKey(e, true);
});
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('resize', onResize);

boot();
