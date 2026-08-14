import * as THREE from 'three';
import { BOX, ENTRANCE_CLEARANCE, ROOM } from './constants.js';
import { roundRect } from './util.js';

/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 */

const CLERK_LINES = [
  'We close at midnight.',
  'That one’s a classic.',
  'Be kind — rewind.',
  'New releases are on the endcap.',
  'Member night is Thursdays.',
  'Don’t forget the late fee… just kidding.',
  'If you like that, try the aisle behind you.'
];

const CHALLENGE_TAGS = [
  { tag: 'comedy', label: 'a comedy' },
  { tag: 'action', label: 'an action movie' },
  { tag: 'sci-fi', label: 'a sci-fi title' },
  { tag: 'anime', label: 'some anime' },
  { tag: 'superhero', label: 'a superhero flick' }
];

/**
 * Foyer props: bargain bin, return slot, clerk, back room, staff challenge.
 * @param {{
 *   scene: THREE.Scene,
 *   inventory: ReturnType<import('./inventory.js').createInventory>,
 *   catalog: CatalogItem[],
 *   hud: { showStatus: (title: string, tagline?: string, hint?: string) => void, showChallenge?: (text: string) => void, clearChallenge?: () => void }
 * }} opts
 */
export function createStoreProps({ scene, inventory, catalog, hud }) {
  const halfD = ROOM.d / 2;
  const halfW = ROOM.w / 2;

  /** @type {THREE.Mesh[]} */
  const aimHits = [];
  let challengeDone = false;
  let clerkCooldown = 4;
  let lastBark = '';
  /** @type {THREE.Object3D | null} */
  let clerkRoot = null;
  let backRoomOpen = Math.random() < 0.18;

  // —— Bargain bin (right side of foyer) ————————————————
  const binX = 5.2;
  const binZ = halfD - ENTRANCE_CLEARANCE * 0.55;
  addBargainBin(binX, binZ);

  // —— Return drop box (left near entrance) ————————————
  const returnHit = addReturnBox(-4.2, halfD - 2.2);
  aimHits.push(returnHit);

  // —— Clerk counter (right entrance) ————————————————
  const clerk = addClerk(6.8, halfD - 1.8);
  clerkRoot = clerk.root;
  aimHits.push(clerk.hit);

  // —— Back room door (left wall) ————————————————
  const door = addBackRoomDoor(-halfW + 0.08, -2.5);
  aimHits.push(door.hit);
  if (backRoomOpen) {
    stockBackRoom(catalog);
    door.setOpen(true);
  }

  // —— Staff challenge ——————————————————————————————
  /** @type {{ tag: string, label: string } | null} */
  let challengeGoal = pickChallenge(catalog);
  if (challengeGoal) {
    hud.showChallenge?.(`Staff challenge: pick up ${challengeGoal.label}`);
  }

  function addBargainBin(x, z) {
    const wood = new THREE.MeshStandardMaterial({
      color: 0x5a3a22,
      roughness: 0.85,
      metalness: 0.05
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.1), wood);
    table.position.set(x, 0.72, z);
    scene.add(table);
    for (const [dx, dz] of [
      [-0.55, -0.35],
      [0.55, -0.35],
      [-0.55, 0.35],
      [0.55, 0.35]
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), wood);
      leg.position.set(x + dx, 0.36, z + dz);
      scene.add(leg);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.28),
      new THREE.MeshBasicMaterial({ map: makeBinSign(), transparent: true })
    );
    sign.position.set(x, 1.05, z + 0.56);
    scene.add(sign);

    inventory.addBlocker({
      minX: x - 0.95,
      maxX: x + 0.95,
      minZ: z - 0.7,
      maxZ: z + 0.7
    });

    const picks = shuffle(catalog.slice()).slice(0, 7);
    for (let i = 0; i < picks.length; i++) {
      const ang = (i / picks.length) * Math.PI * 2;
      const r = 0.15 + (i % 3) * 0.08;
      const pos = new THREE.Vector3(
        x + Math.cos(ang) * r + (Math.random() - 0.5) * 0.08,
        0.78 + (i % 3) * 0.04,
        z + Math.sin(ang) * r * 0.7 + (Math.random() - 0.5) * 0.06
      );
      inventory.addLooseCase(picks[i], pos, {
        x: -0.2 + Math.random() * 0.5,
        y: Math.random() * Math.PI * 2,
        z: (Math.random() - 0.5) * 0.35
      });
    }
  }

  /** @param {number} x @param {number} z */
  function addReturnBox(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x123a8c,
      roughness: 0.7,
      metalness: 0.1
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 0.55), mat);
    box.position.set(x, 0.55, z);
    scene.add(box);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.12, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.9 })
    );
    slot.position.set(x, 0.95, z + 0.2);
    scene.add(slot);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.18),
      new THREE.MeshBasicMaterial({ map: makeReturnLabel(), transparent: true })
    );
    label.position.set(x, 1.2, z + 0.29);
    scene.add(label);

    inventory.addBlocker({
      minX: x - 0.55,
      maxX: x + 0.55,
      minZ: z - 0.4,
      maxZ: z + 0.4
    });

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.3, 0.8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(x, 0.65, z);
    hit.userData.isReturnBox = true;
    scene.add(hit);
    return hit;
  }

  /** @param {number} x @param {number} z */
  function addClerk(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.05, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1a2f4d, roughness: 0.75 })
    );
    counter.position.y = 0.52;
    group.add(counter);

    // Flat silhouette “clerk”
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.95, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x0c1524, roughness: 0.9 })
    );
    body.position.set(0, 1.4, -0.15);
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.8 })
    );
    head.position.set(0, 1.95, -0.15);
    group.add(head);

    const nametag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.14),
      new THREE.MeshBasicMaterial({ map: makeClerkTag(), transparent: true })
    );
    nametag.position.set(0, 1.15, 0.36);
    group.add(nametag);

    scene.add(group);
    inventory.addBlocker({
      minX: x - 1.2,
      maxX: x + 1.2,
      minZ: z - 0.5,
      maxZ: z + 0.5
    });

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 1.2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(x, 1.1, z);
    hit.userData.isClerk = true;
    scene.add(hit);
    return { root: group, hit };
  }

  /** @param {number} x @param {number} z */
  function addBackRoomDoor(x, z) {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.2, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x3a4558, roughness: 0.7 })
    );
    frame.position.set(x, 1.1, z);
    scene.add(frame);

    const doorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 2.05, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x2a3344, roughness: 0.65 })
    );
    doorMesh.position.set(x + 0.06, 1.05, z);
    scene.add(doorMesh);

    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.16),
      new THREE.MeshBasicMaterial({ map: makeEmployeesSign(), transparent: true })
    );
    plaque.position.set(x + 0.12, 1.7, z);
    plaque.rotation.y = Math.PI / 2;
    scene.add(plaque);

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 2.3, 1.3),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(x + 0.3, 1.1, z);
    hit.userData.isBackDoor = true;
    scene.add(hit);

    return {
      doorMesh,
      hit,
      /** @param {boolean} open */
      setOpen(open) {
        // Swing inward
        doorMesh.rotation.y = open ? -1.15 : 0;
        doorMesh.position.z = open ? z - 0.35 : z;
      }
    };
  }

  /** @param {CatalogItem[]} catalogItems */
  function stockBackRoom(catalogItems) {
    const weird = shuffle(catalogItems.slice()).slice(0, 6);
    const baseX = -halfW + 1.4;
    const baseZ = -2.5;
    // Tiny employees-only shelf strip
    for (let i = 0; i < weird.length; i++) {
      const pos = new THREE.Vector3(
        baseX + 0.2,
        0.9 + (i % 3) * 0.55,
        baseZ - 0.9 + Math.floor(i / 3) * 0.5
      );
      inventory.addLooseCase(weird[i], pos, {
        x: CASE_LEAN_SOFT,
        y: Math.PI / 2,
        z: 0
      });
    }
    inventory.addBlocker({
      minX: -halfW,
      maxX: -halfW + 2.2,
      minZ: -4.2,
      maxZ: -1.0
    });
  }

  /**
   * @param {THREE.Raycaster} raycaster
   * @param {THREE.Camera} cam
   * @returns {'return'|'clerk'|'backDoor'|null}
   */
  function raycastProp(raycaster, cam) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cam);
    const hits = raycaster.intersectObjects(aimHits, false);
    const hit = hits.find((h) => h.distance < 5);
    if (!hit) return null;
    if (hit.object.userData.isReturnBox) return 'return';
    if (hit.object.userData.isClerk) return 'clerk';
    if (hit.object.userData.isBackDoor) return 'backDoor';
    return null;
  }

  /** @param {CatalogItem} item */
  function onPickedUp(item) {
    if (!challengeGoal || challengeDone) return;
    if ((item.tags || []).includes(challengeGoal.tag)) {
      challengeDone = true;
      hud.showStatus(
        'Challenge complete!',
        `You found ${challengeGoal.label}.`,
        'Nice eye, member.'
      );
      hud.clearChallenge?.();
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('blockbuster_challenge', 'entertainment', challengeGoal.tag);
      }
    }
  }

  function describeProp(kind) {
    if (kind === 'return') {
      return {
        title: 'Return slot',
        tagline: 'Drop off tapes after hours.',
        hint: 'Hold a case and click to return it'
      };
    }
    if (kind === 'clerk') {
      return {
        title: 'Front desk',
        tagline: lastBark || 'Ask about tonight’s picks.',
        hint: 'Click to talk to the clerk'
      };
    }
    if (kind === 'backDoor') {
      return {
        title: backRoomOpen ? 'Employees only' : 'Employees only',
        tagline: backRoomOpen ? 'Door’s cracked open…' : 'Locked. Try again another night.',
        hint: backRoomOpen ? 'Click to peek' : 'Come back later'
      };
    }
    return null;
  }

  /** @param {'return'|'clerk'|'backDoor'} kind @param {boolean} holding */
  function interactProp(kind, holding) {
    if (kind === 'return') {
      if (!holding) {
        hud.showStatus('Return slot', 'Bring a tape over to drop it off.', '');
        return false;
      }
      return true; // caller consumes held item
    }
    if (kind === 'clerk') {
      bark(true);
      return false;
    }
    if (kind === 'backDoor') {
      if (backRoomOpen) {
        hud.showStatus('Back room', 'Staff picks only. Don’t tell corporate.', '');
      } else {
        hud.showStatus('Employees only', 'Door’s locked tonight.', 'Maybe next visit.');
      }
      return false;
    }
    return false;
  }

  /** @param {boolean} [force] */
  function bark(force = false) {
    if (!force && clerkCooldown > 0) return;
    let line = CLERK_LINES[Math.floor(Math.random() * CLERK_LINES.length)];
    if (line === lastBark) {
      line = CLERK_LINES[(CLERK_LINES.indexOf(line) + 1) % CLERK_LINES.length];
    }
    lastBark = line;
    clerkCooldown = 6 + Math.random() * 5;
    hud.showStatus('Clerk', line, '');
  }

  /**
   * @param {number} dt
   * @param {{ x: number, z: number }} player
   * @returns {boolean} dirty
   */
  function update(dt, player) {
    clerkCooldown -= dt;
    let dirty = false;
    if (clerkRoot) {
      // Face toward player gently
      const dx = player.x - clerkRoot.position.x;
      const dz = player.z - clerkRoot.position.z;
      const target = Math.atan2(dx, dz);
      const body = clerkRoot.children[1];
      if (body) {
        const prev = body.rotation.y;
        body.rotation.y += (target - body.rotation.y) * Math.min(1, dt * 3);
        if (Math.abs(body.rotation.y - prev) > 0.002) dirty = true;
      }
      const dist = Math.hypot(dx, dz);
      if (dist < 3.5 && clerkCooldown <= 0) bark();
    }
    return dirty;
  }

  return {
    raycastProp,
    describeProp,
    interactProp,
    onPickedUp,
    update,
    isBackRoomOpen() {
      return backRoomOpen;
    }
  };
}

const CASE_LEAN_SOFT = -0.25;

/** @param {CatalogItem[]} catalog */
function pickChallenge(catalog) {
  const usable = CHALLENGE_TAGS.filter((c) =>
    catalog.some((item) => (item.tags || []).includes(c.tag))
  );
  if (!usable.length) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

/** @template T @param {T[]} arr @returns {T[]} */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function makeBinSign() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#c41e3a';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = '#fff';
    ctx.font = '800 52px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BARGAIN BIN', 256, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeReturnLabel() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f5c518';
    ctx.font = '800 22px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RETURNS', 128, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeClerkTag() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0b1c3f';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 56);
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 22px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ASK ME', 128, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeEmployeesSign() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1a1520';
    roundRect(ctx, 4, 4, 248, 56, 6);
    ctx.fill();
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 16px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EMPLOYEES ONLY', 128, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
