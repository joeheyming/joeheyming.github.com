import * as THREE from 'three';
import { ROOM } from './constants.js';
import { roundRect } from './util.js';

/**
 * @param {THREE.Scene} scene
 * @returns {{ wallTvHit: THREE.Mesh, tvInsertPos: THREE.Vector3 }}
 */
export function buildRoom(scene) {
  const halfW = ROOM.w / 2;
  const halfD = ROOM.d / 2;

  // Classic Blockbuster blue carpet
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshStandardMaterial({ color: 0x14325c, roughness: 0.97, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Drop-ceiling feel
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 1, metalness: 0 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  scene.add(ceil);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2a4060,
    roughness: 0.9,
    metalness: 0.04
  });

  /** @param {number} w @param {number} h @param {number} x @param {number} z @param {number} ry */
  const wall = (w, h, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    scene.add(m);
  };

  wall(ROOM.w, ROOM.h, 0, -halfD, 0);
  wall(ROOM.w, ROOM.h, 0, halfD, Math.PI);
  wall(ROOM.d, ROOM.h, -halfW, 0, Math.PI / 2);
  wall(ROOM.d, ROOM.h, halfW, 0, -Math.PI / 2);

  scene.add(new THREE.AmbientLight(0xd0dae8, 0.95));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a3050, 0.45));

  // Fluorescent panels running down the aisles
  for (let z = -9; z <= 9; z += 3.5) {
    for (const x of [-4.4, 0, 4.4]) {
      const bulb = new THREE.PointLight(0xfff6e0, 1.35, 11, 1.7);
      bulb.position.set(x, ROOM.h - 0.2, z);
      scene.add(bulb);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.05, 1.1),
        new THREE.MeshStandardMaterial({
          color: 0xfffaf0,
          emissive: 0xfff0c8,
          emissiveIntensity: 0.85,
          roughness: 0.35
        })
      );
      panel.position.set(x, ROOM.h - 0.03, z);
      scene.add(panel);
    }
  }

  const fill = new THREE.DirectionalLight(0xfff2d8, 0.35);
  fill.position.set(2, 6, 4);
  scene.add(fill);

  // Marquee on the entrance wall (clear of the aisle gondolas)
  addMarqueeSign(scene, 0, 2.4, halfD - 0.05, Math.PI);
  // Demo TV + VCR on the back wall (opposite the entrance logo)
  return addWallTv(scene, 0, 1.2, -halfD + 0.06, 0);
}

/**
 * Ticket-style Blockbuster marquee. Drawn with system fonts so we
 * never depend on a webfont still loading (that was the weird logo).
 * @param {THREE.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} [facing=0]
 */
function addMarqueeSign(scene, x, y, z, facing = 0) {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 420;
  const ctx = c.getContext('2d');
  if (!ctx) return;

  // Full opaque plate — no transparent margin that reads as a clipped border
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, c.width, c.height);

  const pad = 48;
  const boxX = pad;
  const boxY = pad;
  const boxW = c.width - pad * 2;
  const boxH = c.height - pad * 2;

  roundRect(ctx, boxX, boxY, boxW, boxH, 32);
  ctx.fillStyle = '#0b1c3f';
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#f5c518';
  ctx.stroke();

  const inset = 28;
  roundRect(ctx, boxX + inset, boxY + inset, boxW - inset * 2, boxH - inset * 2, 20);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#f5c518';
  ctx.stroke();

  // Keep wordmark inside the inner rule with comfortable padding
  const textMaxW = boxW - inset * 2 - 64;
  const cx = c.width / 2;
  const cy = boxY + boxH / 2 - 8;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5c518';

  let size = 128;
  const fontStack = '"Arial Black", Impact, Haettenschweiler, sans-serif';
  do {
    ctx.font = `900 ${size}px ${fontStack}`;
    size -= 4;
  } while (ctx.measureText('BLOCKBUSTER').width > textMaxW && size > 48);
  ctx.font = `900 ${size + 4}px ${fontStack}`;
  ctx.fillText('BLOCKBUSTER', cx, cy - 28);

  ctx.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#d4e0f0';
  ctx.fillText('BE KIND — REWIND', cx, cy + 72);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 2.1),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  sign.position.set(x, y, z);
  sign.rotation.y = facing;
  scene.add(sign);
}

/**
 * Wall CRT + VCR on the entrance wall. Aim a held case at it and click to play.
 * @param {THREE.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} facing
 * @returns {{ wallTvHit: THREE.Mesh, tvInsertPos: THREE.Vector3 }}
 */
function addWallTv(scene, x, y, z, facing) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = facing;

  const plastic = new THREE.MeshStandardMaterial({
    color: 0x1c1c22,
    roughness: 0.65,
    metalness: 0.15
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.05, 0.5), plastic);
  group.add(body);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.78, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5 })
  );
  bezel.position.set(0, 0.08, 0.27);
  group.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 0.66),
    new THREE.MeshBasicMaterial({ map: makeTvScreenTexture() })
  );
  screen.position.set(0, 0.08, 0.295);
  group.add(screen);

  // Soft glow so the set reads as “on”
  const glow = new THREE.PointLight(0x6ec8ff, 0.55, 4.5, 2);
  glow.position.set(0, 0.1, 0.5);
  group.add(glow);

  const vcr = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.42), plastic);
  vcr.position.set(0, -0.55, 0.02);
  group.add(vcr);

  const slotMat = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.9 });
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.2), slotMat);
  slot.position.set(0, -0.52, 0.22);
  group.add(slot);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.1),
    new THREE.MeshBasicMaterial({ map: makeTvLabelTexture(), transparent: true })
  );
  label.position.set(0, -0.72, 0.22);
  group.add(label);

  // Invisible aim volume (screen + VCR)
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 1.45, 0.85),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.set(0, -0.15, 0.1);
  hit.userData.isWallTv = true;
  group.add(hit);

  scene.add(group);
  group.updateMatrixWorld(true);
  const tvInsertPos = new THREE.Vector3(0, -0.52, 0.55).applyMatrix4(group.matrixWorld);

  return { wallTvHit: hit, tvInsertPos };
}

/** @returns {THREE.CanvasTexture} */
function makeTvScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 512, 320);
    g.addColorStop(0, '#0b1a33');
    g.addColorStop(1, '#123a6e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 320);
    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < 320; y += 4) ctx.fillRect(0, y, 512, 2);
    ctx.fillStyle = '#f5c518';
    ctx.font = '800 42px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOW PLAYING', 256, 130);
    ctx.fillStyle = '#d4e0f0';
    ctx.font = '600 22px Helvetica, Arial, sans-serif';
    ctx.fillText('Insert a tape to watch', 256, 185);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** @returns {THREE.CanvasTexture} */
function makeTvLabelTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 48);
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 22px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('INSERT TAPE', 128, 24);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
