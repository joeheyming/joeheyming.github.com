/**
 * Blockbuster — first-person video store.
 *
 * Catalog comes from Watch's sheet-backed data-source (movies + shows).
 * Pick up a case (hand grab → inspect → carry), place on an empty shelf
 * slot, or insert into the wall CRT to preview then rent into `/watch/`.
 */

import * as THREE from 'three';
import { EYE_HEIGHT, MOUSE_SENS, ROOM } from './modules/constants.js';
import { loadCatalog, buildSections, buildStaffPicksSection } from './modules/catalog.js';
import { buildRoom } from './modules/room.js';
import { createInventory } from './modules/inventory.js';
import { createHand } from './modules/hand.js';
import { createHud } from './modules/hud.js';
import { createPlayer } from './modules/player.js';
import { createPickup } from './modules/pickup.js';
import { createAmbience } from './modules/ambience.js';
import { createStoreProps } from './modules/store-props.js';
import { installTouchControls, TOUCH_LOOK_SENS } from './modules/touch-controls.js';

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

const ambience = createAmbience();
const hud = createHud({ ambience });

/** @type {{
 *   wallTvHit: THREE.Mesh | null,
 *   tvInsertPos: THREE.Vector3,
 *   tvScreen: ReturnType<import('./modules/tv-screen.js').createTvScreen> | null,
 *   updateAtmosphere?: (dt: number) => boolean
 * }}
 */
let wallTv = { wallTvHit: null, tvInsertPos: new THREE.Vector3(), tvScreen: null };

/** @type {ReturnType<typeof createPickup> | null} */
let pickup = null;

/** @type {ReturnType<typeof createStoreProps> | null} */
let storeProps = null;

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
  getWallTv: () => ({
    hit: wallTv.wallTvHit,
    insertPos: wallTv.tvInsertPos,
    tvScreen: wallTv.tvScreen
  }),
  getStoreProps: () => storeProps,
  onRent(item) {
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('blockbuster_rent', 'entertainment', `${item.kind}:${item.id}`);
    }
    const param = item.kind === 'show' ? 'show' : 'movie';
    window.location.href = `/watch/?${param}=${encodeURIComponent(item.id)}&from=blockbuster`;
  },
  clearKeys: () => playerCtrl.clearKeys(),
  getWalk: () => playerCtrl.getWalk(),
  onDirty: () => {
    staticFrameDirty = true;
  }
});

let pointerLocked = false;
/** Ignore the browser's synthetic click that follows a touch tap. */
let suppressClick = false;
/** Menu/idle: only re-render when something visually changed. */
let staticFrameDirty = true;

function unlockAudio() {
  ambience.start();
}

// Twin-stick for real touch pointers (pacman FPPOV pattern). Desktop
// mouse still uses pointer-lock below — the two paths co-exist.
const touchUi = installTouchControls({
  canvas,
  setKey: (key, down) => playerCtrl.setKey(key, down),
  look(dx, dy) {
    playerCtrl.yaw -= dx * TOUCH_LOOK_SENS;
    playerCtrl.pitch -= dy * TOUCH_LOOK_SENS;
  },
  onInteract: () => {
    suppressClick = true;
    unlockAudio();
    pickup?.onInteract();
  },
  onRentOrGrab: () => {
    suppressClick = true;
    unlockAudio();
    pickup?.onRentOrGrabKey();
  },
  isLocked: () => pickup?.isLocked() ?? false,
  isHolding: () => (pickup?.isHolding() ?? false) || (pickup?.hasTvQueued() ?? false)
});

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

  const staffPicks = buildStaffPicksSection(catalog);
  const sections = buildSections(catalog);
  inventory.stockStore(sections, staffPicks);
  storeProps = createStoreProps({ scene, inventory, catalog, hud });
  wallTv.tvScreen?.setFeaturedPool(catalog);
  staticFrameDirty = true;
  loadStatus.hidden = true;
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('blockbuster_enter', 'entertainment', String(catalog.length));
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  staticFrameDirty = true;
}

function animate() {
  requestAnimationFrame(animate);
  const needsContinuous =
    pointerLocked || (pickup?.isLocked?.() ?? false) || (pickup?.needsTvFrames?.() ?? false);
  const dt = Math.min(clock.getDelta(), 0.05);

  let dirty = staticFrameDirty;
  if (wallTv.updateAtmosphere?.(dt)) dirty = true;
  if (storeProps?.update(dt, playerCtrl.player)) dirty = true;
  if (!needsContinuous && wallTv.tvScreen?.update(dt)) dirty = true;

  if (!needsContinuous) {
    if (!dirty) return;
    staticFrameDirty = false;
    renderer.render(scene, camera);
    return;
  }

  staticFrameDirty = false;
  playerCtrl.update(dt);
  pickup?.update(dt);
  pickup?.updateAim(raycaster, camera);
  touchUi.update();
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* Input — desktop pointer lock                                        */
/* ------------------------------------------------------------------ */

canvas.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  unlockAudio();
  if (!pointerLocked) {
    staticFrameDirty = true;
    canvas.requestPointerLock();
    return;
  }
  pickup?.onInteract();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  staticFrameDirty = true;
  if (pointerLocked) unlockAudio();
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || pickup?.isLocked()) return;
  playerCtrl.yaw -= e.movementX * MOUSE_SENS;
  playerCtrl.pitch -= e.movementY * MOUSE_SENS;
});

document.addEventListener('mousedown', (e) => {
  if (!pointerLocked || e.button !== 2) return;
  e.preventDefault();
  pickup?.toggleFlip();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener(
  'wheel',
  (e) => {
    if (!pointerLocked || !pickup?.isHolding()) return;
    e.preventDefault();
    // Scroll down → back of box; up → cover
    if (e.deltaY > 2) pickup.setFlip(1);
    else if (e.deltaY < -2) pickup.setFlip(0);
  },
  { passive: false }
);

/** @param {KeyboardEvent} e */
function onKey(e, down) {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') playerCtrl.setKey('w', down);
  if (k === 'a' || k === 'arrowleft') playerCtrl.setKey('a', down);
  if (k === 's' || k === 'arrowdown') playerCtrl.setKey('s', down);
  if (k === 'd' || k === 'arrowright') playerCtrl.setKey('d', down);
  // Minecraft sneak — Shift (not Ctrl; Ctrl is sprint in Java Edition)
  if (k === 'shift') playerCtrl.setKey('crouch', down);
  if (k === 'control') playerCtrl.setKey('sprint', down);
  if (down && k === 'f') pickup?.toggleFlip();
  if (down && (k === 'e' || k === 'enter')) {
    unlockAudio();
    pickup?.onRentOrGrabKey();
  }
  if (down) unlockAudio();
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (
    [
      'w',
      'a',
      's',
      'd',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      ' ',
      'shift',
      'control',
      'f'
    ].includes(k)
  ) {
    e.preventDefault();
  }
  onKey(e, true);
});
window.addEventListener('keyup', (e) => onKey(e, false));
// If focus is lost while modifiers are held, keyup may never fire.
window.addEventListener('blur', () => {
  playerCtrl.setKey('crouch', false);
  playerCtrl.setKey('sprint', false);
});
window.addEventListener('resize', onResize);

boot();
