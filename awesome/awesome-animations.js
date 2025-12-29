// 🎬 ANIMATIONS MODULE 🎬
// Shared awesome animations for all visual elements!

/**
 * @fileoverview Shared animation library for awesome elements
 */

var animationsNamespace = (function () {
  'use strict';

  var namespace = {};

  // 🎨 All awesome animation types!
  var animationTypes = [
    'spin', // 🔄 Rotate 360
    'slide-up', // ⬆️ Slide up
    'slide-down', // ⬇️ Slide down
    'slide-left', // ⬅️ Slide left
    'slide-right', // ➡️ Slide right
    'diagonal-up-left', // ↖️ Diagonal
    'diagonal-up-right', // ↗️ Diagonal
    'diagonal-down-left', // ↙️ Diagonal
    'diagonal-down-right', // ↘️ Diagonal
    'scale', // 📏 Scale up
    'bounce', // 🏀 Bounce effect
    'flip', // 🔃 Flip
    'w-motion', // 〰️ W zig-zag pattern
    'z-motion', // ⚡ Z zig-zag pattern
    'spiral', // 🌀 Spiral outward
    'shake' // 📳 Shake effect
  ];

  // 🎲 Get a random animation type
  namespace.getRandomType = function () {
    return animationTypes[Math.floor(Math.random() * animationTypes.length)];
  };

  // 🎬 Apply an animation to an element!
  namespace.apply = function (element, animationType, options) {
    options = options || {};
    var duration = options.duration || 2000;
    var delay = options.delay || 0;

    setTimeout(function () {
      element.style.transition = 'transform ' + duration / 1000 + 's ease-out';

      switch (animationType) {
        case 'spin':
          element.style.transform = 'rotate(360deg)';
          break;

        case 'slide-up':
          element.style.transform = 'translateY(-100vh)';
          break;

        case 'slide-down':
          element.style.transform = 'translateY(100vh)';
          break;

        case 'slide-left':
          element.style.transform = 'translateX(-100vw)';
          break;

        case 'slide-right':
          element.style.transform = 'translateX(100vw)';
          break;

        case 'diagonal-up-left':
          element.style.transform = 'translate(-50vw, -50vh)';
          break;

        case 'diagonal-up-right':
          element.style.transform = 'translate(50vw, -50vh)';
          break;

        case 'diagonal-down-left':
          element.style.transform = 'translate(-50vw, 50vh)';
          break;

        case 'diagonal-down-right':
          element.style.transform = 'translate(50vw, 50vh)';
          break;

        case 'scale':
          element.style.transform = 'scale(2)';
          break;

        case 'bounce':
          element.style.transition = 'transform 0.3s ease-out';
          element.style.transform = 'translateY(-50px) scale(1.2)';
          setTimeout(function () {
            element.style.transform = 'translateY(0) scale(1)';
          }, 300);
          setTimeout(function () {
            element.style.transform = 'translateY(-30px) scale(1.1)';
          }, 600);
          setTimeout(function () {
            element.style.transform = 'translateY(0) scale(1)';
          }, 900);
          break;

        case 'flip':
          element.style.transform = 'rotateY(180deg) scale(1.1)';
          break;

        case 'w-motion':
          element.style.transition = 'transform 0.4s ease-in-out';
          element.style.transform = 'translate(50px, 50px)';
          setTimeout(function () {
            element.style.transform = 'translate(100px, -30px)';
          }, 400);
          setTimeout(function () {
            element.style.transform = 'translate(150px, 50px)';
          }, 800);
          setTimeout(function () {
            element.style.transform = 'translate(200px, -30px)';
          }, 1200);
          setTimeout(function () {
            element.style.transform = 'translate(250px, 50px)';
          }, 1600);
          break;

        case 'z-motion':
          element.style.transition = 'transform 0.5s ease-in-out';
          element.style.transform = 'translateX(100px)';
          setTimeout(function () {
            element.style.transform = 'translate(-50px, 80px)';
          }, 500);
          setTimeout(function () {
            element.style.transform = 'translate(100px, 80px)';
          }, 1000);
          setTimeout(function () {
            element.style.transform = 'translate(150px, 160px)';
          }, 1500);
          break;

        case 'spiral':
          element.style.transition = 'transform 0.3s ease-out';
          var angle = 0;
          var radius = 0;
          var spiralInterval = setInterval(function () {
            angle += 30;
            radius += 10;
            var x = Math.cos((angle * Math.PI) / 180) * radius;
            var y = Math.sin((angle * Math.PI) / 180) * radius;
            element.style.transform =
              'translate(' + x + 'px, ' + y + 'px) rotate(' + angle + 'deg)';
            if (radius > 200) {
              clearInterval(spiralInterval);
            }
          }, 100);
          break;

        case 'shake':
          element.style.transition = 'transform 0.1s ease-in-out';
          var shakeCount = 0;
          var shakeInterval = setInterval(function () {
            var x = (Math.random() - 0.5) * 20;
            var y = (Math.random() - 0.5) * 20;
            var rot = (Math.random() - 0.5) * 10;
            element.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rot + 'deg)';
            shakeCount++;
            if (shakeCount > 20) {
              clearInterval(shakeInterval);
              element.style.transform = 'translate(0, 0) rotate(0)';
            }
          }, 50);
          break;
      }
    }, delay);
  };

  // 🎲 Apply a random animation to an element!
  namespace.applyRandom = function (element, options) {
    var type = namespace.getRandomType();
    namespace.apply(element, type, options);
    return type;
  };

  // 📋 Get all animation types
  namespace.types = function () {
    return animationTypes.slice();
  };

  // 🔢 How many animation types?
  namespace.count = function () {
    return animationTypes.length;
  };

  // 🤘 Return the namespace!
  return namespace;
})();

// 🌍 Expose globally
window.animationsNamespace = animationsNamespace;
window.animations = animationsNamespace; // Alias for easy access
