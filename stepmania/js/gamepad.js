// Gamepad integration for StepMania - ES Module
// Supports dance pads, PS2 controllers, and other gamepads
import { inputManager } from './inputManager.js';

export class GamepadManager {
  constructor() {
    this.gamepads = [];
    this.isEnabled = false;
    this.buttonMapping = {
      // Standard dance pad mapping (most common)
      dancePad: {
        left: 15,
        right: 13,
        up: 12,
        down: 14,
        leftAlt: 0,
        rightAlt: 1,
        upAlt: 2,
        downAlt: 3
      },
      // PS2 controller mapping
      ps2: {
        left: 15,
        right: 13,
        up: 12,
        down: 14,
        leftAlt: 0,
        rightAlt: 1,
        upAlt: 2,
        downAlt: 3
      },
      // USB GamePad 0e8f:3013 specific mapping
      usbGamePad: {
        up: 12,
        right: 13,
        down: 14,
        left: 15,
        leftAlt: 0,
        rightAlt: 1,
        upAlt: 2,
        downAlt: 3,
        leftAlt2: 15,
        rightAlt2: 13,
        upAlt2: 12,
        downAlt2: 14
      },
      // USB GamePad 0079:0011 specific mapping
      usbGamePad2: {
        left: 0,
        right: 2,
        up: 3,
        down: 1
      }
    };

    this.currentMapping = 'dancePad';
    this.deadzone = 0.5;
    this.pollingInterval = null;

    this.lastTriggerTime = {};
    this.triggerCooldown = 100;
    this.debugMode = false;

    this.init();
  }

  init() {
    if (!navigator.getGamepads) {
      console.warn('Gamepad API not supported in this browser');
      return;
    }

    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad connected:', e.gamepad);
      this.addGamepad(e.gamepad);
      this.startPolling();
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('Gamepad disconnected:', e.gamepad);
      this.removeGamepad(e.gamepad.index);
    });

    this.checkExistingGamepads();
  }

  checkExistingGamepads() {
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        this.addGamepad(gamepads[i]);
      }
    }

    if (this.gamepads.length > 0) {
      this.startPolling();
    }
  }

  addGamepad(gamepad) {
    gamepad.buttonStates = new Array(gamepad.buttons.length).fill(false);
    gamepad.lastButtonStates = new Array(gamepad.buttons.length).fill(false);

    this.gamepads.push(gamepad);
    this.isEnabled = true;

    this.autoDetectController(gamepad);
  }

  removeGamepad(index) {
    this.gamepads = this.gamepads.filter((gp) => gp.index !== index);
    this.isEnabled = this.gamepads.length > 0;

    if (!this.isEnabled) {
      this.stopPolling();
    }
  }

  autoDetectController(gamepad) {
    const name = gamepad.id.toLowerCase();

    if (name.includes('dance') || name.includes('step')) {
      this.currentMapping = 'dancePad';
    } else if (name.includes('ps2') || name.includes('playstation')) {
      this.currentMapping = 'ps2';
    } else if (name.includes('0e8f') && name.includes('3013')) {
      this.currentMapping = 'usbGamePad';
    } else if (name.includes('0079') && name.includes('0011')) {
      this.currentMapping = 'usbGamePad2';
    } else {
      this.currentMapping = 'dancePad';
    }
  }

  startPolling() {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.pollGamepads();
    }, 16);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  pollGamepads() {
    if (!this.isEnabled) return;

    const gamepads = navigator.getGamepads();

    this.gamepads.forEach((gamepad) => {
      const currentGamepad = gamepads[gamepad.index];
      if (!currentGamepad) return;

      currentGamepad.buttons.forEach((button, index) => {
        gamepad.lastButtonStates[index] = gamepad.buttonStates[index];
        gamepad.buttonStates[index] = button.pressed;
      });

      this.checkButtonPresses(gamepad);
      this.checkAnalogInput(gamepad);
    });
  }

  checkButtonPresses(gamepad) {
    const mapping = this.buttonMapping[this.currentMapping];

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

    const newlyPressed = new Set();

    directions.forEach((direction) => {
      const wasPressed = direction.buttons.some((btnIndex) => gamepad.lastButtonStates[btnIndex]);
      const isPressed = direction.buttons.some((btnIndex) => gamepad.buttonStates[btnIndex]);

      if (isPressed && !wasPressed) {
        newlyPressed.add(direction.name);
      }
    });

    if (newlyPressed.size > 0) {
      newlyPressed.forEach((direction) => {
        this.handleDirectionPress(direction);
      });
    }
  }

  checkAnalogInput(gamepad) {
    const leftX = gamepad.axes[0] || 0;
    const leftY = gamepad.axes[1] || 0;

    const rightX = gamepad.axes[2] || 0;
    const rightY = gamepad.axes[3] || 0;

    const useLeftStick = Math.abs(leftX) > Math.abs(rightX) || Math.abs(leftY) > Math.abs(rightY);
    const x = useLeftStick ? leftX : rightX;
    const y = useLeftStick ? leftY : rightY;

    const analogDirections = new Set();

    if (Math.abs(x) > this.deadzone || Math.abs(y) > this.deadzone) {
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

      if (analogDirections.size > 0) {
        analogDirections.forEach((direction) => {
          this.handleDirectionPress(direction);
        });
      }
    }
  }

  handleDirectionPress(direction) {
    const now = Date.now();
    const lastTrigger = this.lastTriggerTime[direction] || 0;

    if (now - lastTrigger < this.triggerCooldown) {
      return;
    }

    this.lastTriggerTime[direction] = now;

    let column;
    switch (direction) {
      case 'left':
        column = 0;
        break;
      case 'up':
        column = 2;
        break;
      case 'right':
        column = 3;
        break;
      case 'down':
        column = 1;
        break;
    }

    if (column !== undefined) {
      // Trigger step via InputManager (handles step + visual feedback)
      inputManager.triggerStep(column);

      if (this.debugMode) {
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
    let debugEl = document.getElementById('gamepad-debug');
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'gamepad-debug';
      debugEl.className = 'gamepad-debug';
      document.body.appendChild(debugEl);
    }

    debugEl.textContent = `🎮 ${direction.toUpperCase()} (${column})`;

    setTimeout(() => {
      if (debugEl) debugEl.textContent = '';
    }, 1000);
  }

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

  enableDebugMode() {
    this.debugMode = true;
    console.log('🎮 Gamepad debug mode enabled');
  }

  disableDebugMode() {
    this.debugMode = false;
    console.log('🎮 Gamepad debug mode disabled');
  }

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

  testDirection(direction) {
    this.handleDirectionPress(direction);
  }

  testMultipleDirections(directions) {
    directions.forEach((direction) => {
      this.handleDirectionPress(direction);
    });
  }

  testCooldown() {
    this.testDirection('left');
    setTimeout(() => this.testDirection('left'), 50);
    setTimeout(() => this.testDirection('left'), 150);
  }
}

// Create instance and export
const gamepadManager = new GamepadManager();

// Keep window reference for backwards compatibility
window.gamepadManager = gamepadManager;

/**
 * Update the gamepad status indicator in the UI
 */
function updateGamepadStatus() {
  const statusElement = document.getElementById('gamepad-status');
  if (!statusElement) return;

  if (gamepadManager.getStatus().connectedGamepads > 0) {
    statusElement.classList.remove('hidden');
  } else {
    statusElement.classList.add('hidden');
  }
}

/**
 * Initialize gamepad status indicator updates
 */
function initGamepadStatusIndicator() {
  // Check gamepad status periodically
  setInterval(updateGamepadStatus, 1000);

  // Initial check after a short delay to allow page to load
  setTimeout(updateGamepadStatus, 2000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGamepadStatusIndicator);
} else {
  initGamepadStatusIndicator();
}

// Export both the class and instance
export { gamepadManager, updateGamepadStatus };
export default GamepadManager;
