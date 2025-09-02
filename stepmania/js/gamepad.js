// Gamepad integration for StepMania
// Supports dance pads, PS2 controllers, and other gamepads

class GamepadManager {
  constructor() {
    this.gamepads = [];
    this.isEnabled = false;
    this.buttonMapping = {
      // Standard dance pad mapping (most common)
      dancePad: {
        left: 15, // D-pad left
        right: 13, // D-pad right
        up: 12, // D-pad up
        down: 14, // D-pad down
        // Alternative mappings for different pads
        leftAlt: 0, // A button
        rightAlt: 1, // B button
        upAlt: 2, // X button
        downAlt: 3 // Y button
      },
      // PS2 controller mapping
      ps2: {
        left: 15, // D-pad left
        right: 13, // D-pad right
        up: 12, // D-pad up
        down: 14, // D-pad down
        // Face buttons as alternatives
        leftAlt: 0, // Square
        rightAlt: 1, // Cross
        upAlt: 2, // Circle
        downAlt: 3 // Triangle
      },
      // USB GamePad 0e8f:3013 specific mapping
      usbGamePad: {
        // Your specific step pad mapping
        up: 12, // Up panel
        right: 13, // Right panel
        down: 14, // Down panel
        left: 15, // Left panel
        // Alternative mappings (keeping for compatibility)
        leftAlt: 0, // Button 0
        rightAlt: 1, // Button 1
        upAlt: 2, // Button 2
        downAlt: 3, // Button 3
        // D-pad alternatives
        leftAlt2: 15, // D-pad left
        rightAlt2: 13, // D-pad right
        upAlt2: 12, // D-pad up
        downAlt2: 14 // D-pad down
      }
    };

    this.currentMapping = 'dancePad';
    this.deadzone = 0.5; // Minimum threshold for analog stick input
    this.pollingInterval = null;

    // Cooldown system to prevent rapid-fire when buttons are held
    this.lastTriggerTime = {}; // Track last trigger time for each direction
    this.triggerCooldown = 100; // Minimum milliseconds between triggers for the same direction

    this.init();
  }

  init() {
    // Check if Gamepad API is supported
    if (!navigator.getGamepads) {
      console.warn('Gamepad API not supported in this browser');
      return;
    }

    // Listen for gamepad connections
    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad connected:', e.gamepad);
      this.addGamepad(e.gamepad);
      this.startPolling();
    });

    // Listen for gamepad disconnections
    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('Gamepad disconnected:', e.gamepad);
      this.removeGamepad(e.gamepad.index);
    });

    // Check for already connected gamepads
    this.checkExistingGamepads();
  }

  checkExistingGamepads() {
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        console.log('Found existing gamepad:', gamepads[i]);
        this.addGamepad(gamepads[i]);
      }
    }

    if (this.gamepads.length > 0) {
      this.startPolling();
    }
  }

  addGamepad(gamepad) {
    // Add button state tracking
    gamepad.buttonStates = new Array(gamepad.buttons.length).fill(false);
    gamepad.lastButtonStates = new Array(gamepad.buttons.length).fill(false);

    this.gamepads.push(gamepad);
    this.isEnabled = true;

    // Try to auto-detect the type of controller
    this.autoDetectController(gamepad);

    console.log(`Gamepad ${gamepad.index} added. Total gamepads: ${this.gamepads.length}`);
  }

  removeGamepad(index) {
    this.gamepads = this.gamepads.filter((gp) => gp.index !== index);
    this.isEnabled = this.gamepads.length > 0;

    if (!this.isEnabled) {
      this.stopPolling();
    }

    console.log(`Gamepad ${index} removed. Total gamepads: ${this.gamepads.length}`);
  }

  autoDetectController(gamepad) {
    // Try to detect dance pad vs regular controller
    const name = gamepad.id.toLowerCase();

    if (name.includes('dance') || name.includes('pad') || name.includes('step')) {
      this.currentMapping = 'dancePad';
      console.log('Auto-detected dance pad');
    } else if (name.includes('ps2') || name.includes('playstation')) {
      this.currentMapping = 'ps2';
      console.log('Auto-detected PS2 controller');
    } else if (name.includes('0e8f') && name.includes('3013')) {
      // Specific detection for USB GamePad 0e8f:3013
      this.currentMapping = 'usbGamePad';
      console.log('Auto-detected USB GamePad 0e8f:3013');
    } else {
      // Default to dance pad mapping
      this.currentMapping = 'dancePad';
      console.log('Using default dance pad mapping');
    }
  }

  startPolling() {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.pollGamepads();
    }, 16); // ~60fps polling

    console.log('Started gamepad polling');
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('Stopped gamepad polling');
    }
  }

  pollGamepads() {
    if (!this.isEnabled) return;

    const gamepads = navigator.getGamepads();

    this.gamepads.forEach((gamepad) => {
      const currentGamepad = gamepads[gamepad.index];
      if (!currentGamepad) return;

      // Update button states
      currentGamepad.buttons.forEach((button, index) => {
        const wasPressed = gamepad.lastButtonStates[index];
        const isPressed = button.pressed;

        gamepad.lastButtonStates[index] = gamepad.buttonStates[index];
        gamepad.buttonStates[index] = button.pressed;
      });

      // Check for button presses (rising edge)
      this.checkButtonPresses(gamepad);

      // Check for analog stick input
      this.checkAnalogInput(gamepad);
    });
  }

  checkButtonPresses(gamepad) {
    const mapping = this.buttonMapping[this.currentMapping];

    // Check each direction
    const directions = [
      {
        name: 'left',
        buttons: [mapping.left, mapping.leftAlt, mapping.leftAlt2 || -1].filter((btn) => btn !== -1)
      },
      {
        name: 'right',
        buttons: [mapping.right, mapping.rightAlt, mapping.rightAlt2 || -1].filter(
          (btn) => btn !== -1
        )
      },
      {
        name: 'up',
        buttons: [mapping.up, mapping.upAlt, mapping.upAlt2 || -1].filter((btn) => btn !== -1)
      },
      {
        name: 'down',
        buttons: [mapping.down, mapping.downAlt, mapping.downAlt2 || -1].filter((btn) => btn !== -1)
      }
    ];

    // Track which directions are currently pressed
    const currentlyPressed = new Set();
    const newlyPressed = new Set();

    directions.forEach((direction) => {
      const wasPressed = direction.buttons.some((btnIndex) => gamepad.lastButtonStates[btnIndex]);
      const isPressed = direction.buttons.some((btnIndex) => gamepad.buttonStates[btnIndex]);

      if (isPressed) {
        currentlyPressed.add(direction.name);

        // If this direction wasn't pressed before, it's newly pressed
        if (!wasPressed) {
          newlyPressed.add(direction.name);
        }
      }
    });

    // Handle all newly pressed directions (supports simultaneous presses)
    if (newlyPressed.size > 0) {
      // Trigger each newly pressed direction
      newlyPressed.forEach((direction) => {
        this.handleDirectionPress(direction);
      });
    }
  }

  checkAnalogInput(gamepad) {
    // Check left analog stick (axes 0 and 1)
    const leftX = gamepad.axes[0] || 0;
    const leftY = gamepad.axes[1] || 0;

    // Check right analog stick (axes 2 and 3)
    const rightX = gamepad.axes[2] || 0;
    const rightY = gamepad.axes[3] || 0;

    // Use whichever stick has more input
    const useLeftStick = Math.abs(leftX) > Math.abs(rightX) || Math.abs(leftY) > Math.abs(rightY);
    const x = useLeftStick ? leftX : rightX;
    const y = useLeftStick ? leftY : rightY;

    // Track which directions are triggered by analog input
    const analogDirections = new Set();

    // Check if input exceeds deadzone
    if (Math.abs(x) > this.deadzone || Math.abs(y) > this.deadzone) {
      // Support diagonal input (both X and Y can trigger simultaneously)
      if (Math.abs(x) > this.deadzone) {
        if (x < -this.deadzone) {
          analogDirections.add('left');
        } else if (x > this.deadzone) {
          analogDirections.add('right');
        }
      }

      if (Math.abs(y) > this.deadzone) {
        if (y < -this.deadzone) {
          analogDirections.add('up');
        } else if (y > this.deadzone) {
          analogDirections.add('down');
        }
      }

      // Trigger all detected directions
      if (analogDirections.size > 0) {
        analogDirections.forEach((direction) => {
          this.handleDirectionPress(direction);
        });
      }
    }
  }

  handleDirectionPress(direction) {
    // Check cooldown to prevent rapid-fire
    const now = Date.now();
    const lastTrigger = this.lastTriggerTime[direction] || 0;

    if (now - lastTrigger < this.triggerCooldown) {
      return; // Still in cooldown period
    }

    // Update last trigger time
    this.lastTriggerTime[direction] = now;

    // Map direction to StepMania column
    let column;
    switch (direction) {
      case 'left':
        column = 0; // Left arrow
        break;
      case 'up':
        column = 2; // Up arrow
        break;
      case 'right':
        column = 3; // Right arrow
        break;
      case 'down':
        column = 1; // Down arrow
        break;
    }

    if (column !== undefined) {
      // Trigger the step function if it exists globally
      if (typeof window.step === 'function') {
        window.step(column);
      } else {
        console.warn('🎮 window.step function not found!');
      }

      // Add visual feedback
      if (typeof window.addButtonFeedback === 'function') {
        window.addButtonFeedback(column);
      } else {
        console.warn('🎮 window.addButtonFeedback function not found!');
      }

      // Show visual feedback in UI if debug mode is enabled
      if (window.gamepadDebugMode) {
        this.showDebugFeedback(direction, column);
      }
    }
  }

  getButtonForDirection(direction) {
    const mapping = this.buttonMapping[this.currentMapping];
    switch (direction) {
      case 'left':
        return mapping.left;
      case 'right':
        return mapping.right;
      case 'up':
        return mapping.up;
      case 'down':
        return mapping.down;
      default:
        return 'unknown';
    }
  }

  showDebugFeedback(direction, column) {
    // Create or update debug element
    let debugEl = document.getElementById('gamepad-debug');
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'gamepad-debug';
      debugEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0,0,0,0.8);
        color: #10b981;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000;
        pointer-events: none;
      `;
      document.body.appendChild(debugEl);
    }

    debugEl.textContent = `🎮 ${direction.toUpperCase()} (${column})`;

    // Clear after 1 second
    setTimeout(() => {
      if (debugEl) debugEl.textContent = '';
    }, 1000);
  }

  // Public methods for external control
  enable() {
    this.isEnabled = true;
    if (this.gamepads.length > 0) {
      this.startPolling();
    }
  }

  disable() {
    this.isEnabled = false;
    this.stopPolling();
  }

  setMapping(mapping) {
    if (this.buttonMapping[mapping]) {
      this.currentMapping = mapping;
    }
  }

  setTriggerCooldown(milliseconds) {
    this.triggerCooldown = milliseconds;
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      connectedGamepads: this.gamepads.length,
      currentMapping: this.currentMapping,
      triggerCooldown: this.triggerCooldown,
      gamepads: this.gamepads.map((gp) => ({
        index: gp.index,
        id: gp.id,
        connected: gp.connected
      }))
    };
  }

  // Debug utilities
  enableDebugMode() {
    window.gamepadDebugMode = true;
    console.log('🎮 Gamepad debug mode enabled');
  }

  disableDebugMode() {
    window.gamepadDebugMode = false;
    console.log('🎮 Gamepad debug mode disabled');
  }

  // Get detailed gamepad info for troubleshooting
  getDetailedInfo() {
    if (this.gamepads.length === 0) {
      return 'No gamepads connected';
    }

    const gamepad = this.gamepads[0];
    const gamepads = navigator.getGamepads();
    const currentGamepad = gamepads[gamepad.index];

    if (!currentGamepad) {
      return 'Gamepad disconnected';
    }

    return {
      id: currentGamepad.id,
      index: currentGamepad.index,
      connected: currentGamepad.connected,
      timestamp: currentGamepad.timestamp,
      mapping: currentGamepad.mapping,
      axes: currentGamepad.axes,
      buttons: currentGamepad.buttons.map((btn, i) => ({
        index: i,
        pressed: btn.pressed,
        value: btn.value
      }))
    };
  }

  // Test all buttons and show their current state
  testAllButtons() {
    if (this.gamepads.length === 0) {
      console.log('No gamepads connected for testing');
      return;
    }

    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[this.gamepads[0].index];

    if (!gamepad) {
      console.log('Gamepad not available for testing');
      return;
    }

    console.log('🎮 Current button states:');
    gamepad.buttons.forEach((button, index) => {
      if (button.pressed) {
        console.log(`  Button ${index}: PRESSED (value: ${button.value})`);
      }
    });

    console.log('🎮 Current analog stick values:');
    gamepad.axes.forEach((value, index) => {
      if (Math.abs(value) > 0.1) {
        console.log(`  Axis ${index}: ${value.toFixed(3)}`);
      }
    });
  }

  // Test function to manually trigger directions (for debugging)
  testDirection(direction) {
    this.handleDirectionPress(direction);
  }

  // Test function to trigger multiple directions simultaneously
  testMultipleDirections(directions) {
    directions.forEach((direction) => {
      this.handleDirectionPress(direction);
    });
  }

  // Test cooldown system
  testCooldown() {
    this.testDirection('left');
    setTimeout(() => this.testDirection('left'), 50); // Should be blocked
    setTimeout(() => this.testDirection('left'), 150); // Should work
  }
}

// Create global instance
window.gamepadManager = new GamepadManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GamepadManager;
}
