// 🎆 FIREWORKS MODULE 🎆
// Random fireworks explosions in the background!

/**
 * @fileoverview Fireworks effect with particle explosions
 */

var fireworksNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};
  var isEnabled = false;
  var intervalId = null;

  // 🎨 Firework colors
  var colors = [
    ['#ff0000', '#ff6600', '#ffcc00'], // Fire
    ['#00ff00', '#00ffcc', '#00ff66'], // Green
    ['#0066ff', '#00ccff', '#66ffff'], // Blue
    ['#ff00ff', '#ff66ff', '#ffccff'], // Pink
    ['#ffff00', '#ffcc00', '#ff9900'], // Gold
    ['#ff0066', '#ff3399', '#ff66cc'], // Hot pink
    ['#00ffff', '#66ffff', '#99ffff'], // Cyan
    ['#ffffff', '#ffccff', '#ccffff'] // White sparkle
  ];

  /**
   * Create explosion particles
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {Array} colorPalette - Colors to use
   */
  function createExplosion(x, y, colorPalette) {
    var particleCount = 30 + Math.floor(Math.random() * 30);

    for (var i = 0; i < particleCount; i++) {
      createParticle(x, y, colorPalette);
    }
  }

  /**
   * Create a single particle
   * @param {number} x - Start X
   * @param {number} y - Start Y
   * @param {Array} colorPalette - Colors to use
   */
  function createParticle(x, y, colorPalette) {
    var particle = document.createElement('div');
    particle.className = 'awesome-firework-particle';

    var color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    var size = 3 + Math.random() * 4;
    var angle = Math.random() * Math.PI * 2;
    var speed = 2 + Math.random() * 6;
    var velocityX = Math.cos(angle) * speed;
    var velocityY = Math.sin(angle) * speed;
    var gravity = 0.1;
    var friction = 0.98;

    particle.style.cssText = [
      'position: fixed',
      'width: ' + size + 'px',
      'height: ' + size + 'px',
      'background: ' + color,
      'border-radius: 50%',
      'left: ' + x + 'px',
      'top: ' + y + 'px',
      'pointer-events: none',
      'z-index: ' + ((config.zIndex && config.zIndex.fireworks) || '9994'),
      'box-shadow: 0 0 6px ' + color + ', 0 0 12px ' + color
    ].join(';');

    document.body.appendChild(particle);

    var currentX = x;
    var currentY = y;
    var life = 1;
    var decay = 0.015 + Math.random() * 0.01;

    function animate() {
      life -= decay;

      if (life <= 0) {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
        return;
      }

      velocityX *= friction;
      velocityY *= friction;
      velocityY += gravity;

      currentX += velocityX;
      currentY += velocityY;

      particle.style.left = currentX + 'px';
      particle.style.top = currentY + 'px';
      particle.style.opacity = life;
      particle.style.transform = 'scale(' + life + ')';

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  /**
   * Create a rocket trail going up
   * @param {number} startX - Start X position
   * @param {Function} onExplode - Callback when rocket reaches top
   */
  function createRocket(startX, onExplode) {
    var rocket = document.createElement('div');
    rocket.className = 'awesome-firework-rocket';

    var x = startX;
    var y = window.innerHeight + 20;
    var targetY = 100 + Math.random() * (window.innerHeight * 0.4);
    var speed = 8 + Math.random() * 4;

    rocket.style.cssText = [
      'position: fixed',
      'width: 4px',
      'height: 12px',
      'background: linear-gradient(to top, #ff6600, #ffcc00, #fff)',
      'border-radius: 2px',
      'left: ' + x + 'px',
      'top: ' + y + 'px',
      'pointer-events: none',
      'z-index: ' + ((config.zIndex && config.zIndex.fireworks) || '9994'),
      'box-shadow: 0 0 10px #ff6600'
    ].join(';');

    document.body.appendChild(rocket);

    var trailInterval = setInterval(function () {
      // Create trail particle
      var trail = document.createElement('div');
      trail.style.cssText = [
        'position: fixed',
        'width: 3px',
        'height: 3px',
        'background: #ff9900',
        'border-radius: 50%',
        'left: ' + (x + Math.random() * 4 - 2) + 'px',
        'top: ' + y + 'px',
        'pointer-events: none',
        'z-index: 9993',
        'opacity: 0.8'
      ].join(';');
      document.body.appendChild(trail);

      // Fade out trail
      setTimeout(function () {
        trail.style.transition = 'opacity 0.3s';
        trail.style.opacity = '0';
        setTimeout(function () {
          if (trail.parentNode) {
            trail.parentNode.removeChild(trail);
          }
        }, 300);
      }, 50);
    }, 30);

    function animate() {
      y -= speed;
      rocket.style.top = y + 'px';

      // Add some wobble
      x += (Math.random() - 0.5) * 2;
      rocket.style.left = x + 'px';

      if (y <= targetY) {
        clearInterval(trailInterval);
        if (rocket.parentNode) {
          rocket.parentNode.removeChild(rocket);
        }
        if (onExplode) {
          onExplode(x, y);
        }
        return;
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  /**
   * Launch a firework
   * @param {Object} [options] - Options
   * @param {number} [options.x] - X position (random if not specified)
   */
  namespace.launch = function (options) {
    options = options || {};
    var x = options.x !== undefined ? options.x : Math.random() * window.innerWidth;
    var colorPalette = colors[Math.floor(Math.random() * colors.length)];

    createRocket(x, function (explodeX, explodeY) {
      createExplosion(explodeX, explodeY, colorPalette);

      // Sometimes create secondary explosions
      if (Math.random() > 0.5) {
        setTimeout(function () {
          var offsetX = (Math.random() - 0.5) * 100;
          var offsetY = (Math.random() - 0.5) * 100;
          createExplosion(explodeX + offsetX, explodeY + offsetY, colorPalette);
        }, 200);
      }
    });
  };

  /**
   * Instant explosion without rocket
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  namespace.explode = function (x, y) {
    var colorPalette = colors[Math.floor(Math.random() * colors.length)];
    createExplosion(x, y, colorPalette);
  };

  /**
   * Enable auto fireworks
   * @param {number} [interval] - Interval in ms (default: 2000)
   */
  namespace.enable = function (interval) {
    if (isEnabled) return;

    interval = interval || 2000;
    isEnabled = true;

    // Launch one immediately
    namespace.launch();

    intervalId = setInterval(function () {
      namespace.launch();
    }, interval);
  };

  /**
   * Disable auto fireworks
   */
  namespace.disable = function () {
    if (!isEnabled) return;

    isEnabled = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  /**
   * Toggle auto fireworks
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
   * Grand finale - many fireworks at once
   * @param {number} [count] - Number of fireworks
   */
  namespace.finale = function (count) {
    count = count || 10;

    for (var i = 0; i < count; i++) {
      setTimeout(function () {
        namespace.launch();
      }, i * 200);
    }
  };

  /**
   * Check if enabled
   * @returns {boolean} Enabled state
   */
  namespace.isEnabled = function () {
    return isEnabled;
  };

  return namespace;
})();

// 🌍 Expose globally
window.fireworksNamespace = fireworksNamespace;
window.awesomeFireworksNamespace = fireworksNamespace;
