import * as THREE from 'three';
import {
  BOX,
  CASE_GAP,
  CASE_LEAN,
  GONDOLA_HALF,
  MAX_AISLE_LEN,
  MIN_WALKWAY,
  ROOM,
  SHELF,
  STOCK_ROWS,
  TARGET_PER_FACE
} from './constants.js';
import { makeCaseMesh, resolvePoster } from './case-assets.js';

/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 * @typedef {import('./catalog.js').Section} Section
 */

/**
 * @typedef {Object} ShelfSlot
 * @property {string} faceId
 * @property {number} col
 * @property {number} row
 * @property {THREE.Vector3} origin
 * @property {number} facing
 * @property {number} along
 * @property {number} y
 * @property {CatalogItem | null} item
 * @property {THREE.Group | null} group
 * @property {THREE.Mesh | null} mesh
 * @property {THREE.Mesh} proxy
 */

/**
 * @param {{ scene: THREE.Scene }} opts
 */
export function createInventory({ scene }) {
  /** @type {ShelfSlot[]} */
  const slots = [];
  /** @type {THREE.Object3D[]} */
  const cases = [];
  /** @type {{ minX: number, maxX: number, minZ: number, maxZ: number }[]} */
  const blockers = [];

  /**
   * Build parallel gondolas from the spreadsheet-derived sections.
   * Each face gets exactly one section (large sections are split into
   * labeled chunks so shelves fill edge-to-edge instead of one lonely
   * cluster on a long empty plank).
   * @param {Section[]} sections
   */
  function stockStore(sections) {
    const pitch = BOX.w + CASE_GAP;
    // Prefer TARGET_PER_FACE so big genres/TV bands become multiple shelves;
    // still never exceed what fits on MAX_AISLE_LEN.
    const maxCols = Math.max(4, Math.floor(MAX_AISLE_LEN / pitch));
    const maxPerFace = Math.min(TARGET_PER_FACE, maxCols * STOCK_ROWS);
    const faces = expandSections(sections, maxPerFace);
    if (!faces.length) return;

    // Pair faces onto double-sided gondolas
    /** @type {[Section, Section | null][]} */
    const pairs = [];
    for (let i = 0; i < faces.length; i += 2) {
      pairs.push([faces[i], faces[i + 1] || null]);
    }

    // Footprint of one gondola across X, plus a real walkway between them
    const gondolaSpan = (GONDOLA_HALF + SHELF.depth) * 2;
    const centerGap = gondolaSpan + MIN_WALKWAY;
    const usableW = ROOM.w - 3;
    const cols = Math.max(1, Math.floor(usableW / centerGap) + 1);
    const rowsNeeded = Math.ceil(pairs.length / cols);
    const rowPitch = Math.min(MAX_AISLE_LEN + 2.5, (ROOM.d - 4) / Math.max(1, rowsNeeded));

    for (let i = 0; i < pairs.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rowWidth = Math.min(cols, pairs.length - row * cols);
      const spanX = (rowWidth - 1) * centerGap;
      const cx = -spanX / 2 + col * centerGap;
      const zCenter = ROOM.d / 2 - 3.5 - row * rowPitch - MAX_AISLE_LEN / 2;

      const [west, east] = pairs[i];
      const lenW = sectionLength(west, pitch);
      const lenE = east ? sectionLength(east, pitch) : lenW;
      const length = Math.max(lenW, lenE);

      addGondola(cx, zCenter, length, STOCK_ROWS);
      stockSection(west, new THREE.Vector3(cx - GONDOLA_HALF, 0, zCenter), -Math.PI / 2, pitch);
      if (east) {
        stockSection(east, new THREE.Vector3(cx + GONDOLA_HALF, 0, zCenter), Math.PI / 2, pitch);
      }
    }
  }

  /**
   * Split oversized genre buckets so each shelf face can fill solidly.
   * @param {Section[]} sections
   * @param {number} maxPerFace
   * @returns {Section[]}
   */
  function expandSections(sections, maxPerFace) {
    /** @type {Section[]} */
    const out = [];
    for (const section of sections) {
      if (section.items.length <= maxPerFace) {
        out.push(section);
        continue;
      }
      const chunks = Math.ceil(section.items.length / maxPerFace);
      for (let c = 0; c < chunks; c++) {
        const slice = section.items.slice(c * maxPerFace, (c + 1) * maxPerFace);
        out.push({
          id: `${section.id}-${c + 1}`,
          label: chunks > 1 ? `${section.label} ${c + 1}` : section.label,
          items: slice
        });
      }
    }
    return out;
  }

  /** @param {Section} section @param {number} pitch */
  function sectionLength(section, pitch) {
    const cols = Math.max(1, Math.ceil(section.items.length / STOCK_ROWS));
    return Math.min(MAX_AISLE_LEN, cols * pitch + 0.35);
  }

  /**
   * Double-sided aisle unit running along Z at center-line `cx`.
   * Planks only for stocked rows — no top ledge so the genre label stays clear.
   * @param {number} cx
   * @param {number} zCenter
   * @param {number} length
   * @param {number} rows
   */
  function addGondola(cx, zCenter, length, rows) {
    const metal = new THREE.MeshStandardMaterial({
      color: 0xd5dae0,
      roughness: 0.7,
      metalness: 0.15
    });
    // Extra band above the top plank for the genre placard on the spine
    const height = rows * SHELF.rowH + 0.55 + SHELF.rowH * 0.55;

    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(GONDOLA_HALF * 2 + SHELF.back, height, length + 0.2),
      metal
    );
    spine.position.set(cx, height / 2, zCenter);
    scene.add(spine);

    for (const side of [-1, 1]) {
      for (let r = 0; r < rows; r++) {
        const plank = new THREE.Mesh(
          new THREE.BoxGeometry(SHELF.depth, SHELF.thick, length),
          metal
        );
        const y = 0.42 + r * SHELF.rowH;
        plank.position.set(cx + side * (GONDOLA_HALF + SHELF.depth / 2 - 0.02), y, zCenter);
        // Tip ledge: outer edge lower so cases rest back into the spine
        plank.rotation.z = side * -0.16;
        scene.add(plank);
      }
    }

    const pad = 0.1;
    blockers.push({
      minX: cx - GONDOLA_HALF - SHELF.depth - pad,
      maxX: cx + GONDOLA_HALF + SHELF.depth + pad,
      minZ: zCenter - length / 2 - 0.15,
      maxZ: zCenter + length / 2 + 0.15
    });
  }

  /**
   * Fill stocked rows with cases; genre label mounts on the spine above them.
   * Allocates a full rectangular grid so trailing cells stay empty for reshelf.
   * @param {Section} section
   * @param {THREE.Vector3} origin
   * @param {number} facing
   * @param {number} pitch
   */
  function stockSection(section, origin, facing, pitch) {
    const cols = Math.max(1, Math.ceil(section.items.length / STOCK_ROWS));
    const runLen = cols * pitch;
    const start = -runLen / 2 + pitch / 2;

    addShelfLabels(origin, facing, section.label);

    let i = 0;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < STOCK_ROWS; r++) {
        const along = start + c * pitch;
        const y = 0.42 + r * SHELF.rowH + BOX.h / 2 + SHELF.thick * 0.5;
        const slot = createSlot(section.id, c, r, origin, facing, along, y);
        if (i < section.items.length) {
          occupy(slot, section.items[i++]);
        }
      }
    }
  }

  /**
   * @param {string} faceId
   * @param {number} col
   * @param {number} row
   * @param {THREE.Vector3} origin
   * @param {number} facing
   * @param {number} along
   * @param {number} y
   * @returns {ShelfSlot}
   */
  function createSlot(faceId, col, row, origin, facing, along, y) {
    const pos = slotWorldPosition(origin, facing, along, y);
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(BOX.w * 0.95, BOX.h * 0.9, Math.max(BOX.d * 2, 0.2)),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    proxy.position.copy(pos);
    proxy.rotation.y = facing;
    /** @type {ShelfSlot} */
    const slot = {
      faceId,
      col,
      row,
      origin: origin.clone(),
      facing,
      along,
      y,
      item: null,
      group: null,
      mesh: null,
      proxy
    };
    proxy.userData.slot = slot;
    scene.add(proxy);
    slots.push(slot);
    return slot;
  }

  /**
   * Build a blue/yellow genre placard texture.
   * @param {string} label
   * @returns {THREE.CanvasTexture}
   */
  function makeLabelTexture(label) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#123a8c';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = '#f5c518';
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, 500, 116);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 52;
      const text = label.toUpperCase();
      do {
        ctx.font = `800 ${size}px "Arial Black", Impact, sans-serif`;
        size -= 2;
      } while (ctx.measureText(text).width > 470 && size > 22);
      ctx.font = `800 ${size + 2}px "Arial Black", Impact, sans-serif`;
      ctx.fillText(text, 256, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Genre placard mounted on the spine above the top stocked row (no ledge in front).
   * @param {THREE.Vector3} origin
   * @param {number} facing
   * @param {string} label
   */
  function addShelfLabels(origin, facing, label) {
    const tex = makeLabelTexture(label);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide });
    const placardW = Math.min(1.05, 0.42 + label.length * 0.05);
    const placardH = 0.16;
    // Just above the highest cases, flush to the spine face
    const y = 0.42 + STOCK_ROWS * SHELF.rowH + placardH / 2;

    const face = new THREE.Mesh(new THREE.PlaneGeometry(placardW, placardH), mat);
    const local = new THREE.Vector3(0, y, 0.02);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
    face.position.copy(origin).add(local);
    face.rotation.y = facing;
    scene.add(face);
  }

  /**
   * Clear a stocked slot and return its contents for pickup.
   * @param {ShelfSlot} slot
   * @returns {{ item: CatalogItem, group: THREE.Group, mesh: THREE.Mesh } | null}
   */
  function vacate(slot) {
    const item = slot.item;
    const group = slot.group;
    const mesh = slot.mesh;
    if (!item || !group || !mesh) return null;

    slot.item = null;
    slot.group = null;
    slot.mesh = null;
    slot.proxy.visible = true;
    const idx = cases.indexOf(mesh);
    if (idx >= 0) cases.splice(idx, 1);

    return { item, group, mesh };
  }

  /**
   * Place an item into a slot. Creates a new case mesh unless `group` is provided
   * (reshelf / place animation complete).
   * @param {ShelfSlot} slot
   * @param {CatalogItem} item
   * @param {THREE.Group} [group]
   */
  function occupy(slot, item, group) {
    const pos = slotWorldPosition(slot.origin, slot.facing, slot.along, slot.y);
    /** @type {THREE.Group} */
    let caseGroup;
    /** @type {THREE.Mesh} */
    let mesh;

    if (group) {
      caseGroup = group;
      mesh = /** @type {THREE.Mesh} */ (group.children[0]);
      caseGroup.position.copy(pos);
      caseGroup.rotation.order = 'YXZ';
      caseGroup.rotation.y = slot.facing;
      caseGroup.rotation.x = CASE_LEAN;
      caseGroup.rotation.z = 0;
    } else {
      caseGroup = new THREE.Group();
      caseGroup.position.copy(pos);
      caseGroup.rotation.order = 'YXZ';
      caseGroup.rotation.y = slot.facing;
      caseGroup.rotation.x = CASE_LEAN;

      mesh = makeCaseMesh(item);
      caseGroup.add(mesh);
      scene.add(caseGroup);
      void resolvePoster(item, mesh);
    }

    mesh.userData.item = item;
    mesh.userData.slot = slot;
    caseGroup.userData.item = item;
    caseGroup.userData.slot = slot;

    slot.item = item;
    slot.group = caseGroup;
    slot.mesh = mesh;
    slot.proxy.visible = false;
    cases.push(mesh);
  }

  /** @returns {THREE.Mesh[]} */
  function emptyProxies() {
    return slots.filter((s) => !s.item).map((s) => s.proxy);
  }

  return {
    slots,
    cases,
    blockers,
    stockStore,
    vacate,
    occupy,
    emptyProxies,
    slotWorldPosition,
    slotWorldQuaternion
  };
}

/**
 * @param {THREE.Vector3} origin
 * @param {number} facing
 * @param {number} along
 * @param {number} y
 */
export function slotWorldPosition(origin, facing, along, y) {
  const frontZ = SHELF.depth * 0.22;
  const local = new THREE.Vector3(along, y, frontZ);
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
  return origin.clone().add(local);
}

/**
 * @param {ShelfSlot} slot
 */
export function slotWorldQuaternion(slot) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(CASE_LEAN, slot.facing, 0, 'YXZ'));
}
