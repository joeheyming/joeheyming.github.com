/**
 * "Paint trail" mode — when enabled, the active fingertip (touch
 * primary pointer or air-mode right-hand index tip) leaves a glowing
 * rainbow trail on a pad-sized canvas. Trail particles fade out over
 * a few seconds so the canvas never gets too cluttered.
 *
 * Inspired by the rainbow cursor effect in /awesome/awesome-cursor.js
 * — same particle-pool + per-frame rAF + hue-cycling pattern, scoped
 * to the theremin pad and driven by hand-tracking instead of mouse.
 *
 * The paint canvas sits between the webcam video and the hand-skeleton
 * overlay so the skeleton + touch markers stay on top and remain
 * readable. Stacking is enforced via CSS z-index, not DOM order.
 *
 *   getTip()     → { xNorm, yNorm } | null  — pad-relative 0..1 coords
 *                  of the active fingertip, or null when no input.
 *   isEnabled()  → boolean — whether the user has the Paint toggle on.
 *
 * Returns `{ canvas, clear }`. The recorder uses `canvas` to composite
 * the trail into recorded video; `clear` is exposed for future "wipe"
 * UI but not currently bound to anything.
 */

const PARTICLE_BASE_SIZE = 5;
const PARTICLE_SIZE_VAR = 7;
const PARTICLE_BASE_DECAY = 0.012;
const PARTICLE_DECAY_VAR = 0.012;
const PARTICLE_SHRINK = 0.97;
const HUE_STEP = 6; // degrees per particle — full hue cycle every ~60 particles
const MAX_INTERP_STEPS = 8; // smooth fingertip jumps with up to N intermediate particles
const INTERP_PIXEL_STEP = 4; // one particle per ~4 px of fingertip travel

export const initPaint = ({ padEl, isEnabled, getTip }) => {
  const canvas = document.createElement('canvas');
  canvas.className = 'theremin-paint';
  canvas.setAttribute('aria-hidden', 'true');

  // Insert before the overlay (the hand-skeleton canvas) so it ends
  // up earlier in DOM. Stacking still relies on CSS z-index but DOM
  // ordering keeps the document tidy and matches reading order.
  const overlay = padEl.querySelector('.theremin-overlay');
  if (overlay) padEl.insertBefore(canvas, overlay);
  else padEl.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  let particles = [];
  let hue = 0;
  let lastX = null;
  let lastY = null;
  let canvasW = 0;
  let canvasH = 0;

  /**
   * Resize the canvas backing store to match the pad's box at full
   * device-pixel-ratio (capped at 2 for affordability on retina
   * phones). Clears outstanding particles because their pixel coords
   * stop being meaningful when the box reflows.
   */
  const sizeCanvas = () => {
    const rect = padEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasW = rect.width;
    canvasH = rect.height;
    particles = [];
    ctx.clearRect(0, 0, canvasW, canvasH);
  };
  sizeCanvas();

  const createParticle = (x, y, h) => ({
    x,
    y,
    size: PARTICLE_BASE_SIZE + Math.random() * PARTICLE_SIZE_VAR,
    life: 1,
    decay: PARTICLE_BASE_DECAY + Math.random() * PARTICLE_DECAY_VAR,
    hue: h
  });

  const animate = () => {
    requestAnimationFrame(animate);
    if (!canvasW || !canvasH) return;

    const tip = getTip?.();
    if (isEnabled?.() && tip) {
      const x = tip.xNorm * canvasW;
      const y = tip.yNorm * canvasH;

      if (lastX !== null) {
        // Interpolate intermediate particles for any jumps bigger
        // than INTERP_PIXEL_STEP — without this, fast hand motion or
        // a 60→30 fps frame skip would leave gaps in the trail.
        const dx = x - lastX;
        const dy = y - lastY;
        const dist = Math.hypot(dx, dy);
        const steps = Math.min(Math.floor(dist / INTERP_PIXEL_STEP), MAX_INTERP_STEPS);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          particles.push(createParticle(lastX + dx * t, lastY + dy * t, hue));
          hue = (hue + HUE_STEP) % 360;
        }
      }

      particles.push(createParticle(x, y, hue));
      hue = (hue + HUE_STEP) % 360;
      lastX = x;
      lastY = y;
    } else {
      // No tip → break the interpolation chain so the next "paint
      // start" doesn't connect a fresh dot to the last released
      // position with an unintended streak.
      lastX = null;
      lastY = null;
    }

    ctx.clearRect(0, 0, canvasW, canvasH);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= p.decay;
      p.size *= PARTICLE_SHRINK;
      if (p.life <= 0 || p.size < 1) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = `hsl(${p.hue}, 92%, 65%)`;
      ctx.shadowColor = `hsl(${p.hue}, 92%, 60%)`;
      ctx.shadowBlur = p.size * 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };
  animate();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeCanvas, 120);
  });

  const clear = () => {
    particles = [];
    ctx.clearRect(0, 0, canvasW, canvasH);
  };

  return { canvas, clear };
};
