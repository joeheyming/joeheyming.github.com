import { GAME_STATES } from './constants.js';

export const gameInput = {
  setupEventListeners() {
    // Configure the start menu based on whether there's anything to continue.
    this._refreshStartMenu();
    this._refreshDifficultyButtons();

    if (this.continueBtn) {
      this.continueBtn.addEventListener('click', () => this.startGame());
    }
    if (this.newGameBtn) {
      this.newGameBtn.addEventListener('click', () => this.startNewGame());
    }
    // Wire all difficulty pills. Cosmetic until NEW GAME is pressed.
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
    for (const btn of difficultyButtons) {
      btn.addEventListener('click', () => {
        const diff = btn.getAttribute('data-difficulty');
        if (diff) this.setDifficulty(diff);
      });
    }

    const cameraToggle = document.getElementById('camera-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        if (this.controls) this.controls.cycleCamera();
      });
    }

    if (this.pauseScreen) {
      this.pauseScreen.addEventListener('click', () => this.resumeGame());
    }

    if (this.backToMenuBtn) {
      this.backToMenuBtn.addEventListener('click', () => this._backToMenuFromGameOver());
    }

    window.addEventListener('blur', () => {
      if (this.state === GAME_STATES.PLAYING) this.pauseGame();
    });
    document.addEventListener('visibilitychange', () => {
      // pagehide isn't reliable on iOS; visibilitychange:hidden is the
      // canonical "the user might be leaving" signal. Flush before pause
      // so we never lose progress to an OS-level tab swap.
      if (document.hidden) {
        this._flushSave();
        if (this.state === GAME_STATES.PLAYING) this.pauseGame();
      }
    });
    // pagehide is the most reliable "we are about to die" signal for
    // page navigations / closes. beforeunload doesn't fire on iOS.
    window.addEventListener('pagehide', () => this._flushSave());
  },

  /**
   * Toggle the CONTINUE / NEW GAME buttons based on whether `_savedState`
   * is non-null. Called once on boot (and after any future menu reopen).
   */
  _refreshStartMenu() {
    const canContinue = this._savedState !== null;
    if (this.continueBtn) {
      this.continueBtn.classList.toggle('hidden', !canContinue);
    }
    if (this.newGameBtn) {
      // When a save exists, NEW GAME drops to a smaller "secondary" style
      // so CONTINUE reads as the obvious primary action.
      this.newGameBtn.classList.toggle('btn-primary', !canContinue);
      this.newGameBtn.classList.toggle('btn-secondary', canContinue);
    }
  },

  pauseGame() {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.state = GAME_STATES.PAUSED;
    if (this.pauseScreen) this.pauseScreen.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  },

  resumeGame() {
    if (this.state !== GAME_STATES.PAUSED) return;
    this.state = GAME_STATES.PLAYING;
    if (this.pauseScreen) this.pauseScreen.classList.add('hidden');
  },

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) this.pauseGame();
    else if (this.state === GAME_STATES.PAUSED) this.resumeGame();
  },

  /** Called by Controls when Space (or the touch jump button) is pressed. */
  tryJump() {
    if (this.state !== GAME_STATES.PLAYING) return;
    if (!this.pacman) return;
    this.pacman.tryJump();
  },

  parseCameraMode(modeStr) {
    if (!modeStr) return null;
    const mode = modeStr.toLowerCase();
    switch (mode) {
      case 'follow':
      case '1':
        return 1;
      case 'fps':
      case 'fppov':
      case 'firstperson':
      case 'first':
      case '2':
        return 2;
      case 'birdseye':
      case 'birds':
      case '0':
        return 0; // allowed via URL param even though cycle skips it
      default:
        return null;
    }
  },

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.cameraController) this.cameraController.onResize();
  }
};
