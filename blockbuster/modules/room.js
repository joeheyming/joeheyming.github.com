import * as THREE from 'three';
import { ROOM } from './constants.js';
import { roundRect } from './util.js';
import { createTvScreen } from './tv-screen.js';

/**
 * @param {THREE.Scene} scene
 * @returns {{
 *   wallTvHit: THREE.Mesh,
 *   tvInsertPos: THREE.Vector3,
 *   tvScreen: ReturnType<typeof createTvScreen>,
 *   updateAtmosphere: (dt: number) => boolean
 * }}
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

  /** @type {{ light: THREE.PointLight, panel: THREE.Mesh, base: number, next: number, flick: number }[]} */
  const fluorescents = [];

  // Fluorescent panels running down the aisles
  for (let z = -9; z <= 9; z += 3.5) {
    for (const x of [-4.4, 0, 4.4]) {
      const bulb = new THREE.PointLight(0xfff6e0, 1.35, 11, 1.7);
      bulb.position.set(x, ROOM.h - 0.2, z);
      scene.add(bulb);
      const panelMat = new THREE.MeshStandardMaterial({
        color: 0xfffaf0,
        emissive: 0xfff0c8,
        emissiveIntensity: 0.85,
        roughness: 0.35
      });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 1.1), panelMat);
      panel.position.set(x, ROOM.h - 0.03, z);
      scene.add(panel);
      fluorescents.push({
        light: bulb,
        panel,
        base: 1.35,
        next: 4 + Math.random() * 18,
        flick: 0
      });
    }
  }

  const fill = new THREE.DirectionalLight(0xfff2d8, 0.35);
  fill.position.set(2, 6, 4);
  scene.add(fill);

  // Night parking glow + rain streaks on the entrance wall
  const rain = addEntranceAtmosphere(scene, halfD);

  // Marquee on the entrance wall (clear of the aisle gondolas)
  addMarqueeSign(scene, 0, 2.4, halfD - 0.05, Math.PI);
  // Demo TV + VCR on the back wall (opposite the entrance logo)
  const tv = addWallTv(scene, 0, 1.2, -halfD + 0.06, 0);

  /**
   * @param {number} dt
   * @returns {boolean}
   */
  function updateAtmosphere(dt) {
    let dirty = rain.update(dt);
    for (const f of fluorescents) {
      f.next -= dt;
      if (f.flick > 0) {
        f.flick -= dt;
        const pulse = 0.25 + Math.random() * 0.9;
        f.light.intensity = f.base * pulse;
        /** @type {THREE.MeshStandardMaterial} */ (f.panel.material).emissiveIntensity =
          0.3 + pulse * 0.55;
        dirty = true;
        if (f.flick <= 0) {
          f.light.intensity = f.base;
          /** @type {THREE.MeshStandardMaterial} */ (f.panel.material).emissiveIntensity = 0.85;
          f.next = 6 + Math.random() * 22;
        }
      } else if (f.next <= 0) {
        // Rare short flicker burst
        f.flick = 0.12 + Math.random() * 0.35;
      }
    }
    return dirty;
  }

  return { ...tv, updateAtmosphere };
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
 * Parking-lot sodium glow + animated rain on the entrance glass.
 * @param {THREE.Scene} scene
 * @param {number} halfD
 */
function addEntranceAtmosphere(scene, halfD) {
  const lot = new THREE.PointLight(0xffaa55, 0.55, 14, 2);
  lot.position.set(0, 2.2, halfD + 2.5);
  scene.add(lot);

  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, ROOM.h * 0.85),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    })
  );
  glass.position.set(0, ROOM.h * 0.45, halfD - 0.08);
  glass.rotation.y = Math.PI;
  scene.add(glass);

  /** @type {{ x: number, y: number, len: number, speed: number }[]} */
  const drops = [];
  for (let i = 0; i < 48; i++) {
    drops.push({
      x: Math.random() * 256,
      y: Math.random() * 512,
      len: 8 + Math.random() * 18,
      speed: 140 + Math.random() * 220
    });
  }
  let acc = 0;

  return {
    /** @param {number} dt */
    update(dt) {
      if (!ctx) return false;
      acc += dt;
      // ~20fps paint is enough for rain
      if (acc < 0.05) return false;
      const step = acc;
      acc = 0;
      ctx.clearRect(0, 0, 256, 512);
      // Wet night glass wash
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, 'rgba(20, 30, 50, 0.15)');
      g.addColorStop(1, 'rgba(255, 170, 80, 0.12)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 512);
      ctx.strokeStyle = 'rgba(200, 220, 255, 0.45)';
      ctx.lineWidth = 1.2;
      for (const d of drops) {
        d.y += d.speed * step;
        if (d.y > 512 + d.len) {
          d.y = -d.len;
          d.x = Math.random() * 256;
        }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1.5, d.y + d.len);
        ctx.stroke();
      }
      tex.needsUpdate = true;
      return true;
    }
  };
}

/**
 * Wall CRT + VCR on the back wall. Aim a held case at it and click to preview.
 * @param {THREE.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} facing
 * @returns {{
 *   wallTvHit: THREE.Mesh,
 *   tvInsertPos: THREE.Vector3,
 *   tvScreen: ReturnType<typeof createTvScreen>
 * }}
 */
function addWallTv(scene, x, y, z, facing) {
  const tvScreen = createTvScreen();
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

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.66), tvScreen.material);
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

  return { wallTvHit: hit, tvInsertPos, tvScreen };
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
