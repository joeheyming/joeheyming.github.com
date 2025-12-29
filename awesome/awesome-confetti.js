// 🎊 CONFETTI MODULE 🎊
// Celebrate milestones with confetti explosions!

/**
 * @fileoverview Confetti cannon for milestone celebrations
 */

var confettiNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // 🎨 Confetti colors - bright and celebratory!
  var colors = [
    '#ff0000',
    '#ff7700',
    '#ffdd00',
    '#00ff00',
    '#00ddff',
    '#0077ff',
    '#7700ff',
    '#ff00ff',
    '#ff0077',
    '#ffffff'
  ];

  // 🎯 Milestone times in seconds
  var milestones = [60, 300, 600, 1800, 3600]; // 1min, 5min, 10min, 30min, 1hr
  var celebratedMilestones = {};

  /**
   * Create a single confetti piece
   * @param {number} x - Starting X position
   * @param {number} y - Starting Y position
   * @returns {HTMLElement} The confetti element
   */
  function createPiece(x, y) {
    var piece = document.createElement('div');
    piece.className = 'awesome-confetti';

    // Random properties
    var color = colors[Math.floor(Math.random() * colors.length)];
    var size = 8 + Math.random() * 8;
    var rotation = Math.random() * 360;
    var velocityX = (Math.random() - 0.5) * 20;
    var velocityY = -10 - Math.random() * 15;
    var rotationSpeed = (Math.random() - 0.5) * 720;
    var shape = Math.random() > 0.5 ? '50%' : '0';

    piece.className = 'awesome-confetti';
    // Dynamic styles only (z-index comes from CSS)
    piece.style.width = size + 'px';
    piece.style.height = size + 'px';
    piece.style.background = color;
    piece.style.left = x + 'px';
    piece.style.top = y + 'px';
    piece.style.borderRadius = shape;
    piece.style.transform = 'rotate(' + rotation + 'deg)';

    document.body.appendChild(piece);

    // Animate with physics
    var startTime = Date.now();
    var gravity = 0.5;
    var currentX = x;
    var currentY = y;
    var currentVelocityY = velocityY;
    var currentRotation = rotation;

    function animate() {
      var elapsed = Date.now() - startTime;

      if (elapsed > 3000 || currentY > window.innerHeight) {
        if (piece.parentNode) {
          piece.parentNode.removeChild(piece);
        }
        return;
      }

      currentX += velocityX * 0.3;
      currentVelocityY += gravity;
      currentY += currentVelocityY;
      currentRotation += rotationSpeed * 0.02;

      // Add some wobble
      var wobble = Math.sin(elapsed * 0.01) * 2;

      piece.style.left = currentX + wobble + 'px';
      piece.style.top = currentY + 'px';
      piece.style.transform = 'rotate(' + currentRotation + 'deg)';
      piece.style.opacity = Math.max(0, 1 - elapsed / 3000);

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    return piece;
  }

  /**
   * Fire confetti from a point
   * @param {Object} options - Configuration options
   * @param {number} [options.x] - X position (default: center)
   * @param {number} [options.y] - Y position (default: bottom)
   * @param {number} [options.count] - Number of pieces (default: 50)
   */
  namespace.burst = function (options) {
    options = options || {};
    var x = options.x !== undefined ? options.x : window.innerWidth / 2;
    var y = options.y !== undefined ? options.y : window.innerHeight;
    var count = options.count || 50;

    for (var i = 0; i < count; i++) {
      // Stagger the creation slightly for a more natural effect
      setTimeout(function () {
        createPiece(x + (Math.random() - 0.5) * 100, y);
      }, i * 10);
    }
  };

  /**
   * Fire confetti from both sides
   * @param {number} [count] - Number of pieces per side
   */
  namespace.sides = function (count) {
    count = count || 30;
    namespace.burst({ x: 0, y: window.innerHeight * 0.7, count: count });
    namespace.burst({ x: window.innerWidth, y: window.innerHeight * 0.7, count: count });
  };

  /**
   * Celebrate a milestone with a big confetti show
   * @param {number} seconds - The milestone reached
   */
  namespace.celebrate = function (seconds) {
    var minutes = Math.floor(seconds / 60);
    var label = minutes >= 60 ? Math.floor(minutes / 60) + ' HOUR' : minutes + ' MIN';

    // Big burst from center bottom
    namespace.burst({ count: 100 });

    // Side bursts
    setTimeout(function () {
      namespace.sides(50);
    }, 200);

    // Show milestone text
    var text = document.createElement('div');
    text.className = 'awesome-milestone';
    text.innerHTML = '🎉 ' + label + ' OF AWESOME! 🎉';

    // Check if mobile viewport
    var isMobile = window.innerWidth <= 480;
    var fontSize = isMobile ? 'clamp(1.2em, 6vw, 2em)' : '3em';

    text.style.cssText = [
      'position: fixed',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%) scale(0)',
      'font-size: ' + fontSize,
      'font-weight: bold',
      'color: #fff',
      'text-shadow: 0 0 20px #ff00ff, 0 0 40px #00ffff, 2px 2px 0 #000',
      'font-family: "Comic Sans MS", cursive, sans-serif',
      'z-index: 99999',
      'pointer-events: none',
      'text-align: center',
      'width: 90%',
      'max-width: 600px',
      'box-sizing: border-box',
      'padding: 0 10px'
    ].join(';');
    document.body.appendChild(text);

    // Animate in
    setTimeout(function () {
      text.style.transition = 'transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
      text.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 50);

    // Animate out
    setTimeout(function () {
      text.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-out';
      text.style.transform = 'translate(-50%, -50%) scale(1.5)';
      text.style.opacity = '0';
      setTimeout(function () {
        if (text.parentNode) {
          text.parentNode.removeChild(text);
        }
      }, 300);
    }, 2000);
  };

  /**
   * Check if a milestone was reached
   * @param {number} seconds - Current awesome duration
   */
  namespace.checkMilestone = function (seconds) {
    for (var i = 0; i < milestones.length; i++) {
      var milestone = milestones[i];
      if (seconds >= milestone && !celebratedMilestones[milestone]) {
        celebratedMilestones[milestone] = true;
        namespace.celebrate(milestone);
        break;
      }
    }
  };

  /**
   * Reset milestone tracking
   */
  namespace.reset = function () {
    celebratedMilestones = {};
  };

  /**
   * Rain confetti from the top
   * @param {number} [duration] - Duration in ms (default: 3000)
   */
  namespace.rain = function (duration) {
    duration = duration || 3000;
    var startTime = Date.now();

    function spawnPiece() {
      if (Date.now() - startTime > duration) return;

      var x = Math.random() * window.innerWidth;
      createPiece(x, -20);

      setTimeout(spawnPiece, 50);
    }

    spawnPiece();
  };

  return namespace;
})();

// 🌍 Expose globally
window.confettiNamespace = confettiNamespace;
window.awesomeConfettiNamespace = confettiNamespace;
