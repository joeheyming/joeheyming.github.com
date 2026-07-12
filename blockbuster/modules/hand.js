import * as THREE from 'three';
import { BOX, CASE_LEAN } from './constants.js';
import { clamp } from './util.js';

/** Camera-local palm targets — kept high enough to stay on-screen at FOV 72. */
export const HAND_REST = new THREE.Vector3(0.28, -0.26, -0.38);
export const HAND_INSPECT = new THREE.Vector3(0.06, -0.08, -0.52);
export const HAND_CARRY = new THREE.Vector3(0.18, -0.16, -0.48);

/**
 * Grab socket on the case (local to case group): bottom edge, slightly toward the cover.
 * Hand palmSocket aligns to this — Unreal/Unity “attach transform” style.
 */
export const CASE_GRAB_LOCAL = new THREE.Vector3(0, -BOX.h * 0.48, BOX.d * 0.2);

/** Viewmodel scale while carrying (full size looks like a door in your face). */
export const PALM_CASE_SCALE = 0.52;
/** Hold lean matches shelf face-out (top tips slightly away from viewer). */
export const HOLD_LEAN = CASE_LEAN;

/** Steve classic arm pixel width (4px) at viewmodel scale. */
const ARM_W = 0.1;
const SHOULDER_LOCAL = new THREE.Vector3(0.26, -0.18, 0.06);
const UPPER_LEN = 0.32;
const LOWER_LEN = 0.3;
const POLE_HINT = new THREE.Vector3(0.55, -0.85, 0.15);
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bendAxis = new THREE.Vector3();
const _bendDir = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _toWrist = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _grabScaled = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _boneFwd = new THREE.Vector3(0, 0, -1);
const _camPos = new THREE.Vector3();
const _palmPos = new THREE.Vector3();
const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _desiredQuat = new THREE.Quaternion();
const _palmQuat = new THREE.Quaternion();
const _leanQ = new THREE.Quaternion();
const _leanEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * World-space grab socket on a case (fingers aim here / attach aligns here).
 * @param {THREE.Object3D} caseGroup
 * @param {THREE.Vector3} out
 */
export function caseGrabHandleWorld(caseGroup, out) {
  caseGroup.updateMatrixWorld(true);
  return caseGroup.localToWorld(out.copy(CASE_GRAB_LOCAL));
}

/**
 * Palm-local pose: cover (+Z) faces the camera like a face-out shelf case,
 * with shelf lean, grab socket seated on the palm origin.
 * @param {THREE.Vector3} outPos
 * @param {THREE.Quaternion} outQuat
 * @param {THREE.Object3D} palmSocket
 * @param {THREE.Camera} camera
 * @param {{ scale?: number, lean?: number, swayY?: number }} [opts]
 */
export function computePalmHoldPose(outPos, outQuat, palmSocket, camera, opts = {}) {
  const scale = opts.scale ?? PALM_CASE_SCALE;
  const lean = opts.lean ?? HOLD_LEAN;
  const swayY = opts.swayY ?? 0;

  palmSocket.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(_camPos);
  palmSocket.getWorldPosition(_palmPos);

  // Cover normal toward the viewer (same idea as aisle face-out)
  _axisZ.subVectors(_camPos, _palmPos);
  if (_axisZ.lengthSq() < 1e-8) _axisZ.set(0, 0, 1);
  else _axisZ.normalize();

  _axisX.crossVectors(_worldUp, _axisZ);
  if (_axisX.lengthSq() < 1e-8) _axisX.set(1, 0, 0);
  else _axisX.normalize();
  _axisY.crossVectors(_axisZ, _axisX).normalize();

  _basis.makeBasis(_axisX, _axisY, _axisZ);
  _desiredQuat.setFromRotationMatrix(_basis);
  // Shelf-style lean + optional inspect sway
  _leanEuler.set(lean, swayY, 0, 'YXZ');
  _leanQ.setFromEuler(_leanEuler);
  _desiredQuat.multiply(_leanQ);

  palmSocket.getWorldQuaternion(_palmQuat);
  outQuat.copy(_palmQuat).invert().multiply(_desiredQuat);

  _grabScaled.copy(CASE_GRAB_LOCAL).multiplyScalar(scale);
  outPos.copy(_grabScaled).applyQuaternion(outQuat).multiplyScalar(-1);
  return { pos: outPos, quat: outQuat };
}

/**
 * Flat Minecraft-style box (no smooth shading).
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material} mat
 * @param {THREE.Vector3} pos
 */
function voxel(w, h, d, mat, pos) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.copy(pos);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Classic Steve right-arm FPS viewmodel — cyan sleeve + block hand.
 * @returns {THREE.Group}
 */
export function createHand() {
  // Classic Steve palette, flat-shaded
  const sleeve = new THREE.MeshLambertMaterial({
    color: 0x00a8a8,
    flatShading: true,
    emissive: new THREE.Color(0x003838),
    emissiveIntensity: 0.15
  });
  const skin = new THREE.MeshLambertMaterial({
    color: 0xc68642,
    flatShading: true,
    emissive: new THREE.Color(0x3a2010),
    emissiveIntensity: 0.12
  });

  const shoulder = new THREE.Group();
  shoulder.name = 'armShoulder';
  shoulder.position.copy(SHOULDER_LOCAL);

  const upper = new THREE.Group();
  shoulder.add(upper);
  // Sleeve segment along −Z (IK bone forward)
  upper.add(voxel(ARM_W, ARM_W, UPPER_LEN, sleeve, new THREE.Vector3(0, 0, -UPPER_LEN / 2)));

  const lower = new THREE.Group();
  lower.position.z = -UPPER_LEN;
  upper.add(lower);
  lower.add(voxel(ARM_W, ARM_W, LOWER_LEN, sleeve, new THREE.Vector3(0, 0, -LOWER_LEN / 2)));

  const wrist = new THREE.Group();
  wrist.position.z = -LOWER_LEN;
  lower.add(wrist);

  // 4×4×4 hand cube — classic Steve fist
  const handCube = voxel(ARM_W, ARM_W, ARM_W, skin, new THREE.Vector3(0, 0, -ARM_W / 2));
  wrist.add(handCube);

  // Tiny block thumb on the screen-center side (−X) for a bit of grip read
  const thumb = new THREE.Group();
  thumb.position.set(-ARM_W * 0.55, 0, -ARM_W * 0.35);
  thumb.add(
    voxel(ARM_W * 0.45, ARM_W * 0.45, ARM_W * 0.55, skin, new THREE.Vector3(0, 0, -ARM_W * 0.2))
  );
  wrist.add(thumb);

  const palmSocket = new THREE.Group();
  palmSocket.name = 'palmSocket';
  // Front face of the hand cube — where the case grab socket seats
  palmSocket.position.set(0, 0, -ARM_W * 0.95);
  wrist.add(palmSocket);

  shoulder.userData.upper = upper;
  shoulder.userData.lower = lower;
  shoulder.userData.wrist = wrist;
  shoulder.userData.palmSocket = palmSocket;
  shoulder.userData.fingers = [];
  shoulder.userData.thumb = thumb;
  shoulder.userData.upperLen = UPPER_LEN;
  shoulder.userData.lowerLen = LOWER_LEN;

  setHandReach(shoulder, HAND_REST);
  setHandGrip(shoulder, 0.22);
  shoulder.visible = true;
  return shoulder;
}

/**
 * @param {THREE.Group} arm
 * @returns {THREE.Group}
 */
export function getPalmSocket(arm) {
  return /** @type {THREE.Group} */ (arm.userData.palmSocket);
}

/**
 * Two-bone IK: bend elbow so the wrist reaches a camera-local target.
 * @param {THREE.Group} arm
 * @param {THREE.Vector3} cameraLocalTarget
 * @param {THREE.Vector3} [poleHint]
 */
export function setHandReach(arm, cameraLocalTarget, poleHint) {
  const upper = /** @type {THREE.Group} */ (arm.userData.upper);
  const lower = /** @type {THREE.Group} */ (arm.userData.lower);
  const upperLen = /** @type {number} */ (arm.userData.upperLen);
  const lowerLen = /** @type {number} */ (arm.userData.lowerLen);

  const target = _target.copy(cameraLocalTarget).sub(arm.position);
  let dist = target.length();
  const maxReach = upperLen + lowerLen - 0.012;
  const minReach = Math.abs(upperLen - lowerLen) + 0.02;
  dist = clamp(dist, minReach, maxReach);
  target.setLength(dist);

  const dir = _dir.copy(target).normalize();
  const pole = _pole.copy(poleHint || POLE_HINT).normalize();
  const bendAxis = _bendAxis.crossVectors(dir, pole);
  if (bendAxis.lengthSq() < 1e-6) {
    bendAxis.crossVectors(dir, new THREE.Vector3(0, 0, 1));
  }
  bendAxis.normalize();
  const bendDir = _bendDir.crossVectors(bendAxis, dir).normalize();

  const a = (upperLen * upperLen - lowerLen * lowerLen + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upperLen * upperLen - a * a));
  const elbow = _elbow.copy(dir).multiplyScalar(a).addScaledVector(bendDir, h);

  orientBoneAlong(upper, elbow);

  const toWrist = _toWrist.copy(target).sub(elbow).normalize();
  _invQ.copy(upper.quaternion).invert();
  const localDir = _localDir.copy(toWrist).applyQuaternion(_invQ);
  orientBoneAlong(lower, localDir);

  const wrist = /** @type {THREE.Group} */ (arm.userData.wrist);
  // Slight tip so the block fist faces the case
  wrist.rotation.set(0.2, 0.08, -0.18);
}

/**
 * @param {THREE.Group} bone
 * @param {THREE.Vector3} localEnd
 */
function orientBoneAlong(bone, localEnd) {
  const dir = _dir.copy(localEnd);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  bone.quaternion.setFromUnitVectors(_boneFwd, dir);
}

/**
 * Block-hand “grip”: tip the fist + fold the stub thumb.
 * @param {THREE.Group} arm
 * @param {number} amount
 */
export function setHandGrip(arm, amount) {
  const a = clamp(amount, 0, 1);
  const wrist = /** @type {THREE.Group | undefined} */ (arm.userData.wrist);
  if (wrist) {
    wrist.rotation.x = 0.2 + a * 0.25;
    wrist.rotation.z = -0.18 - a * 0.12;
  }
  const thumb = /** @type {THREE.Group | undefined} */ (arm.userData.thumb);
  if (thumb) {
    thumb.rotation.set(0.15 + a * 0.55, -0.35 - a * 0.4, -0.2 - a * 0.35);
  }
}
