// Mobile controller functionality
(function () {
  'use strict';

  // Check if we're on mobile
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth <= 768;

  if (isMobile) {
    // Show mobile controller
    const mobileController = document.getElementById('mobileController');
    if (mobileController) {
      mobileController.style.display = 'block';
    }

    // Function to ensure mobile controller stays visible (but only when appropriate)
    window.ensureMobileControllerVisible = function () {
      const controller = document.getElementById('mobileController');

      // Only show controller if we're on mobile AND no blocking UI is visible
      if (controller && isMobile) {
        // Check if initial menu is visible
        const initialMenuVisible =
          window.Gui && window.Gui.initialMenu && window.Gui.initialMenu.isVisible();

        // Check if ROM browser modal is visible
        const romBrowser = document.querySelector('rom-browser');
        const romBrowserVisible =
          romBrowser &&
          romBrowser.shadowRoot &&
          romBrowser.shadowRoot.querySelector('.modal.show');

        // Check if hamburger menu is open
        const hamburgerDropdown = document.getElementById('hamburgerDropdown');
        const hamburgerMenuVisible =
          hamburgerDropdown && !hamburgerDropdown.classList.contains('hidden');

        if (!initialMenuVisible && !romBrowserVisible && !hamburgerMenuVisible) {
          controller.style.display = 'block';
        }
      }
    };

    // Call this function periodically to ensure controller stays visible
    setInterval(window.ensureMobileControllerVisible, 1000);

    // Add landscape orientation message
    function checkOrientation() {
      const orientationMsg = document.querySelector('.md\\:hidden .text-sm');
      if (orientationMsg) {
        if (window.innerHeight > window.innerWidth) {
          orientationMsg.textContent = 'Rotate device horizontally for best experience';
          orientationMsg.className = 'text-sm text-orange-600 font-medium';
        } else {
          orientationMsg.textContent = 'Perfect! Enjoy your game';
          orientationMsg.className = 'text-sm text-green-600';
        }
      }
    }

    window.addEventListener('orientationchange', checkOrientation);
    window.addEventListener('resize', checkOrientation);
    checkOrientation();
  }

  // Mobile touch controls
  const mobileButtons = document.querySelectorAll('#mobileController button');

  // Key mapping for NES controls
  const keyMap = {
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    A: 'KeyZ',
    B: 'KeyX',
    SELECT: 'KeyC',
    START: 'KeyV'
  };

  // Haptic feedback function
  function triggerHapticFeedback() {
    if (navigator.vibrate) {
      // Light vibration for button press (30ms)
      navigator.vibrate(30);
    }
  }

  // Simulate keyboard events for mobile buttons
  function simulateKeyEvent(type, key) {
    const event = new KeyboardEvent(type, {
      key: key,
      code: keyMap[key] || key,
      keyCode: getKeyCode(key),
      which: getKeyCode(key),
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
  }

  function getKeyCode(key) {
    const codes = {
      UP: 38,
      DOWN: 40,
      LEFT: 37,
      RIGHT: 39,
      A: 90,
      B: 88,
      SELECT: 67,
      START: 86
    };
    return codes[key] || 0;
  }

  // Add touch event listeners
  mobileButtons.forEach((button) => {
    const key = button.getAttribute('data-key');
    if (key) {
      // Prevent default touch behavior
      button.addEventListener(
        'touchstart',
        function (e) {
          e.preventDefault();
          button.classList.add('active');
          triggerHapticFeedback();
          simulateKeyEvent('keydown', key);
        },
        { passive: false }
      );

      button.addEventListener(
        'touchend',
        function (e) {
          e.preventDefault();
          button.classList.remove('active');
          simulateKeyEvent('keyup', key);
        },
        { passive: false }
      );

      button.addEventListener(
        'touchcancel',
        function (e) {
          e.preventDefault();
          button.classList.remove('active');
          simulateKeyEvent('keyup', key);
        },
        { passive: false }
      );

      // Also handle mouse events for testing on desktop
      button.addEventListener('mousedown', function (e) {
        e.preventDefault();
        button.classList.add('active');
        triggerHapticFeedback();
        simulateKeyEvent('keydown', key);
      });

      button.addEventListener('mouseup', function (e) {
        e.preventDefault();
        button.classList.remove('active');
        simulateKeyEvent('keyup', key);
      });

      button.addEventListener('mouseleave', function (e) {
        button.classList.remove('active');
        simulateKeyEvent('keyup', key);
      });
    }
  });

  // Prevent scrolling when touching the controller area
  const controller = document.getElementById('mobileController');
  if (controller) {
    controller.addEventListener(
      'touchmove',
      function (e) {
        e.preventDefault();
      },
      { passive: false }
    );
  }
})();

// Configure share button with game context
(function () {
  const shareBtn = document.querySelector('share-button');
  if (shareBtn) {
    shareBtn.textGenerator = function () {
      try {
        const lastRomInfo = localStorage.getItem('webnes_lastRom');
        if (lastRomInfo) {
          const romData = JSON.parse(lastRomInfo);
          if (romData.name) {
            const gameName = romData.name.replace(/\.(nes|zip)$/i, '');
            return "I'm playing " + gameName + ' on the NES Emulator! 🎮';
          }
        }
      } catch (e) {}
      return 'Check out this NES Emulator - play classic Nintendo games in your browser! 🎮';
    };
  }
})();
