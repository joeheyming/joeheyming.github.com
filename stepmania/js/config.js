// StepMania Configuration - ES Module
// Centralized constants to eliminate magic numbers

// Note: SCORING and TAP_NOTE_POINTS live in judgmentPolicy.js (re-exported from score-panel.js)

/** Arrow/note width in pixels (shared across rendering modules) */
export const ARROW_WIDTH = 64;

/** Y position of target arrows (shared across rendering modules) */
export const TARGETS_Y = 32;

/**
 * Get CSS custom property value
 * @param {string} name - CSS property name (e.g. '--canvas-mine-fill')
 * @param {string} fallback - Fallback value if property not found
 */
function getCSSVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Canvas rendering theme - reads from CSS custom properties in screen.css
 * This bridges CSS and canvas drawing operations
 */
export const CANVAS_THEME = {
  // Mine colors (read from CSS --canvas-mine-* properties)
  mine: {
    get fill() {
      return getCSSVar('--canvas-mine-fill', '#ff0000');
    },
    get innerFill() {
      return getCSSVar('--canvas-mine-inner', '#ff6666');
    },
    get stroke() {
      return getCSSVar('--canvas-mine-stroke', '#ffffff');
    },
    get dangerColor() {
      return getCSSVar('--canvas-mine-danger', 'rgba(255, 255, 0, 1)');
    },
    get text() {
      return getCSSVar('--canvas-mine-text', '#ffffff');
    },
    font: 'bold Arial' // size applied dynamically
  },
  // Hold note colors (read from CSS --canvas-hold-* properties)
  hold: {
    get activeStroke() {
      return getCSSVar('--canvas-hold-active-stroke', '#ffffff');
    },
    get inactiveStroke() {
      return getCSSVar('--canvas-hold-inactive-stroke', '#cccccc');
    },
    get capFill() {
      return getCSSVar('--canvas-hold-cap', '#ff0000');
    },
    get droppedCapFill() {
      return getCSSVar('--canvas-hold-cap-dropped', '#cc0000');
    },
    get capStroke() {
      return getCSSVar('--canvas-hold-cap-stroke', '#ffffff');
    },
    // Gradient colors
    gradient: {
      get start() {
        return getCSSVar('--canvas-hold-gradient-start', '#00ff00');
      },
      get mid() {
        return getCSSVar('--canvas-hold-gradient-mid', '#ffff00');
      },
      get end() {
        return getCSSVar('--canvas-hold-gradient-end', '#ff0000');
      }
    },
    activeGradient: {
      get start() {
        return getCSSVar('--canvas-hold-active-start', 'rgba(0, 255, 100, 1)');
      },
      get mid() {
        return getCSSVar('--canvas-hold-active-mid', '#ffff00');
      },
      get end() {
        return getCSSVar('--canvas-hold-active-end', '#ff8800');
      }
    },
    droppedGradient: {
      get start() {
        return getCSSVar('--canvas-hold-dropped-start', '#ff4444');
      },
      get mid() {
        return getCSSVar('--canvas-hold-dropped-mid', '#cc0000');
      },
      get end() {
        return getCSSVar('--canvas-hold-dropped-end', '#880000');
      }
    }
  },
  // Judgment text (read from CSS --canvas-judgment-* properties)
  judgment: {
    get fill() {
      return getCSSVar('--canvas-judgment-fill', '#ff4444');
    },
    font: 'bold 24px Arial',
    get shadowColor() {
      return getCSSVar('--canvas-judgment-shadow', 'black');
    },
    shadowBlur: 4,
    shadowOffset: 2
  }
};

export default {
  ARROW_WIDTH,
  TARGETS_Y,
  CANVAS_THEME
};
