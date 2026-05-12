import { GAMEPLAY } from './constants.js';

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
    const frac = Math.max(0, this.pacman.powerTimer / GAMEPLAY.POWER_MODE_DURATION);
    this.powerTimerBar.style.width = `${frac * 100}%`;
    this.powerTimerElement.classList.toggle('expiring', this.pacman.powerTimer < 2);
    this.container?.classList.add('ghost-flee-glow');
  }
};
