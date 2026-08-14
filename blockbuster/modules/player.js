import * as THREE from 'three';
import {
  BOB_ROLL,
  BOB_X,
  BOB_Y,
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED,
  EYE_HEIGHT,
  MOVE_SPEED,
  PITCH_LIMIT,
  ROOM,
  SPRINT_SPEED,
  STEP_SPACING
} from './constants.js';
import { clamp } from './util.js';

/**
 * @param {{
 *   camera: THREE.PerspectiveCamera,
 *   getBlockers: () => { minX: number, maxX: number, minZ: number, maxZ: number }[],
 *   isLocked: () => boolean
 * }} opts
 */
export function createPlayer({ camera, getBlockers, isLocked }) {
  const keys = { w: false, a: false, s: false, d: false, crouch: false, sprint: false };
  let yaw = 0;
  let pitch = 0;
  /** Radians along the walk cycle (advances with distance moved). */
  let walkPhase = 0;
  /** Smooth 0→1 blend so bob eases in/out instead of popping. */
  let walkAmount = 0;
  /** Smooth 0→1 crouch blend (Shift / sneak). */
  let crouchAmount = 0;
  /** Smooth 0→1 sprint blend (Ctrl). */
  let sprintAmount = 0;
  let lastStepIndex = -1;
  /** @type {AudioContext | null} */
  let audioCtx = null;

  const player = { x: 0, z: ROOM.d / 2 - 1.6 };

  /**
   * @param {'w'|'a'|'s'|'d'|'crouch'|'sprint'} key
   * @param {boolean} down
   */
  function setKey(key, down) {
    keys[key] = down;
  }

  /** Soft carpet footstep via Web Audio (no asset files). @param {number} stepIndex */
  function playFootstep(stepIndex) {
    try {
      if (!audioCtx) {
        const AC =
          window.AudioContext ||
          /** @type {typeof AudioContext | undefined} */ (window).webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') void audioCtx.resume();

      const t0 = audioCtx.currentTime;
      // Short noise burst through a lowpass = soft carpet thud
      const dur = 0.07;
      const buffer = audioCtx.createBuffer(
        1,
        Math.floor(audioCtx.sampleRate * dur),
        audioCtx.sampleRate
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const env = 1 - i / data.length;
        data[i] = (Math.random() * 2 - 1) * env * env;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420 + (stepIndex % 2) * 40;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.01);
    } catch {
      /* autoplay / AudioContext blocked — bob still works */
    }
  }

  /** @param {number} x @param {number} z */
  function collides(x, z) {
    const r = 0.28;
    for (const b of getBlockers()) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }

  /** @param {number} dt */
  function update(dt) {
    const locked = isLocked();
    const crouchTarget = keys.crouch ? 1 : 0;
    crouchAmount += (crouchTarget - crouchAmount) * Math.min(1, dt * 12);
    const crouching = crouchAmount > 0.5;
    // Crouch wins over sprint (Minecraft)
    const sprintTarget =
      keys.sprint && !keys.crouch && (keys.w || keys.s || keys.a || keys.d) ? 1 : 0;
    sprintAmount += (sprintTarget - sprintAmount) * Math.min(1, dt * 8);

    const forward = locked ? 0 : (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    const strafe = locked ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    const wantMove = forward !== 0 || strafe !== 0;
    const speed =
      MOVE_SPEED *
      (1 - crouchAmount * (1 - CROUCH_SPEED)) *
      (1 + sprintAmount * (SPRINT_SPEED - 1));

    let moved = 0;
    if (wantMove) {
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Normalize diagonal so strafe+forward isn't faster
      const len = Math.hypot(forward, strafe) || 1;
      const dx = ((-forward * sin + strafe * cos) / len) * speed * dt;
      const dz = ((-forward * cos - strafe * sin) / len) * speed * dt;
      const prevX = player.x;
      const prevZ = player.z;
      const nextX = player.x + dx;
      const nextZ = player.z + dz;
      if (!collides(nextX, player.z)) player.x = nextX;
      if (!collides(player.x, nextZ)) player.z = nextZ;

      const margin = 0.55;
      player.x = clamp(player.x, -ROOM.w / 2 + margin, ROOM.w / 2 - margin);
      player.z = clamp(player.z, -ROOM.d / 2 + margin, ROOM.d / 2 - margin);
      moved = Math.hypot(player.x - prevX, player.z - prevZ);
    }

    // Ease walkAmount toward moving/idle (smoother than a hard snap)
    const walkTarget = moved > 0.0005 ? 1 : 0;
    const ease = walkTarget ? 5 : 4;
    walkAmount += (walkTarget - walkAmount) * Math.min(1, dt * ease);
    // Sneak damps head-bob; sprint pumps it
    const bobScale = (1 - crouchAmount * 0.85) * (1 + sprintAmount * 0.55);
    const bob = walkAmount * walkAmount * (3 - 2 * walkAmount) * bobScale; // smoothstep

    if (moved > 0) {
      walkPhase += (moved / STEP_SPACING) * Math.PI;
    }

    // Vertical bob at 2× stride; lateral/roll at stride — soft adult gait
    const bobY = Math.sin(walkPhase * 2) * BOB_Y * bob;
    const bobX = Math.sin(walkPhase) * BOB_X * bob;
    const bobRoll = Math.cos(walkPhase) * BOB_ROLL * bob;

    // Footfall click at each low point of the vertical bob
    const stepIndex = Math.floor(walkPhase / Math.PI);
    if (bob > 0.4 && !crouching && stepIndex !== lastStepIndex) {
      lastStepIndex = stepIndex;
      playFootstep(stepIndex);
    }

    const eyeY = EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * crouchAmount;

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = bobRoll;
    camera.position.set(
      player.x + bobX * Math.cos(yaw),
      eyeY + bobY,
      player.z + bobX * Math.sin(yaw)
    );
  }

  return {
    player,
    update,
    setKey,
    get yaw() {
      return yaw;
    },
    set yaw(v) {
      yaw = v;
    },
    get pitch() {
      return pitch;
    },
    set pitch(v) {
      pitch = clamp(v, -PITCH_LIMIT, PITCH_LIMIT);
    },
    /** Clear WASD while an animation locks movement (keeps Shift/Ctrl modifiers). */
    clearKeys() {
      keys.w = keys.a = keys.s = keys.d = false;
    },
    /** Walk cycle for idle hand sway. */
    getWalk() {
      return { phase: walkPhase, amount: walkAmount };
    }
  };
}
