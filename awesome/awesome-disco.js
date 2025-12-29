// 🪩 DISCO BALL MODULE 🪩
// Spinning disco ball with sweeping light rays!

/**
 * @fileoverview Disco ball with rotating light beams
 */

var discoNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};
  var isEnabled = false;
  var discoBall = null;
  var lightContainer = null;
  var animationId = null;
  var rotation = 0;

  // 🪩 Disco ball GIF
  var discoBallGif = 'awesome-disco.gif';

  // 🎨 Light ray colors
  var rayColors = [
    '#ff0000',
    '#ff7700',
    '#ffff00',
    '#00ff00',
    '#00ffff',
    '#0077ff',
    '#7700ff',
    '#ff00ff'
  ];

  /**
   * Create the disco ball element using a GIF
   */
  function createDiscoBall() {
    var container = document.createElement('div');
    container.className = 'awesome-disco-container';
    // z-index comes from CSS

    // String/chain
    var chain = document.createElement('div');
    chain.className = 'awesome-disco-chain';

    // The disco ball GIF
    var ball = document.createElement('img');
    ball.src = discoBallGif;
    ball.alt = 'Disco Ball';
    ball.className = 'awesome-disco-ball';

    container.appendChild(chain);
    container.appendChild(ball);

    return container;
  }

  /**
   * Create light rays container
   */
  function createLightRays() {
    var container = document.createElement('div');
    container.className = 'awesome-disco-lights';
    // z-index comes from CSS

    // Create light rays
    var numRays = 12;
    for (var i = 0; i < numRays; i++) {
      var ray = document.createElement('div');
      var angle = (i / numRays) * 360;
      var color = rayColors[i % rayColors.length];

      ray.className = 'awesome-disco-ray';
      ray.dataset.baseAngle = angle;
      ray.dataset.speed = (0.3 + Math.random() * 0.4).toString(); // Varied speeds
      // Dynamic styles only (size and color vary)
      ray.style.borderTop = Math.max(window.innerHeight, window.innerWidth) + 'px solid ' + color;
      ray.style.transform = 'rotate(' + angle + 'deg)';

      container.appendChild(ray);
    }

    return container;
  }

  /**
   * Update light rays rotation
   */
  function updateLights() {
    if (!lightContainer) return;

    var rays = lightContainer.querySelectorAll('.awesome-disco-ray');
    rays.forEach(function (ray) {
      var baseAngle = parseFloat(ray.dataset.baseAngle);
      var speed = parseFloat(ray.dataset.speed);
      var newAngle = baseAngle + rotation * speed;
      ray.style.transform = 'rotate(' + newAngle + 'deg)';

      // Pulse opacity with varied timing
      var offset = ((rotation * speed + baseAngle) * Math.PI) / 180;
      var pulse = 0.05 + Math.abs(Math.sin(offset)) * 0.2;
      ray.style.opacity = pulse;
    });
  }

  /**
   * Animation loop
   */
  function animate() {
    if (!isEnabled) return;

    rotation += 0.8;
    if (rotation >= 360) rotation = 0;

    updateLights();
    animationId = requestAnimationFrame(animate);
  }

  /**
   * Enable disco mode
   */
  namespace.enable = function () {
    if (isEnabled) return;

    isEnabled = true;

    // Create elements
    discoBall = createDiscoBall();
    lightContainer = createLightRays();

    document.body.appendChild(lightContainer);
    document.body.appendChild(discoBall);

    // Start animation
    animate();
  };

  /**
   * Disable disco mode
   */
  namespace.disable = function () {
    if (!isEnabled) return;

    isEnabled = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    if (discoBall && discoBall.parentNode) {
      discoBall.parentNode.removeChild(discoBall);
      discoBall = null;
    }

    if (lightContainer && lightContainer.parentNode) {
      lightContainer.parentNode.removeChild(lightContainer);
      lightContainer = null;
    }
  };

  /**
   * Toggle disco mode
   * @returns {boolean} New enabled state
   */
  namespace.toggle = function () {
    if (isEnabled) {
      namespace.disable();
    } else {
      namespace.enable();
    }
    return isEnabled;
  };

  /**
   * Check if enabled
   * @returns {boolean} Enabled state
   */
  namespace.isEnabled = function () {
    return isEnabled;
  };

  /**
   * Flash all lights bright momentarily
   */
  namespace.flash = function () {
    if (!lightContainer) return;

    var rays = lightContainer.querySelectorAll('.awesome-disco-ray');
    rays.forEach(function (ray) {
      ray.style.transition = 'opacity 0.1s';
      ray.style.opacity = '0.6';

      setTimeout(function () {
        ray.style.transition = 'opacity 0.5s';
        ray.style.opacity = '0.15';
      }, 100);
    });
  };

  /**
   * Speed up rotation temporarily
   * @param {number} [duration] - Duration in ms
   */
  namespace.spin = function (duration) {
    duration = duration || 3000;
    var startTime = Date.now();

    var speedUp = setInterval(function () {
      var elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        clearInterval(speedUp);
        return;
      }

      // Add extra rotation
      rotation += 2;
    }, 16);
  };

  return namespace;
})();

// 🌍 Expose globally
window.discoNamespace = discoNamespace;
window.awesomeDiscoNamespace = discoNamespace;
