import * as THREE from 'three';
import { bezier2, easeInOut, easeOutCubic } from './util.js';
import {
  HAND_CARRY,
  HAND_INSPECT,
  HAND_REST,
  PALM_CASE_SCALE,
  caseGrabHandleWorld,
  computePalmHoldPose,
  getPalmSocket,
  setHandGrip,
  setHandReach
} from './hand.js';

/**
 * @typedef {import('./catalog.js').CatalogItem} CatalogItem
 * @typedef {import('./inventory.js').ShelfSlot} ShelfSlot
 */

/** @typedef {'idle'|'grabbing'|'inspecting'|'holding'|'placing'|'inserting'|'renting'} PickupState */

const GRAB_ANTICIPATE = 0.14;
const GRAB_REACH = 0.48;
const GRAB_CLOSE = 0.2;
const GRAB_PULL = 0.55;
const GRAB_TOTAL = GRAB_ANTICIPATE + GRAB_REACH + GRAB_CLOSE + GRAB_PULL;

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   hand: THREE.Group,
 *   inventory: ReturnType<import('./inventory.js').createInventory>,
 *   hud: ReturnType<import('./hud.js').createHud>,
 *   getWallTv: () => { hit: THREE.Mesh | null, insertPos: THREE.Vector3 },
 *   onRent: (item: CatalogItem) => void,
 *   clearKeys?: () => void,
 *   getWalk?: () => { phase: number, amount: number }
 * }} opts
 */
export function createPickup({
  scene,
  camera,
  hand,
  inventory,
  hud,
  getWallTv,
  onRent,
  clearKeys,
  getWalk
}) {
  /** @type {PickupState} */
  let pickupState = 'idle';
  /** @type {CatalogItem | null} */
  let heldItem = null;
  /** @type {THREE.Group | null} */
  let heldGroup = null;
  /** @type {ShelfSlot | null} */
  let placeTarget = null;
  let animElapsed = 0;
  let grabAttached = false;

  /** @type {CatalogItem | null} */
  let aimed = null;
  /** @type {THREE.Mesh | null} */
  let aimedMesh = null;
  /** @type {ShelfSlot | null} */
  let aimedSlot = null;
  let aimedTv = false;

  const placeStartPos = new THREE.Vector3();
  const placeStartQuat = new THREE.Quaternion();
  const grabHandleWorld = new THREE.Vector3();
  const grabHandleLocal = new THREE.Vector3();
  const reachFrom = new THREE.Vector3();
  const reachMid = new THREE.Vector3();
  const reachTo = new THREE.Vector3();
  const reachPos = new THREE.Vector3();
  const anticipatePos = new THREE.Vector3();
  const palmCasePos = new THREE.Vector3();
  const palmCaseQuat = new THREE.Quaternion();
  const caseSettlePos = new THREE.Vector3();
  const caseSettleQuat = new THREE.Quaternion();
  const contactReach = new THREE.Vector3();
  const idleReach = new THREE.Vector3().copy(HAND_REST);
  const _tmpV = new THREE.Vector3();
  const ndcCenter = new THREE.Vector2(0, 0);

  /** Cover faces the camera (shelf face-out), seated on the palm grab socket. */
  function refreshHoldPose(swayY = 0) {
    computePalmHoldPose(palmCasePos, palmCaseQuat, getPalmSocket(hand), camera, {
      scale: PALM_CASE_SCALE,
      swayY
    });
  }

  function isLocked() {
    return (
      pickupState === 'grabbing' ||
      pickupState === 'inspecting' ||
      pickupState === 'placing' ||
      pickupState === 'inserting' ||
      pickupState === 'renting'
    );
  }

  function resetAim() {
    aimed = null;
    aimedMesh = null;
    aimedSlot = null;
    aimedTv = false;
  }

  function startGrab() {
    if (pickupState !== 'idle' || !aimedMesh) return;
    const slot = /** @type {ShelfSlot | undefined} */ (aimedMesh.userData.slot);
    if (!slot) return;
    const vacated = inventory.vacate(slot);
    if (!vacated) return;

    heldItem = vacated.item;
    heldGroup = vacated.group;
    caseGrabHandleWorld(vacated.group, grabHandleWorld);
    resetAim();

    grabAttached = false;
    animElapsed = 0;
    pickupState = 'grabbing';
    hand.visible = true;
    setHandReach(hand, HAND_REST);
    setHandGrip(hand, 0.08);
    hud.setBusy(true);
    clearKeys?.();
    hud.showStatus(vacated.item.name, vacated.item.tagline || '', 'Picking up…');
    if (typeof window.trackEvent === 'function') {
      window.trackEvent(
        'blockbuster_pickup',
        'entertainment',
        `${vacated.item.kind}:${vacated.item.id}`
      );
    }
  }

  function startPlace() {
    if (pickupState !== 'holding' || !aimedSlot || !heldItem || !heldGroup) return;
    placeTarget = aimedSlot;
    scene.attach(heldGroup);
    heldGroup.scale.setScalar(1);
    placeStartPos.copy(heldGroup.position);
    placeStartQuat.copy(heldGroup.quaternion);
    animElapsed = 0;
    pickupState = 'placing';
    hud.setBusy(true);
    clearKeys?.();
    hud.showStatus(heldItem.name, '', 'Shelving…');
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('blockbuster_place', 'entertainment', `${heldItem.kind}:${heldItem.id}`);
    }
  }

  function startInsertTv() {
    if (pickupState !== 'holding' || !heldItem || !heldGroup || !aimedTv) return;
    scene.attach(heldGroup);
    heldGroup.scale.setScalar(1);
    placeStartPos.copy(heldGroup.position);
    placeStartQuat.copy(heldGroup.quaternion);
    animElapsed = 0;
    pickupState = 'inserting';
    hud.setBusy(true);
    clearKeys?.();
    aimedTv = false;
    hud.showStatus(heldItem.name, '', 'Inserting…');
    if (typeof window.trackEvent === 'function') {
      window.trackEvent(
        'blockbuster_tv_insert',
        'entertainment',
        `${heldItem.kind}:${heldItem.id}`
      );
    }
  }

  function rentHeld() {
    if (!heldItem) return;
    if (pickupState !== 'holding' && pickupState !== 'inserting') return;
    pickupState = 'renting';
    hud.setBusy(true);
    onRent(heldItem);
  }

  function onInteract() {
    if (isLocked()) return;
    if (pickupState === 'holding') {
      if (aimedTv) startInsertTv();
      else if (aimedSlot) startPlace();
      return;
    }
    if (aimedMesh) startGrab();
  }

  function onRentOrGrabKey() {
    if (isLocked()) return;
    if (pickupState === 'holding') {
      rentHeld();
      return;
    }
    if (aimedMesh) startGrab();
  }

  /**
   * @param {THREE.Raycaster} raycaster
   * @param {THREE.Camera} cam
   */
  function updateAim(raycaster, cam) {
    if (isLocked()) return;

    raycaster.setFromCamera(ndcCenter, cam);
    const { hit: wallTvHit } = getWallTv();

    if (pickupState === 'holding') {
      /** @type {THREE.Object3D[]} */
      const aimables = inventory.emptyProxies();
      if (wallTvHit) aimables.push(wallTvHit);
      const hits = raycaster.intersectObjects(aimables, false);
      const hit = hits.find((h) => h.distance < 6);
      const isTv = !!(hit && hit.object.userData.isWallTv);
      const nextSlot = hit && !isTv ? /** @type {ShelfSlot} */ (hit.object.userData.slot) : null;
      if (isTv === aimedTv && nextSlot === aimedSlot) return;
      aimedTv = isTv;
      aimedSlot = nextSlot;
      aimed = null;
      aimedMesh = null;
      if (heldItem) hud.showHolding({ heldItem, aimedSlot, aimedTv });
      return;
    }

    const caseHits = raycaster.intersectObjects(inventory.cases, false);
    const caseHit = caseHits.find((h) => h.distance < 5);
    if (caseHit) {
      /** @type {THREE.Mesh} */
      const nextMesh = /** @type {THREE.Mesh} */ (caseHit.object);
      /** @type {CatalogItem | null} */
      const next = nextMesh.userData.item || null;
      if (next?.id === aimed?.id && next?.kind === aimed?.kind) return;
      aimed = next;
      aimedMesh = nextMesh;
      aimedSlot = null;
      aimedTv = false;
      if (aimed) hud.showIdleTarget(aimed);
      else {
        resetAim();
        hud.clearTarget();
      }
      return;
    }

    if (wallTvHit) {
      const tvHits = raycaster.intersectObject(wallTvHit, false);
      const tvHit = tvHits.find((h) => h.distance < 6);
      if (tvHit) {
        if (aimedTv && !aimed) return;
        aimed = null;
        aimedMesh = null;
        aimedSlot = null;
        aimedTv = true;
        hud.showDemoTv();
        return;
      }
    }

    if (aimed || aimedMesh || aimedTv) {
      resetAim();
      hud.clearTarget();
    }
  }

  /** Seat the case in the palm socket, preserving world pose then settling. */
  function attachCaseToPalm() {
    if (!heldGroup || grabAttached) return;
    contactReach.copy(grabHandleLocal);
    const socket = getPalmSocket(hand);
    socket.attach(heldGroup);
    caseSettlePos.copy(heldGroup.position);
    caseSettleQuat.copy(heldGroup.quaternion);
    grabAttached = true;
  }

  /**
   * @param {number} settleT 0 just attached → 1 seated in palm
   */
  function settleCaseInPalm(settleT) {
    if (!heldGroup) return;
    refreshHoldPose();
    const t = easeOutCubic(clamp01(settleT));
    heldGroup.position.lerpVectors(caseSettlePos, palmCasePos, t);
    heldGroup.quaternion.slerpQuaternions(caseSettleQuat, palmCaseQuat, t);
    const s = 1 + (PALM_CASE_SCALE - 1) * t;
    heldGroup.scale.setScalar(s);
  }

  /** @param {number} t */
  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  /** Idle hand: clearly in frame, walks with a sway, reaches when aiming. */
  function updateIdleHand(dt) {
    hand.visible = true;
    const walk = getWalk?.() || { phase: 0, amount: 0 };
    const bob = walk.amount * walk.amount * (3 - 2 * walk.amount);
    // Slow idle breath so the hand never looks frozen / clipped away
    const breath = Math.sin(performance.now() * 0.0022) * 0.012;

    reachPos.copy(HAND_REST);
    reachPos.x += Math.sin(walk.phase) * 0.028 * bob + breath * 0.4;
    reachPos.y += Math.sin(walk.phase * 2) * 0.022 * bob + breath;
    reachPos.z += Math.cos(walk.phase) * 0.018 * bob;

    // Stronger telegraph when a case is aimed
    if (aimedMesh) {
      const slot = /** @type {ShelfSlot | undefined} */ (aimedMesh.userData.slot);
      const group = slot?.group;
      if (group) {
        caseGrabHandleWorld(group, grabHandleWorld);
        camera.updateMatrixWorld(true);
        camera.worldToLocal(_tmpV.copy(grabHandleWorld));
        const dist = _tmpV.distanceTo(HAND_REST);
        const blend = dist < 3.2 ? 0.42 : 0.2;
        reachPos.lerp(_tmpV, blend);
        // Keep the palm from diving under the frustum while pointing
        reachPos.y = Math.max(reachPos.y, -0.34);
      }
    }

    idleReach.lerp(reachPos, 1 - Math.exp(-10 * dt));
    setHandReach(hand, idleReach);
    setHandGrip(hand, aimedMesh ? 0.42 : 0.22);
  }

  /** @param {number} dt */
  function update(dt) {
    if (pickupState === 'idle') {
      updateIdleHand(dt);
      return;
    }

    if (pickupState === 'holding') {
      // Soft follow carry pose — case rides the palm socket
      reachPos.lerp(HAND_CARRY, 1 - Math.exp(-7 * dt));
      setHandReach(hand, reachPos);
      // Lighter curl so fingers cup the case bottom instead of digging into the cover
      setHandGrip(hand, 0.62);
      if (heldGroup && heldGroup.parent === getPalmSocket(hand)) {
        refreshHoldPose();
        heldGroup.position.lerp(palmCasePos, 1 - Math.exp(-6 * dt));
        heldGroup.quaternion.slerp(palmCaseQuat, 1 - Math.exp(-6 * dt));
        heldGroup.scale.setScalar(PALM_CASE_SCALE);
      }
      return;
    }

    animElapsed += dt;

    if (pickupState === 'grabbing' && heldGroup) {
      updateGrabbing();
      return;
    }

    if (pickupState === 'inspecting' && heldGroup) {
      const dur = 1.0;
      const sway = Math.sin(animElapsed * 2.4) * 0.08;
      const tip = Math.sin(animElapsed * 1.7) * 0.04;
      reachPos.set(HAND_INSPECT.x + tip, HAND_INSPECT.y, HAND_INSPECT.z);
      setHandReach(hand, reachPos);
      setHandGrip(hand, 0.65);
      const wrist = /** @type {THREE.Group} */ (hand.userData.wrist);
      wrist.rotation.set(0.12 + sway * 0.3, 0.08 + sway, -0.18);
      if (heldGroup.parent === getPalmSocket(hand)) {
        refreshHoldPose(sway);
        heldGroup.position.copy(palmCasePos);
        heldGroup.quaternion.copy(palmCaseQuat);
        heldGroup.scale.setScalar(PALM_CASE_SCALE);
      }
      if (animElapsed >= dur) {
        pickupState = 'holding';
        animElapsed = 0;
        reachPos.copy(HAND_INSPECT);
        hud.setBusy(false);
        if (heldItem) hud.showHolding({ heldItem, aimedSlot, aimedTv });
      }
      return;
    }

    if (pickupState === 'placing' && heldGroup && placeTarget && heldItem) {
      const dur = 0.85;
      const u = easeInOut(Math.min(1, animElapsed / dur));
      const destPos = inventory.slotWorldPosition(
        placeTarget.origin,
        placeTarget.facing,
        placeTarget.along,
        placeTarget.y
      );
      const destQuat = inventory.slotWorldQuaternion(placeTarget);
      heldGroup.position.lerpVectors(placeStartPos, destPos, u);
      heldGroup.quaternion.slerpQuaternions(placeStartQuat, destQuat, u);
      camera.updateMatrixWorld(true);
      caseGrabHandleWorld(heldGroup, grabHandleWorld);
      const handTarget = camera.worldToLocal(_tmpV.copy(grabHandleWorld));
      setHandReach(hand, handTarget);
      setHandGrip(hand, 0.95 - u * 0.55);
      if (u >= 1) {
        inventory.occupy(placeTarget, heldItem, heldGroup);
        heldItem = null;
        heldGroup = null;
        placeTarget = null;
        idleReach.copy(HAND_REST);
        setHandReach(hand, HAND_REST);
        setHandGrip(hand, 0.12);
        hand.visible = true;
        pickupState = 'idle';
        hud.setBusy(false);
        resetAim();
        hud.clearTarget();
      }
      return;
    }

    if (pickupState === 'inserting' && heldGroup && heldItem) {
      const { insertPos: tvInsertPos } = getWallTv();
      const dur = 0.9;
      const u = easeInOut(Math.min(1, animElapsed / dur));
      heldGroup.position.lerpVectors(placeStartPos, tvInsertPos, u);
      heldGroup.quaternion.slerpQuaternions(placeStartQuat, palmCaseQuat, u);
      const s = 1 - u * 0.35;
      heldGroup.scale.setScalar(s);
      camera.updateMatrixWorld(true);
      caseGrabHandleWorld(heldGroup, grabHandleWorld);
      const handTarget = camera.worldToLocal(_tmpV.copy(grabHandleWorld));
      setHandReach(hand, handTarget);
      setHandGrip(hand, 0.9 - u * 0.45);
      if (u >= 1) {
        hand.visible = false;
        rentHeld();
      }
    }
  }

  function updateGrabbing() {
    if (!heldGroup) return;
    camera.updateMatrixWorld(true);
    caseGrabHandleWorld(heldGroup, grabHandleWorld);
    camera.worldToLocal(grabHandleLocal.copy(grabHandleWorld));

    const t = animElapsed;
    let phaseEnd = 0;

    // 1) Anticipate — pull back slightly, fingers open
    phaseEnd += GRAB_ANTICIPATE;
    if (t < phaseEnd) {
      const u = easeInOut(t / GRAB_ANTICIPATE);
      anticipatePos.copy(HAND_REST);
      anticipatePos.x += 0.04;
      anticipatePos.y -= 0.03;
      anticipatePos.z += 0.06;
      reachPos.lerpVectors(HAND_REST, anticipatePos, u);
      setHandReach(hand, reachPos);
      setHandGrip(hand, 0.08 * (1 - u));
      return;
    }

    // 2) Reach along an arc to the grab handle — fingers stay open
    const reachStart = phaseEnd;
    phaseEnd += GRAB_REACH;
    if (t < phaseEnd) {
      const u = easeInOut((t - reachStart) / GRAB_REACH);
      reachFrom.copy(anticipatePos.set(HAND_REST.x + 0.04, HAND_REST.y - 0.03, HAND_REST.z + 0.06));
      reachTo.copy(grabHandleLocal);
      reachMid.copy(reachFrom).lerp(reachTo, 0.45);
      reachMid.y += 0.1;
      reachMid.x += 0.06;
      bezier2(reachPos, reachFrom, reachMid, reachTo, u);
      setHandReach(hand, reachPos);
      setHandGrip(hand, 0.05 + u * 0.08);
      return;
    }

    // 3) Close grip on contact, then attach to palm socket
    const closeStart = phaseEnd;
    phaseEnd += GRAB_CLOSE;
    if (t < phaseEnd) {
      const u = easeOutCubic((t - closeStart) / GRAB_CLOSE);
      const reachTarget = grabAttached ? contactReach : grabHandleLocal;
      setHandReach(hand, reachTarget);
      setHandGrip(hand, 0.12 + u * 0.83);
      if (u > 0.35) attachCaseToPalm();
      if (grabAttached) settleCaseInPalm((u - 0.35) / 0.65);
      return;
    }

    // 4) Pull to inspect — case rides the palm
    const pullStart = phaseEnd;
    const u = easeInOut(Math.min(1, (t - pullStart) / GRAB_PULL));
    if (!grabAttached) {
      attachCaseToPalm();
    }
    settleCaseInPalm(1);
    reachFrom.copy(contactReach.lengthSq() > 0 ? contactReach : grabHandleLocal);
    reachTo.copy(HAND_INSPECT);
    reachMid.copy(reachFrom).lerp(reachTo, 0.5);
    reachMid.y += 0.06;
    bezier2(reachPos, reachFrom, reachMid, reachTo, u);
    setHandReach(hand, reachPos);
    setHandGrip(hand, 0.7);

    if (t >= GRAB_TOTAL) {
      pickupState = 'inspecting';
      animElapsed = 0;
      if (heldItem) hud.showStatus(heldItem.name, heldItem.tagline || '', 'Inspecting…');
    }
  }

  return {
    update,
    updateAim,
    onInteract,
    onRentOrGrabKey,
    isLocked,
    /** True while a case is carried and free to place / rent / insert. */
    isHolding() {
      return pickupState === 'holding';
    }
  };
}
