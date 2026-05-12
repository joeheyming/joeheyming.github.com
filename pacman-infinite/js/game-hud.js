import * as THREE from 'three';
import { GAMEPLAY, GAME_STATES, GHOST_STATE } from './constants.js';

// Watch radius (tiles) for the on-screen ghost proximity markers.
// Anything beyond this is "out of mind" — no marker drawn. The
// danger / imminent thresholds tier the marker colour + pulse rate
// inside the watch radius. Only the outer ring is a local constant;
// the imminent ring reuses GAMEPLAY.DANGER_WARNING_RADIUS so both
// stay coupled to the existing constant.
const GHOST_WARN_WATCH_TILES = 12;
const GHOST_WARN_DANGER_TILES = 8;
// Inset (fraction of viewport half-extent) where off-screen markers
// sit. 0.92 = 4 % padding from each edge. Big enough that the marker
// doesn't overlap any HUD element clinging to the corner; small enough
// that the marker reads as "edge of the play area".
const MARKER_EDGE_INSET = 0.92;
// Reusable temp Vector3 for projection — keeps per-frame allocs at
// ~0 even when there are a dozen threats in flight.
const _projectTmp = new THREE.Vector3();

export const gameHud = {
  /** Used by Controls.cycleCamera (also from the camera-toggle button).
   *  FPPOV → STRAFE (mouse-look + WASD twin-stick).
   *  Other modes → PERP (joystick / arrows = world directions). Follow
   *  used to be STRAFE but it conflicted with the tap-anywhere drive
   *  control and made Pacman walk *opposite* to the tap; see the
   *  matching comment in Controls.cycleCamera. */
  applyCameraModeUI(mode) {
    const isFirstPerson = mode === 2;
    if (this.pacman) {
      this.pacman.setVisible(!isFirstPerson);
      this.pacman.setKeyMode(isFirstPerson ? 1 : 2);
    }
    const mouthOverlay = document.getElementById('fps-mouth-overlay');
    if (mouthOverlay) mouthOverlay.classList.toggle('hidden', !isFirstPerson);
  },

  updateUI() {
    if (this.cameraModeElement && this.cameraController) {
      this.updateCameraModeDisplay();
    }
  },

  updateCameraModeDisplay() {
    if (this.cameraModeElement && this.cameraController) {
      // Single source of truth lives on the camera controller — keeps the
      // HUD label in sync if camera modes ever get renamed/reordered.
      this.cameraModeElement.textContent = this.cameraController.getModeName();
    }
  },

  refreshHud() {
    if (!this.world || !this.pacman) return;
    if (this.scoreElement) {
      this.scoreElement.textContent = String(this.score);
    }
    if (this.highScoreElement) {
      this.highScoreElement.textContent = String(this.highScore);
    }
    if (this.livesElement) {
      // Render lives as filled hearts. Empty hearts after a death give a
      // glance-readable "you have 1 life left" state.
      const filled = '\u2665'.repeat(Math.max(0, this.lives));
      const empty = '\u2661'.repeat(Math.max(0, GAMEPLAY.STARTING_LIVES - this.lives));
      this.livesElement.innerHTML = filled + `<span class="text-red-900/60">${empty}</span>`;
    }
    // Tier 3 — survival/runner readouts. Skip the writes when the
    // elements aren't in the DOM (e.g. older index.html / tests).
    if (this.farTilesElement) {
      this.farTilesElement.textContent = String(Math.round(this.world.farTilesFromOrigin?.() ?? 0));
    }
    if (this.scoreMultElement) {
      const distMul = this.world.scoreMultiplier ? this.world.scoreMultiplier() : 1;
      const streakMul = 1 + Math.min(2, Math.floor((this._dotStreak ?? 0) / 10) * 0.1);
      const total = distMul * streakMul;
      this.scoreMultElement.textContent = `×${total.toFixed(1)}`;
    }
    if (this.dotStreakElement) {
      this.dotStreakElement.textContent = String(this._dotStreak ?? 0);
    }
  },

  /**
   * Drive the hunger HUD bar each frame. Width tracks `food / FOOD_MAX`,
   * and the meter gets a `.low` class when food drops under
   * FOOD_LOW_THRESHOLD so the CSS pulses it red.
   */
  _refreshFoodHud() {
    if (!this.foodBarElement || !this.foodMeterElement) return;
    const max = GAMEPLAY.FOOD_MAX;
    const f = Math.max(0, Math.min(max, this.food));
    this.foodBarElement.style.width = `${(f / max) * 100}%`;
    const low = f < GAMEPLAY.FOOD_LOW_THRESHOLD;
    this.foodMeterElement.classList.toggle('low', low);
  },

  /**
   * Cause-specific copy used by the respawn overlay (between deaths
   * mid-run) and the GAME OVER screen (final death). Bold "title" plus
   * a quieter flavour line keeps the overlay glanceable.
   */
  _deathMessage(cause) {
    switch (cause) {
      case 'starvation':
        return { title: 'YOU STARVED', flavour: 'Eat more pellets to keep your hunger up.' };
      case 'void':
        return { title: 'FELL INTO THE VOID', flavour: 'Stay on solid ground.' };
      case 'ghost':
      default:
        return { title: 'A GHOST GOT YOU', flavour: 'Grab a power pill to fight back.' };
    }
  },

  /** Update the death-overlay copy + the GAME OVER flavour line. */
  _applyDeathMessage(cause) {
    const msg = this._deathMessage(cause);
    if (this.respawnTitle) this.respawnTitle.textContent = msg.title;
    if (this.respawnFlavour) this.respawnFlavour.textContent = msg.flavour;
    if (this.gameOverCauseElement) {
      // GAME OVER replaces "respawning" copy with a more final tone.
      const finalText =
        cause === 'starvation'
          ? 'You starved.'
          : cause === 'void'
          ? 'You fell into the void.'
          : 'A ghost got you.';
      this.gameOverCauseElement.textContent = finalText;
    }
  },

  /**
   * Drive the power-mode HUD bar each frame. Hidden when not powered.
   * Width is pacman.powerTimer / POWER_MODE_DURATION; the bar adds an
   * `expiring` class in the final 2 seconds for the CSS pulse.
   */
  _refreshPowerHud() {
    if (!this.powerTimerElement || !this.powerTimerBar) return;
    if (!this.pacman?.powered) {
      this.powerTimerElement.classList.add('hidden');
      this.powerTimerElement.classList.remove('expiring');
      this.container?.classList.remove('ghost-flee-glow');
      return;
    }
    this.powerTimerElement.classList.remove('hidden');
    // Bar fills against the duration the pill actually granted (which now
    // varies by difficulty), not the flat GAMEPLAY default — otherwise
    // Easy's 10 s window over-fills and Hard's 5 s window starts half-full.
    const dur = this.pacman.powerStartDuration || GAMEPLAY.POWER_MODE_DURATION;
    const frac = Math.max(0, Math.min(1, this.pacman.powerTimer / dur));
    this.powerTimerBar.style.width = `${frac * 100}%`;
    this.powerTimerElement.classList.toggle('expiring', this.pacman.powerTimer < 2);
    this.container?.classList.add('ghost-flee-glow');
  },

  /**
   * Tier-5 DASH HUD. Two-element readout (status text + charge bar)
   * driven by the sprint state machine on Pacman:
   *   • READY        — cyan text, full bar
   *   • DASH!        — white text + fast scale pulse + bar drains
   *                    100→0% over SPRINT_DURATION_S
   *   • Ns           — grey countdown text + bar refills 0→100% over
   *                    the cached `_sprintCooldownStart` denominator
   *
   * The bar is the primary feedback channel for FPPOV — the camera
   * is on Pacman's head so the cyan sprint glow on his body isn't
   * visible. In Top-Down / Birds-Eye the bar reinforces the body
   * glow with a precise charge readout. Either way, the visual
   * language is identical across all camera modes.
   *
   * Runs every frame so the cooldown bar fills smoothly. Skips
   * silently when the elements aren't in the DOM (test fixtures,
   * older index.html versions before the bar was added).
   */
  _refreshDashHud() {
    const el = this.dashStatusElement;
    if (!el || !this.pacman) return;
    const p = this.pacman;
    const bar = this.dashBarElement;
    // Fraction of "dash charge" available, 0..1. Phases:
    //   • ACTIVE   → drains from 1 to 0 as `sprintTimer` ticks down.
    //                Bar shrinking ⇒ "you're spending your burst".
    //   • COOLDOWN → fills from 0 to 1 as `sprintCooldown` ticks down,
    //                relative to the cached duration snapshot taken
    //                at sprint-end (`_sprintCooldownStart`). The
    //                snapshot is the reason we can't divide by
    //                `GAMEPLAY.SPRINT_COOLDOWN_S` here — if we ever
    //                difficulty-scale the cooldown the snapshot stays
    //                correct, the constant wouldn't.
    //   • READY    → 1 (full bar). Communicates "use it now".
    let dashFrac;
    if (p.sprintTimer > 0) {
      dashFrac = Math.max(0, Math.min(1, p.sprintTimer / GAMEPLAY.SPRINT_DURATION_S));
    } else if (p.sprintCooldown > 0) {
      const denom = p._sprintCooldownStart || GAMEPLAY.SPRINT_COOLDOWN_S;
      dashFrac = Math.max(0, Math.min(1, 1 - p.sprintCooldown / denom));
    } else {
      dashFrac = 1;
    }
    if (bar) bar.style.setProperty('--dash-frac', dashFrac.toFixed(3));

    if (p.sprintTimer > 0) {
      if (el.textContent !== 'DASH!') el.textContent = 'DASH!';
      if (!el.classList.contains('dash-active')) {
        el.classList.add('dash-active');
        el.classList.remove('dash-cooldown');
      }
      if (bar && !bar.classList.contains('dash-active')) {
        bar.classList.add('dash-active');
        bar.classList.remove('dash-cooldown');
      }
    } else if (p.sprintCooldown > 0) {
      // 1-decimal countdown (e.g. "2.4s"). Reads as a refill timer
      // rather than a "DASH" indicator so the player understands
      // they're waiting for it back.
      const text = `${p.sprintCooldown.toFixed(1)}s`;
      if (el.textContent !== text) el.textContent = text;
      if (!el.classList.contains('dash-cooldown')) {
        el.classList.add('dash-cooldown');
        el.classList.remove('dash-active');
      }
      if (bar && !bar.classList.contains('dash-cooldown')) {
        bar.classList.add('dash-cooldown');
        bar.classList.remove('dash-active');
      }
    } else {
      if (el.textContent !== 'READY') el.textContent = 'READY';
      if (el.classList.contains('dash-active') || el.classList.contains('dash-cooldown')) {
        el.classList.remove('dash-active', 'dash-cooldown');
      }
      if (bar && (bar.classList.contains('dash-active') || bar.classList.contains('dash-cooldown'))) {
        bar.classList.remove('dash-active', 'dash-cooldown');
      }
    }
  },

  /**
   * On-screen ghost proximity overlay. Runs every frame from game.js.
   * For each non-fleeing ghost within GHOST_WARN_WATCH_TILES of Pacman:
   *   1. Project the ghost's world position to screen pixels via the
   *      active camera. Mark "behind" if the projection's z > 1.
   *   2. If the projection is on-screen, anchor the marker at the
   *      projected pixel; otherwise clamp to a screen-edge ellipse at
   *      MARKER_EDGE_INSET of the viewport. Off-screen and behind
   *      cases share one helper.
   *   3. Rotate the arrow glyph (➤, base orientation = points right)
   *      to point FROM screen centre TOWARD the ghost's screen
   *      direction. Off-screen ghosts naturally look "rim-aligned",
   *      on-screen ones still get a directional arrow that points
   *      outward from centre — useful in chaos, harmless otherwise.
   *   4. Tier-tag the marker (warn-watch / warn-danger / warn-imminent)
   *      so CSS supplies colour + pulse rate.
   *
   * Markers are pooled in `this._ghostMarkerPool`. Unused markers in
   * a frame get `display: none` instead of removal so we don't churn
   * DOM nodes. Power mode (Pacman is the predator) and non-PLAYING
   * states force the entire layer hidden.
   */
  _refreshGhostIndicators() {
    const layer = this.ghostIndicatorsLayer;
    if (!layer) return;

    // Hard-hide gates. Each hides every existing marker so a
    // mid-game state change (death, pause, power-up) doesn't leave a
    // stale arrow pinned to the screen edge.
    const muted =
      this.state !== GAME_STATES.PLAYING ||
      !this.world ||
      !this.pacman ||
      !this.camera ||
      this.pacman.dead ||
      this.pacman.powered;
    if (muted) {
      this._hideAllGhostMarkers();
      return;
    }

    const scale = this.world.scale;
    const px = this.pacman.position.x;
    const py = this.pacman.position.y;
    const watchR2 = (GHOST_WARN_WATCH_TILES * scale) ** 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const halfW = cx * MARKER_EDGE_INSET;
    const halfH = cy * MARKER_EDGE_INSET;

    let activeCount = 0;

    for (const g of this.world.getGhosts()) {
      // FLEE = scared (not a threat); EATEN = eyes returning home
      // (also not a threat). Only active hunters get markers.
      if (g.state === GHOST_STATE.FLEE || g.state === GHOST_STATE.EATEN) continue;

      const dx = g.position.x - px;
      const dy = g.position.y - py;
      const dWorld2 = dx * dx + dy * dy;
      if (dWorld2 >= watchR2) continue;

      const tiles = Math.sqrt(dWorld2) / scale;
      let tier;
      if (tiles <= GAMEPLAY.DANGER_WARNING_RADIUS) tier = 'imminent';
      else if (tiles <= GHOST_WARN_DANGER_TILES) tier = 'danger';
      else tier = 'watch';

      // Project the ghost's world position to NDC. `_projectTmp` is a
      // module-level scratch Vector3 so we don't allocate per ghost.
      _projectTmp.copy(g.position).project(this.camera);
      // Three.js convention: NDC z > 1 means "behind near plane".
      // When that happens the x/y projection inverts (perspective
      // divide by negative w), so we flip them back to recover the
      // actual screen direction. Then bias `ny` negative so the marker
      // lands in the lower half of the screen — the FPPOV convention
      // "behind you" should read as "below" on the rim. Lateral info
      // (nx) is preserved so behind-and-left vs behind-and-right still
      // show on the correct side. Without this bias, a perfectly axial
      // behind-camera ghost projects to (0,0) and the marker would
      // pop to screen centre — useless as a directional cue.
      let nx = _projectTmp.x;
      let ny = _projectTmp.y;
      const behind = _projectTmp.z > 1;
      if (behind) {
        nx = -nx;
        ny = -Math.abs(ny) - 0.5;
      }

      const onScreen = !behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
      let markerX;
      let markerY;
      // Direction (in screen pixels, y-down) from the marker AWAY
      // from screen centre. The arrow glyph points right at 0°, so
      // CSS rotate by atan2(dirY, dirX) aims it at the ghost.
      let dirX;
      let dirY;

      if (onScreen) {
        markerX = (nx * 0.5 + 0.5) * w;
        markerY = (-ny * 0.5 + 0.5) * h;
        dirX = markerX - cx;
        dirY = markerY - cy;
      } else {
        // Clamp to an inset ellipse: scale (nx, ny) so it lands on
        // the closer of the two viewport axes. Doing this in NDC
        // space keeps the math symmetric (same code path for any
        // window aspect). nyScreen flips because NDC y-up vs CSS
        // y-down.
        const sx = nx;
        const sy = -ny;
        const len = Math.hypot(sx, sy) || 1;
        const ux = sx / len;
        const uy = sy / len;
        // Stretch the unit vector until it hits the inset rect.
        const tEdge = Math.min(
          halfW / Math.max(Math.abs(ux) * cx, 1e-6),
          halfH / Math.max(Math.abs(uy) * cy, 1e-6)
        );
        const ex = ux * cx * tEdge;
        const ey = uy * cy * tEdge;
        markerX = cx + ex;
        markerY = cy + ey;
        dirX = ex;
        dirY = ey;
      }

      const angleDeg = (Math.atan2(dirY, dirX) * 180) / Math.PI;

      const marker = this._claimGhostMarker(activeCount);
      marker.style.setProperty('--marker-x', `${markerX}px`);
      marker.style.setProperty('--marker-y', `${markerY}px`);
      marker.style.setProperty('--marker-rot', `${angleDeg}deg`);
      // Reset className wholesale instead of toggling each tier — one
      // assignment is cheaper than three classList ops, and it also
      // clears any stale tier left over from the previous frame.
      marker.className = `ghost-marker warn-${tier}`;
      marker.style.display = '';
      activeCount++;
    }

    // Hide any pool slots we didn't claim this frame.
    for (let i = activeCount; i < this._ghostMarkerPool.length; i++) {
      this._ghostMarkerPool[i].style.display = 'none';
    }
  },

  /**
   * Get-or-create a marker from the pool. Markers are detached from
   * the DOM only when the layer itself goes away; in steady state the
   * pool stays sized to the historical max nearby-ghost count.
   */
  _claimGhostMarker(index) {
    let marker = this._ghostMarkerPool[index];
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'ghost-marker';
      // ➤ glyph (U+27A4) — solid right-pointing arrow that reads as
      // a directional indicator. CSS rotates the whole element to
      // aim it at the threat; the glyph itself is just the artwork.
      marker.textContent = '\u27A4';
      this.ghostIndicatorsLayer.appendChild(marker);
      this._ghostMarkerPool[index] = marker;
    }
    return marker;
  },

  /** Bulk-hide every pooled marker. Used by the muted-state guard. */
  _hideAllGhostMarkers() {
    if (!this._ghostMarkerPool) return;
    for (const m of this._ghostMarkerPool) {
      if (m && m.style.display !== 'none') m.style.display = 'none';
    }
  }
};
