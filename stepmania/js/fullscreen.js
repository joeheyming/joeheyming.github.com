// Fullscreen functionality for StepMania - ES Module

let fullscreenScoreSyncInterval = null;

/**
 * Toggle fullscreen mode on the game container
 */
export function toggleFullscreen() {
  const gameContainer = document.getElementById('sm-micro');

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    // Enter fullscreen on the game container
    if (gameContainer.requestFullscreen) {
      gameContainer.requestFullscreen();
    } else if (gameContainer.webkitRequestFullscreen) {
      gameContainer.webkitRequestFullscreen();
    }
  } else {
    // Exit fullscreen
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

/**
 * Start syncing score display to fullscreen overlay
 */
function startFullscreenScoreSync() {
  if (fullscreenScoreSyncInterval) return;

  fullscreenScoreSyncInterval = setInterval(() => {
    // Get values from main score panel (using the score-panel web component with shadow DOM)
    const scorePanel = document.getElementById('score-panel');
    if (scorePanel && scorePanel.shadowRoot) {
      const percentEl = scorePanel.shadowRoot.getElementById('percent');
      const comboEl = scorePanel.shadowRoot.getElementById('combo');
      const scoreEl = scorePanel.shadowRoot.getElementById('gamified-score');

      // Update fullscreen score display
      const fsPercent = document.getElementById('fs-score-percent');
      const fsCombo = document.getElementById('fs-combo');
      const fsScore = document.getElementById('fs-score');

      if (fsPercent && percentEl) {
        fsPercent.textContent = percentEl.textContent || '0.00%';
      }
      if (fsCombo && comboEl) {
        fsCombo.textContent = comboEl.textContent || '0';
      }
      if (fsScore && scoreEl) {
        fsScore.textContent = scoreEl.textContent || '0';
      }
    }
  }, 100);
}

/**
 * Stop syncing score display to fullscreen overlay
 */
function stopFullscreenScoreSync() {
  if (fullscreenScoreSyncInterval) {
    clearInterval(fullscreenScoreSyncInterval);
    fullscreenScoreSyncInterval = null;
  }
}

/**
 * Handle fullscreen state changes
 */
function handleFullscreenChange() {
  const gameContainer = document.getElementById('sm-micro');
  const isFullscreen =
    document.fullscreenElement === gameContainer ||
    document.webkitFullscreenElement === gameContainer;

  // Update button icon state
  const btn = document.getElementById('fullscreen-toggle');
  if (btn) {
    const enterIcon = btn.querySelector('.fullscreen-icon');
    const exitIcon = btn.querySelector('.exit-fullscreen-icon');
    if (enterIcon && exitIcon) {
      enterIcon.style.display = isFullscreen ? 'none' : 'inline';
      exitIcon.style.display = isFullscreen ? 'inline' : 'none';
    }
  }

  // Toggle fullscreen controls, score, and exit button visibility
  const fsControls = document.getElementById('fullscreen-controls');
  const fsScore = document.getElementById('fullscreen-score');
  const fsExitBtn = document.getElementById('fullscreen-exit-btn');

  if (fsControls) {
    fsControls.classList.toggle('visible', isFullscreen);
  }

  if (fsExitBtn) {
    fsExitBtn.classList.toggle('visible', isFullscreen);
  }

  if (fsScore) {
    fsScore.classList.toggle('visible', isFullscreen);
    if (isFullscreen) {
      startFullscreenScoreSync();
    } else {
      stopFullscreenScoreSync();
    }
  }

  // Give the browser a moment to adjust layout, then resize the canvas
  setTimeout(() => {
    if (window.CanvasManager) {
      if (isFullscreen) {
        // In fullscreen, make canvas fill the screen while maintaining aspect ratio
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Calculate canvas size to fill screen while maintaining playable area
        const aspectRatio = 4 / 5; // width to height ratio for game
        let canvasWidth, canvasHeight;

        if (screenWidth / screenHeight > aspectRatio) {
          // Screen is wider than needed, constrain by height
          canvasHeight = screenHeight;
          canvasWidth = Math.min(screenHeight * aspectRatio, screenWidth * 0.6);
        } else {
          // Screen is taller than needed, constrain by width
          canvasWidth = screenWidth * 0.6;
          canvasHeight = canvasWidth / aspectRatio;
        }

        // Update canvas dimensions
        if (window.CanvasManager.element) {
          window.CanvasManager.width = Math.floor(canvasWidth);
          window.CanvasManager.height = Math.floor(canvasHeight);
          window.CanvasManager.element.width = window.CanvasManager.width;
          window.CanvasManager.element.height = window.CanvasManager.height;
        }
      } else {
        // Exiting fullscreen, restore normal size
        window.CanvasManager.resize('sm-micro');
      }
    }
    // Dispatch resize event to trigger any other resize handlers
    window.dispatchEvent(new Event('resize'));
  }, 100);
}

/**
 * Setup fullscreen button event listeners
 */
function setupFullscreenButtons() {
  const fullscreenBtn = document.getElementById('fullscreen-toggle');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  // Fullscreen exit button
  const exitBtn = document.getElementById('fullscreen-exit-btn');
  if (exitBtn) {
    exitBtn.addEventListener('click', toggleFullscreen);
  }

  // Sync fullscreen step buttons with main step buttons
  const fsButtons = ['fs-button0', 'fs-button1', 'fs-button2', 'fs-button3'];
  const mainButtons = ['button0', 'button1', 'button2', 'button3'];

  fsButtons.forEach((fsId, index) => {
    const fsBtn = document.getElementById(fsId);
    const mainBtn = document.getElementById(mainButtons[index]);

    if (fsBtn && mainBtn) {
      // Forward events from fullscreen buttons to main buttons
      ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend'].forEach(
        (eventType) => {
          fsBtn.addEventListener(eventType, (e) => {
            // Dispatch the same event to the main button
            const newEvent = new Event(eventType, { bubbles: true });
            mainBtn.dispatchEvent(newEvent);
          });
        }
      );
    }
  });
}

/**
 * Setup keyboard shortcut for fullscreen (F key)
 */
function setupKeyboardShortcut() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  });
}

/**
 * Initialize all fullscreen functionality
 */
export function initFullscreen() {
  // Handle fullscreen change events
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  // Setup buttons and keyboard shortcuts
  setupFullscreenButtons();
  setupKeyboardShortcut();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFullscreen);
} else {
  initFullscreen();
}

export default { toggleFullscreen, initFullscreen };

