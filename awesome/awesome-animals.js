// 🐾 ANIMALS MODULE 🐾
// Random cats, dogs, foxes, bunnies, bears, and more!
// Self-contained: add new animals here only - no other files needed!

/**
 * @fileoverview Self-registering animal module
 * @requires awesome-config.js
 * @requires awesome-animations.js
 */

var animalsNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // ═══════════════════════════════════════════════════════════════════
  // 🐾 ANIMAL REGISTRY - Add new animals here! Just add an entry below.
  // ═══════════════════════════════════════════════════════════════════
  var animalRegistry = {
    // 🐱 Cats
    cat: {
      emoji: '🐱',
      type: 'image-direct', // Image URL returned directly (with cache bust)
      url: 'https://cataas.com/cat',
      cacheBust: true
    },
    catApi: {
      emoji: '🐱',
      type: 'json',
      url: 'https://api.thecatapi.com/v1/images/search',
      parser: function (data) {
        return data[0] && data[0].url;
      }
    },

    // 🐕 Dogs
    dog: {
      emoji: '🐕',
      type: 'json',
      url: 'https://dog.ceo/api/breeds/image/random',
      parser: function (data) {
        return data.message;
      }
    },
    dogApi: {
      emoji: '🐕',
      type: 'json',
      url: 'https://api.thedogapi.com/v1/images/search',
      parser: function (data) {
        return data[0] && data[0].url;
      }
    },

    // 🦊 Fox
    fox: {
      emoji: '🦊',
      type: 'json',
      url: 'https://randomfox.ca/floof/',
      parser: function (data) {
        return data.image;
      }
    },

    // 🐰 Bunny
    bunny: {
      emoji: '🐰',
      type: 'json',
      url: 'https://api.bunnies.io/v2/loop/random/?media=gif',
      parser: function (data) {
        return data.media && data.media.gif;
      }
    },

    // 🐻 Placeholder Bear
    placeBear: {
      emoji: '🐻',
      type: 'image-direct',
      url: 'https://placebear.com/',
      urlGenerator: function () {
        var size = 150 + Math.floor(Math.random() * 100);
        return 'https://placebear.com/' + size + '/' + size + '?' + Date.now();
      }
    },

    // 😺 HTTP Status Cats
    httpCat: {
      emoji: '😺',
      type: 'image-direct',
      url: 'https://http.cat/',
      urlGenerator: function () {
        var statuses = [100, 200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503];
        var status = statuses[Math.floor(Math.random() * statuses.length)];
        return 'https://http.cat/' + status + '.jpg';
      }
    },

    // 📝 Cat Facts
    catFact: {
      emoji: '🐱',
      type: 'fact',
      url: 'https://meowfacts.herokuapp.com/',
      parser: function (data) {
        return data.data && data.data[0];
      }
    },

    // 📝 Dog Facts
    dogFact: {
      emoji: '🐕',
      type: 'fact',
      url: 'https://dogapi.dog/api/v2/facts?limit=1',
      parser: function (data) {
        return data.data && data.data[0] && data.data[0].attributes.body;
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 🎨 Display Functions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Show an animal image with awesome transitions
   * @param {string} imageUrl - URL of the image to display
   * @returns {HTMLElement} The image element
   */
  function showImage(imageUrl) {
    // Size from CSS variable (default 150px)
    var sizeNum = 150;

    var img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Random Animal';
    img.className = 'random-animal';
    // Dynamic position only (size/shadow come from CSS)
    img.style.top = Math.random() * (window.innerHeight - sizeNum) + 'px';
    img.style.left = Math.random() * (window.innerWidth - sizeNum) + 'px';
    document.body.appendChild(img);

    // Fade in
    setTimeout(function () {
      img.style.transition = 'opacity 0.5s ease-out';
      img.style.opacity = '1';
    }, 100);

    // Apply animation
    if (typeof animationsNamespace !== 'undefined') {
      animationsNamespace.applyRandom(img, { delay: 1000, duration: 2000 });
    }

    // Fade out after 5 seconds
    var duration = (config.durations && config.durations.animal) || 5000;
    setTimeout(function () {
      img.style.transition = 'opacity 0.5s ease-out';
      img.style.opacity = '0';
      setTimeout(function () {
        if (img.parentNode) {
          img.parentNode.removeChild(img);
        }
      }, 500);
    }, duration);

    return img;
  }

  /**
   * Show a fact bubble
   * @param {string} text - The fact text
   * @param {string} [emoji='🐾'] - Emoji prefix
   */
  function showFact(text, emoji) {
    emoji = emoji || '🐾';
    var factDiv = document.createElement('div');
    factDiv.textContent = emoji + ' ' + text;
    factDiv.className = 'animal-fact';
    // Dynamic position only (styles come from CSS)
    factDiv.style.left = Math.random() * (window.innerWidth - 300) + 'px';
    factDiv.style.top = Math.random() * (window.innerHeight - 100) + 'px';
    document.body.appendChild(factDiv);

    setTimeout(function () {
      factDiv.style.opacity = '1';
    }, 100);

    var duration = (config.durations && config.durations.catFact) || 5000;
    setTimeout(function () {
      factDiv.style.opacity = '0';
      setTimeout(function () {
        if (factDiv.parentNode) {
          factDiv.parentNode.removeChild(factDiv);
        }
      }, 500);
    }, duration);

    return factDiv;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🚀 Generic Spawn Function
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Spawn an animal by name
   * @param {string} name - Animal name from registry
   */
  function spawnAnimal(name) {
    var animal = animalRegistry[name];
    if (!animal) {
      console.error('🐾 Unknown animal:', name);
      return;
    }

    // Handle direct image URLs
    if (animal.type === 'image-direct') {
      var url = animal.urlGenerator ? animal.urlGenerator() : animal.url;
      if (animal.cacheBust && !animal.urlGenerator) {
        url += '?' + Date.now();
      }
      showImage(url);
      return;
    }

    // Handle JSON APIs
    fetch(animal.url)
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        var result = animal.parser(data);
        if (!result) {
          console.error(animal.emoji + ' No data from:', name);
          return;
        }

        if (animal.type === 'fact') {
          showFact(result, animal.emoji);
        } else {
          showImage(result);
        }
      })
      .catch(function (error) {
        console.error(animal.emoji + ' Error fetching ' + name + ':', error);
      });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 📦 Public API - Auto-generated from registry
  // ═══════════════════════════════════════════════════════════════════

  // Create a function for each registered animal
  Object.keys(animalRegistry).forEach(function (name) {
    namespace[name] = function () {
      spawnAnimal(name);
    };
  });

  /**
   * Spawn a random animal
   */
  namespace.random = function () {
    var names = Object.keys(animalRegistry);
    var name = names[Math.floor(Math.random() * names.length)];
    spawnAnimal(name);
  };

  /**
   * Get list of all available animal types
   * @returns {Array<string>} List of animal type names
   */
  namespace.types = function () {
    return Object.keys(animalRegistry);
  };

  /**
   * Get the registry (for spawn module integration)
   * @returns {Object} The animal registry
   */
  namespace.getRegistry = function () {
    return animalRegistry;
  };

  /**
   * Register a new animal type dynamically
   * @param {string} name - Animal name
   * @param {Object} config - Animal configuration
   */
  namespace.register = function (name, animalConfig) {
    animalRegistry[name] = animalConfig;
    namespace[name] = function () {
      spawnAnimal(name);
    };
  };

  return namespace;
})();

// 🌍 Expose globally
window.animalsNamespace = animalsNamespace;
window.awesomeAnimalsNamespace = animalsNamespace; // Alias for consistency
