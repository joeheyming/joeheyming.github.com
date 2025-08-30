// Module is available as a global variable from doom.js
const Doom = Module;

const consoleLog = console.log;
console.log = () => {};
console.error = () => {};
console.info = () => {};

const doomMusic = `b2e05b4e8dff8d76f8f4c3a724e7dbd365390536 = /music/d_inter.ogg
0c0acce45130bab935d2f1e85664b29a3c724fcd = /music/d_intro.ogg
fca4086939a68ae4ed84c96e6bf0bd5621ddbe3d = /music/d_victor.ogg
5971e5e20554f47ca06568832abd37db5e5a94f7 = /music/d_intro.ogg
99767e32769229897f7722848fb1ceccc2314d09 = /music/d_e1m1.ogg
b5e7dfb4efe9e688bf2ae6163c9d734e89e643b1 = /music/d_e1m2.ogg
fda8fa73e4d30a6b961cd46fe6e013395e87a682 = /music/d_e1m3.ogg
3805f9bf3f1702f7e7f5483a609d7d3c4daa2323 = /music/d_e1m4.ogg
f546ed823b234fe391653029159de7b67a15dbd4 = /music/d_e1m5.ogg
4450811b5a6748cfd83e3ea241222f6b88be33f9 = /music/d_e1m6.ogg
73edb50d96b0ac03be34a6134b33e4c8f00fc486 = /music/d_e1m7.ogg
47d711a6fd32f5047879975027e5b152b52aa1dc = /music/d_e1m8.ogg
62c631c2fdaa5ecd9a8d8f369917244f27128810 = /music/d_e1m9.ogg
7702a6449585428e718558d8ecc387ef1a21d948 = /music/d_e2m1.ogg
1cb1810989cbfae2b29ba8d6d0f8f1175de45f03 = /music/d_e2m2.ogg
7d740f3c881a22945e472c68754fd9485cb04750 = /music/d_e2m4.ogg
ae9c3dc2f9aeea002327a5204d080ea82505a310 = /music/d_e2m6.ogg
b26aad3caa420e9a2c76586cd59433b092fcba1c = /music/d_e2m7.ogg
90f06251a2a90bfaefd47a526b28264ea64f4f83 = /music/d_e2m8.ogg
b2fb439f23c08c8e2577d262e5ed910a6a62c735 = /music/d_e3m1.ogg
b6c07bb249526b864208922d2d9ab655f4aade78 = /music/d_e3m2.ogg
ce3587ee503ffe707b2d8b690396114fdae6b411 = /music/d_e3m3.ogg
d746ea2aa16b3237422cb18ec66f26e12cb08d40 = /music/d_e3m8.ogg
3da3b1335560a92912e6d1eb542ba8c65dcb1d2c = /d_bunny.ogg
4a5badc4f10a7d4ed021e5d1cc470c1da728a741 = /d_inter.ogg
36b14bf165b3fdd3958ee83e4929063f051ada2f = /d_e1m7.ogg
e77c3d42f2ea87f046074bd4e3ff1e535da1c653 = /d_e1m6.ogg
3d85ec9c10b5ea46556899cfba701a556e27ca34 = /d_e2m7.ogg
4d42e2ce1c1ff192500e7a08e72c85fe59741487 = /d_e1m9.ogg
a05e45f67e1b64733fe31867ba759be0b9327a74 = /d_e2m1.ogg
8024ae1616ddd97ce33079276458479c9e15ad5f = /d_e1m4.ogg
3af8d79ddba49edaf9eba5e04d258d71b19b3782 = /d_victor.ogg
a55352c96c025b6bd08a6d9112bda72504be89ff = /d_inter.ogg
76d1fc25ab7b1b4a58d6e6203b0bb0c50689ee71 = /d_e1m8.ogg
497777f0863eca7cea8763316fe6d56d599b5f84 = /d_e1m2.ogg
0228fd87f8762f112fb60c601a7b43ba3b85f97e = /d_e2m2.ogg
db94e8e1d7c02092eab553859b45b00dcaed7471 = /d_e1m6.ogg
5a8d7a307eebc952795c4438efacbb6d0d8e40ee = /d_e2m7.ogg
1a36b692bf26d94a72ccf914087f3861b6baabff = /d_e1m7.ogg
37c6cefa351b06995152558af4b866d581da945f = /d_e1m5.ogg
36b97b87fe98348d44b6c2fdf76d49f8b123d277 = /d_e2m6.ogg`;

const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const loadDoom = async (canvas, consoleLog) => {
  console.log(location.hostname);
  consoleLog('Loading doom.wad...');

  const wadUrl = isDev ? './data/doom.wad' : 'https://console-doom.netlify.app/data/doom.wad';

  const res = await fetch(wadUrl);
  const content = await res.arrayBuffer();

  const doomFile = {
    filename: 'doom.wad',
    data: content,
    url: 'doom.wad',
    type: 'IWAD'
  };

  consoleLog('Loading doom.wasm...');
  consoleLog('🖱️ Trying PrBoom+ mouse arguments: -mouse 1 -novert 0 -mousesens 5');
  const audioContext = new AudioContext();
  const doom = await Doom({
    preRun: [
      ({ FS }) => {
        // add music
        const enc = new TextEncoder();
        FS.writeFile('./doom1-music.cfg', enc.encode(doomMusic));
        window.SDL2 = {};
        window.SDL2.audioContext = audioContext;

        // add game file
        FS.writeFile(doomFile.url, new Uint8Array(doomFile.data));
      }
    ],
    arguments: `-iwad ${doomFile.filename} -mouse 1 -novert 0 -mousesens 5`,
    canvas: canvas
  });

  return {
    pause: () => {
      doom.pauseMainLoop();
      if (audioContext) {
        audioContext.suspend();
      }
    },
    resume: () => {
      doom.resumeMainLoop();
      if (audioContext) {
        audioContext.resume();
      }
    }
  };
};

const wait = (time) => new Promise((r) => setTimeout(r, time));
const onFocus = () =>
  new Promise((resolve) => window.addEventListener('focus', resolve, { once: true }));

const logImage = (imageUrl) => {
  consoleLog(
    '%c ',
    `padding: 1200px 560px 0 0; background: bottom no-repeat url(${imageUrl}); background-size: 100%;`
  );
};

let isPaused = false;
const renderToConsole = async (canvas) => {
  let lastFrame;
  let wasPaused = false;
  let i = 0;
  while (true) {
    if (isPaused) {
      wasPaused = true;
      await wait(100);
      continue;
    }
    try {
      let frameUrl = canvas.toDataURL();
      const isValidFrame = frameUrl && frameUrl.length > 100;
      if (isValidFrame && (frameUrl !== lastFrame || wasPaused)) {
        if (wasPaused || i++ % 200 === 0) {
          console.clear();
        }
        lastFrame = frameUrl;
        logImage(frameUrl);
      }
    } catch (e) {}
    wasPaused = false;
    await wait(30);
  }
};

const main = async () => {
  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }
  if (isMobile()) {
    document.body.classList.add('mobile-device');
  }

  // we need to make sure the user has clicked on the main window
  // or chrome won't allow us to play audio
  // also the controls will not work correctly
  if (!document.hasFocus()) {
    consoleLog('click on the main window');
    await onFocus();
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';

  const minDimension = Math.min(window.innerWidth, window.innerHeight);

  let canvasWidth = minDimension * 0.8;
  let canvasHeight = minDimension * 0.8;
  if (isMobile()) {
    canvasWidth = minDimension;
    canvasHeight = minDimension;
  }

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Style the canvas for display in the browser
  canvas.style.display = 'block';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.margin = '0 auto';
  canvas.style.border = '2px solid #333';
  canvas.style.backgroundColor = '#000';
  canvas.style.width = `${canvasWidth}px`; // Scale up 2x for better visibility
  canvas.style.height = `${canvasHeight}px`;
  canvas.style.borderRadius = '8px';
  canvas.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';

  // Insert canvas into the designated game container instead of body
  const gameContainer = document.getElementById('game-container');
  if (gameContainer) {
    // Hide loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }
    // Hide start prompt
    const startPrompt = gameContainer.querySelector('.start-prompt');
    if (startPrompt) {
      startPrompt.style.display = 'none';
    }
    gameContainer.appendChild(canvas);
  } else {
    // Fallback to body if container not found
    document.body.appendChild(canvas);
  }

  const doom = await loadDoom(canvas, consoleLog);

  // Display game info in console instead of rendering frames
  consoleLog('🎮 DOOM is now running in the browser window!');
  consoleLog('🔧 Full FPS mouse controls - modern gaming experience!');
  consoleLog('Controls:');
  consoleLog('- WASD: Move/Strafe (confirmed working)');
  consoleLog('- 🖱️ CLICK CANVAS: Lock mouse for FPS turning');
  consoleLog('- 🔫 LEFT CLICK: Fire weapon (Q key)');
  consoleLog('- 🚪 RIGHT CLICK: Use/Action (E key)');
  consoleLog('- ESC: Unlock mouse cursor');
  consoleLog('- Arrow keys: Turn (manual fallback)');
  consoleLog('⚡ Features: Ultra-responsive turning, mouse buttons mapped to actions');

  // Comment out console rendering since we're showing in browser
  // renderToConsole(canvas);

  if (!document.hasFocus()) {
    doom.pause();
    isPaused = true;
    consoleLog('click on the main window');
  }

  window.addEventListener('blur', () => {
    if (isPaused) return;
    doom.pause();
    isPaused = true;
    consoleLog('PAUSED');
    consoleLog('Click on the main window to resume');
  });

  window.addEventListener('focus', () => {
    if (!isPaused) return;
    doom.resume();
    isPaused = false;
  });

  // Pointer lock state management
  let isPointerLocked = false;
  let lastWASMCallTime = 0;

  // Enhanced mouse handling with pointer lock support
  canvas.addEventListener('click', async () => {
    if (!isPointerLocked) {
      try {
        await canvas.requestPointerLock();
        consoleLog('🔒 Mouse locked - move mouse to look around, press ESC to unlock');
      } catch (err) {
        consoleLog('❌ Pointer lock failed:', err);
      }
    }
  });

  // Pointer lock change handler
  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
    if (isPointerLocked) {
      consoleLog('🔒 Mouse locked and hidden');
      canvas.style.cursor = 'none';
    } else {
      consoleLog('🔓 Mouse unlocked');
      canvas.style.cursor = 'default';
    }
  });

  // Escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPointerLocked) {
      document.exitPointerLock();
    }
  });

  // High-frequency mouse movement handler
  document.addEventListener('mousemove', (e) => {
    // Only process if pointer is locked - much lower threshold for higher sensitivity
    if (!isPointerLocked || Math.abs(e.movementX) < 0.5) return;

    const now = Date.now();
    lastWASMCallTime = now;

    // Fire more frequently with amplified movement
    performCanvasKeyboard(e.movementX * 2); // 2x amplification for faster turning

    // Less frequent throttle messages
    if (now - lastWASMCallTime > 2000) {
      consoleLog('⚠️ Using keyboard fallback - WASM mouse function not available');
      lastWASMCallTime = now;
    }
  });

  // Mouse button handlers for FPS-style controls
  document.addEventListener('mousedown', (e) => {
    // Only process if pointer is locked
    if (!isPointerLocked) return;

    // Prevent default context menu and other browser actions
    e.preventDefault();
    e.stopPropagation();

    if (e.button === 0) {
      // Left mouse button = Fire weapon (Q)
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'q',
          code: 'KeyQ',
          keyCode: 81,
          which: 81,
          bubbles: true,
          cancelable: true
        })
      );
    } else if (e.button === 2) {
      // Right mouse button = Action/Use (E)
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'e',
          code: 'KeyE',
          keyCode: 69,
          which: 69,
          bubbles: true,
          cancelable: true
        })
      );
    }
  });

  document.addEventListener('mouseup', (e) => {
    // Only process if pointer is locked
    if (!isPointerLocked) return;

    // Prevent default browser actions
    e.preventDefault();
    e.stopPropagation();

    if (e.button === 0) {
      // Release fire weapon (Q)
      canvas.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'q',
          code: 'KeyQ',
          keyCode: 81,
          which: 81,
          bubbles: true,
          cancelable: true
        })
      );
    } else if (e.button === 2) {
      // Release action/use (E)
      canvas.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'e',
          code: 'KeyE',
          keyCode: 69,
          which: 69,
          bubbles: true,
          cancelable: true
        })
      );
    }
  });

  // Disable context menu when pointer is locked
  document.addEventListener('contextmenu', (e) => {
    if (isPointerLocked) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Mobile control button handlers
  if (isMobile()) {
    const activeButtons = new Set();

    // Get all control buttons
    const controlButtons = document.querySelectorAll('.control-btn');

    const sendKeyEvent = (type, key, code, keyCode) => {
      const event = new KeyboardEvent(type, {
        key: key,
        code: code,
        keyCode: parseInt(keyCode),
        which: parseInt(keyCode),
        bubbles: true,
        cancelable: true
      });
      canvas.dispatchEvent(event);
    };

    // Handle button press/release for each control button
    controlButtons.forEach((button) => {
      const key = button.dataset.key;
      const code = button.dataset.code;
      const keyCode = button.dataset.keycode;

      // Prevent context menu and text selection
      button.addEventListener('contextmenu', (e) => e.preventDefault());
      button.addEventListener('selectstart', (e) => e.preventDefault());

      // Touch start (button press)
      button.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          if (!activeButtons.has(key)) {
            activeButtons.add(key);
            sendKeyEvent('keydown', key, code, keyCode);
            button.style.opacity = '0.7';
          }
        },
        { passive: false }
      );

      // Touch end (button release)
      button.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          if (activeButtons.has(key)) {
            activeButtons.delete(key);
            sendKeyEvent('keyup', key, code, keyCode);
            button.style.opacity = '1';
          }
        },
        { passive: false }
      );

      // Touch cancel (button release on touch cancel)
      button.addEventListener(
        'touchcancel',
        (e) => {
          e.preventDefault();
          if (activeButtons.has(key)) {
            activeButtons.delete(key);
            sendKeyEvent('keyup', key, code, keyCode);
            button.style.opacity = '1';
          }
        },
        { passive: false }
      );

      // Also handle mouse events for testing on desktop
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!activeButtons.has(key)) {
          activeButtons.add(key);
          sendKeyEvent('keydown', key, code, keyCode);
          button.style.opacity = '0.7';
        }
      });

      button.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (activeButtons.has(key)) {
          activeButtons.delete(key);
          sendKeyEvent('keyup', key, code, keyCode);
          button.style.opacity = '1';
        }
      });

      button.addEventListener('mouseleave', (e) => {
        if (activeButtons.has(key)) {
          activeButtons.delete(key);
          sendKeyEvent('keyup', key, code, keyCode);
          button.style.opacity = '1';
        }
      });
    });

    // Clean up any stuck keys when leaving the page
    window.addEventListener('beforeunload', () => {
      activeButtons.forEach((key) => {
        const button = document.querySelector(`[data-key="${key}"]`);
        if (button) {
          const code = button.dataset.code;
          const keyCode = button.dataset.keycode;
          sendKeyEvent('keyup', key, code, keyCode);
        }
      });
    });

    consoleLog('📱 Mobile control buttons enabled');
    consoleLog('- WASD: Movement controls (green)');
    consoleLog('- Arrow keys: Look/turn controls (red)');
    consoleLog('- 🔫: Fire weapon (Q key)');
    consoleLog('- 🚪: Use/Action (E key)');
    consoleLog('- ⏎: Menu select (Enter key)');
  }

  // Touch drag controls for W/S/Left/Right movement (works on all devices)
  let touchDragStart = null;
  let isWPressed = false;
  let isSPressed = false;
  let isLeftPressed = false;
  let isRightPressed = false;

  // Tap detection for Q (shoot) and E (action)
  let tapStartTime = null;
  let tapCount = 0;
  let tapTimeout = null;
  let isDragging = false;
  const TAP_MAX_DURATION = 300; // Maximum duration for a tap in ms
  const TAP_MAX_DISTANCE = 10; // Maximum distance moved for a tap in pixels
  const DOUBLE_TAP_DELAY = 400; // Maximum delay between taps for double tap

  // Use existing sendKeyEvent function or create a local version
  const sendTouchKeyEvent = (type, key, code, keyCode) => {
    const event = new KeyboardEvent(type, {
      key: key,
      code: code,
      keyCode: parseInt(keyCode),
      which: parseInt(keyCode),
      bubbles: true,
      cancelable: true
    });
    canvas.dispatchEvent(event);
  };

  const releaseMovementKeys = () => {
    if (isWPressed) {
      sendTouchKeyEvent('keyup', 'w', 'KeyW', 87);
      isWPressed = false;
    }
    if (isSPressed) {
      sendTouchKeyEvent('keyup', 's', 'KeyS', 83);
      isSPressed = false;
    }
    if (isLeftPressed) {
      sendTouchKeyEvent('keyup', 'ArrowLeft', 'ArrowLeft', 37);
      isLeftPressed = false;
    }
    if (isRightPressed) {
      sendTouchKeyEvent('keyup', 'ArrowRight', 'ArrowRight', 39);
      isRightPressed = false;
    }
  };

  const handleSingleTap = () => {
    // Single tap = Q key (shoot)
    sendTouchKeyEvent('keydown', 'q', 'KeyQ', 81);
    setTimeout(() => {
      sendTouchKeyEvent('keyup', 'q', 'KeyQ', 81);
    }, 100); // Brief key press
  };

  const handleDoubleTap = () => {
    // Double tap = E key (action)
    sendTouchKeyEvent('keydown', 'e', 'KeyE', 69);
    setTimeout(() => {
      sendTouchKeyEvent('keyup', 'e', 'KeyE', 69);
    }, 100); // Brief key press
  };

  const processTap = () => {
    tapCount++;

    if (tapTimeout) {
      clearTimeout(tapTimeout);
      tapTimeout = null;
    }

    if (tapCount === 1) {
      // Wait to see if there's a second tap
      tapTimeout = setTimeout(() => {
        handleSingleTap();
        tapCount = 0;
      }, DOUBLE_TAP_DELAY);
    } else if (tapCount === 2) {
      // Double tap detected
      handleDoubleTap();
      tapCount = 0;
    }
  };

  // Add touch drag listeners to the entire document
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchDragStart = {
          x: touch.clientX,
          y: touch.clientY
        };

        // Initialize tap detection
        tapStartTime = Date.now();
        isDragging = false;

        // Release any previously held keys when starting a new drag
        releaseMovementKeys();
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (touchDragStart && e.touches.length === 1) {
        e.preventDefault(); // Prevent scrolling

        const currentTouch = e.touches[0];
        const deltaX = currentTouch.clientX - touchDragStart.x;
        const deltaY = currentTouch.clientY - touchDragStart.y;

        // Check if movement exceeds tap threshold
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!isDragging && distance > TAP_MAX_DISTANCE) {
          isDragging = true;
        }

        // Handle vertical movement (forward/backward)
        if (Math.abs(deltaY) > 20) {
          if (deltaY < -30) {
            // Dragging up
            if (!isWPressed) {
              // Release S if it was pressed, but keep left/right
              if (isSPressed) {
                sendTouchKeyEvent('keyup', 's', 'KeyS', 83);
                isSPressed = false;
              }
              sendTouchKeyEvent('keydown', 'w', 'KeyW', 87);
              isWPressed = true;
            }
          } else if (deltaY > 30) {
            // Dragging down
            if (!isSPressed) {
              // Release W if it was pressed, but keep left/right
              if (isWPressed) {
                sendTouchKeyEvent('keyup', 'w', 'KeyW', 87);
                isWPressed = false;
              }
              sendTouchKeyEvent('keydown', 's', 'KeyS', 83);
              isSPressed = true;
            }
          }
        }

        // Handle horizontal movement (left/right turn)
        if (Math.abs(deltaX) > 20) {
          if (deltaX < -30) {
            // Dragging left
            if (!isLeftPressed) {
              // Release Right if it was pressed, but keep W/S
              if (isRightPressed) {
                sendTouchKeyEvent('keyup', 'ArrowRight', 'ArrowRight', 39);
                isRightPressed = false;
              }
              sendTouchKeyEvent('keydown', 'ArrowLeft', 'ArrowLeft', 37);
              isLeftPressed = true;
            }
          } else if (deltaX > 30) {
            // Dragging right
            if (!isRightPressed) {
              // Release Left if it was pressed, but keep W/S
              if (isLeftPressed) {
                sendTouchKeyEvent('keyup', 'ArrowLeft', 'ArrowLeft', 37);
                isLeftPressed = false;
              }
              sendTouchKeyEvent('keydown', 'ArrowRight', 'ArrowRight', 39);
              isRightPressed = true;
            }
          }
        }
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length === 0) {
        const touchDuration = Date.now() - tapStartTime;

        // Check if this was a tap (quick touch without dragging)
        if (!isDragging && touchDuration <= TAP_MAX_DURATION && tapStartTime) {
          processTap();
        }

        // Release all movement keys when touch ends
        releaseMovementKeys();
        touchDragStart = null;
        tapStartTime = null;
        isDragging = false;
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchcancel',
    (e) => {
      // Release all movement keys when touch is cancelled
      releaseMovementKeys();
      touchDragStart = null;
      tapStartTime = null;
      isDragging = false;

      // Clear any pending tap timeout
      if (tapTimeout) {
        clearTimeout(tapTimeout);
        tapTimeout = null;
        tapCount = 0;
      }
    },
    { passive: false }
  );

  consoleLog('👆 Touch controls enabled');
  consoleLog('- Drag up anywhere: Move forward (W key)');
  consoleLog('- Drag down anywhere: Move backward (S key)');
  consoleLog('- Drag left anywhere: Turn left (Left arrow)');
  consoleLog('- Drag right anywhere: Turn right (Right arrow)');
  consoleLog('- Single tap anywhere: Fire weapon (Q key)');
  consoleLog('- Double tap anywhere: Use/Action (E key)');
  consoleLog('- Works on entire page, not just game area');

  // State tracking for continuous key events
  let currentTurnDirection = null;
  let turnKeyTimeout = null;

  function performCanvasKeyboard(movementX) {
    const isLeft = movementX < 0;
    const keyCode = isLeft ? 'ArrowLeft' : 'ArrowRight';
    const newDirection = isLeft ? 'left' : 'right';

    // Clear any existing timeout
    if (turnKeyTimeout) {
      clearTimeout(turnKeyTimeout);
      turnKeyTimeout = null;
    }

    // If direction changed, send keyup for previous direction
    if (currentTurnDirection && currentTurnDirection !== newDirection) {
      const prevKeyCode = currentTurnDirection === 'left' ? 'ArrowLeft' : 'ArrowRight';
      canvas.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: prevKeyCode,
          code: prevKeyCode,
          keyCode: prevKeyCode === 'ArrowLeft' ? 37 : 39,
          bubbles: true,
          cancelable: true
        })
      );
    }

    // Send keydown for current direction
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: keyCode,
        code: keyCode,
        keyCode: isLeft ? 37 : 39,
        which: isLeft ? 37 : 39,
        bubbles: true,
        cancelable: true
      })
    );

    currentTurnDirection = newDirection;

    // Much shorter keyup delay for more frequent firing - intensity-based
    const intensity = Math.abs(movementX);
    const keyDuration = Math.max(20, Math.min(intensity * 3, 80)); // 20-80ms range

    turnKeyTimeout = setTimeout(() => {
      canvas.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: keyCode,
          code: keyCode,
          keyCode: isLeft ? 37 : 39,
          which: isLeft ? 37 : 39,
          bubbles: true,
          cancelable: true
        })
      );
      currentTurnDirection = null;
    }, keyDuration);
  }
};

main();
