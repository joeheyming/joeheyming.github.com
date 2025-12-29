// 🌈 RAINBOW CURSOR MODULE 🌈
// Leave a magical rainbow trail wherever you go!

/**
 * @fileoverview Rainbow cursor trail effect
 */

var cursorNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};
  var isEnabled = false;
  var particles = [];
  var animationId = null;
  var lastX = 0;
  var lastY = 0;
  var hue = 0;

  /**
   * Create a trail particle
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} hueValue - Color hue (0-360)
   */
  function createParticle(x, y, hueValue) {
    var particle = document.createElement('div');
    particle.className = 'awesome-cursor-particle';

    var size = 10 + Math.random() * 10;

    // Dynamic styles only (z-index comes from CSS)
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.background = 'hsl(' + hueValue + ', 100%, 50%)';
    particle.style.left = x - size / 2 + 'px';
    particle.style.top = y - size / 2 + 'px';
    particle.style.boxShadow = '0 0 ' + size / 2 + 'px hsl(' + hueValue + ', 100%, 50%)';
    particle.style.opacity = '1';

    document.body.appendChild(particle);

    return {
      element: particle,
      x: x,
      y: y,
      size: size,
      life: 1,
      decay: 0.02 + Math.random() * 0.02,
      velocityX: (Math.random() - 0.5) * 2,
      velocityY: (Math.random() - 0.5) * 2
    };
  }

  /**
   * Update all particles
   */
  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];

      p.life -= p.decay;
      p.x += p.velocityX;
      p.y += p.velocityY;
      p.size *= 0.98;

      if (p.life <= 0 || p.size < 1) {
        if (p.element.parentNode) {
          p.element.parentNode.removeChild(p.element);
        }
        particles.splice(i, 1);
      } else {
        p.element.style.left = p.x - p.size / 2 + 'px';
        p.element.style.top = p.y - p.size / 2 + 'px';
        p.element.style.width = p.size + 'px';
        p.element.style.height = p.size + 'px';
        p.element.style.opacity = p.life;
      }
    }
  }

  /**
   * Animation loop
   */
  function animate() {
    if (!isEnabled) return;

    updateParticles();
    animationId = requestAnimationFrame(animate);
  }

  /**
   * Handle pointer movement (mouse or touch)
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function handleMove(x, y) {
    if (!isEnabled) return;

    // Calculate distance moved
    var dx = x - lastX;
    var dy = y - lastY;
    var distance = Math.sqrt(dx * dx + dy * dy);

    // Only create particles if moving fast enough
    if (distance > 5) {
      // Create multiple particles along the path
      var steps = Math.min(Math.floor(distance / 5), 5);
      for (var i = 0; i < steps; i++) {
        var ratio = i / steps;
        var px = lastX + dx * ratio;
        var py = lastY + dy * ratio;

        hue = (hue + 5) % 360;
        particles.push(createParticle(px, py, hue));
      }
    }

    lastX = x;
    lastY = y;
  }

  /**
   * Handle mouse movement
   * @param {MouseEvent} e - Mouse event
   */
  function onMouseMove(e) {
    handleMove(e.clientX, e.clientY);
  }

  /**
   * Handle touch start - initialize position
   * @param {TouchEvent} e - Touch event
   */
  function onTouchStart(e) {
    if (!isEnabled || !e.touches.length) return;
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  }

  /**
   * Handle touch movement
   * @param {TouchEvent} e - Touch event
   */
  function onTouchMove(e) {
    if (!isEnabled || !e.touches.length) return;
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }

  /**
   * Enable rainbow cursor (works with mouse and touch)
   */
  namespace.enable = function () {
    if (isEnabled) return;

    isEnabled = true;

    // Mouse events
    document.addEventListener('mousemove', onMouseMove);

    // Touch events for mobile
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });

    animate();

    // Add sparkle cursor (desktop only)
    document.body.style.cursor = 'crosshair';
  };

  /**
   * Disable rainbow cursor
   */
  namespace.disable = function () {
    if (!isEnabled) return;

    isEnabled = false;

    // Remove mouse events
    document.removeEventListener('mousemove', onMouseMove);

    // Remove touch events
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // Clean up remaining particles
    particles.forEach(function (p) {
      if (p.element.parentNode) {
        p.element.parentNode.removeChild(p.element);
      }
    });
    particles = [];

    document.body.style.cursor = '';
  };

  /**
   * Toggle rainbow cursor
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
   * Spawn a burst of particles at a point
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} [count] - Number of particles
   */
  namespace.burst = function (x, y, count) {
    count = count || 20;

    for (var i = 0; i < count; i++) {
      hue = (hue + 15) % 360;
      var p = createParticle(x, y, hue);
      p.velocityX = (Math.random() - 0.5) * 10;
      p.velocityY = (Math.random() - 0.5) * 10;
      particles.push(p);
    }

    // Make sure animation is running
    if (!animationId) {
      animate();
    }
  };

  return namespace;
})();

// 🌍 Expose globally
window.cursorNamespace = cursorNamespace;
window.awesomeCursorNamespace = cursorNamespace;
