// 🥰 AWW MODULE 🥰
// Fetches adorable images from Reddit r/aww
// Self-contained: integrates with spawn system automatically

/**
 * @fileoverview Reddit r/aww image fetcher
 * @requires awesome-config.js
 * @requires awesome-animations.js
 */

var awwNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // Reddit API endpoint for r/aww top posts this week
  var REDDIT_API = 'https://www.reddit.com/r/aww/top.json?t=week&limit=100';

  // Cache for fetched posts
  var cachedPosts = [];
  var lastFetch = 0;
  var CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // ═══════════════════════════════════════════════════════════════════
  // 🔄 Data Fetching
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Fetch top posts from r/aww
   * @returns {Promise<Array>} Array of image posts
   */
  function fetchPosts() {
    var now = Date.now();

    // Return cached if fresh
    if (cachedPosts.length > 0 && now - lastFetch < CACHE_DURATION) {
      return Promise.resolve(cachedPosts);
    }

    return fetch(REDDIT_API)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Reddit API error: ' + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        // Filter to only image posts
        var posts = data.data.children
          .map(function (child) {
            return child.data;
          })
          .filter(function (post) {
            // Only keep direct image links
            var url = post.url || '';
            return (
              !post.is_video &&
              !post.is_self &&
              (url.match(/\.(jpg|jpeg|png|gif)$/i) ||
                url.includes('i.redd.it') ||
                url.includes('i.imgur.com'))
            );
          })
          .map(function (post) {
            return {
              url: getDirectImageUrl(post.url),
              title: post.title,
              author: post.author,
              score: post.score,
              permalink: 'https://reddit.com' + post.permalink
            };
          });

        cachedPosts = posts;
        lastFetch = now;
        console.log('🥰 Loaded ' + posts.length + ' aww images from Reddit');
        return posts;
      })
      .catch(function (error) {
        console.error('🥰 Error fetching r/aww:', error);
        return cachedPosts; // Return stale cache on error
      });
  }

  /**
   * Get direct image URL (handle imgur links)
   * @param {string} url - Original URL
   * @returns {string} Direct image URL
   */
  function getDirectImageUrl(url) {
    // Convert imgur page links to direct image links
    if (url.includes('imgur.com') && !url.includes('i.imgur.com')) {
      // Extract image ID and make direct link
      var match = url.match(/imgur\.com\/(\w+)/);
      if (match) {
        return 'https://i.imgur.com/' + match[1] + '.jpg';
      }
    }
    return url;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🎨 Display Functions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Show an aww image with title overlay
   * @param {Object} post - Reddit post object
   */
  function showImage(post) {
    var container = document.createElement('div');
    container.className = 'aww-container';
    container.style.cssText =
      'position: fixed; pointer-events: none; z-index: 9996; ' +
      'max-width: 200px; border-radius: 12px; overflow: hidden; ' +
      'box-shadow: 0 8px 32px rgba(0,0,0,0.3); opacity: 0; ' +
      'background: #1a1a2e; transition: opacity 0.5s ease-out;';

    // Random position
    var maxX = window.innerWidth - 220;
    var maxY = window.innerHeight - 280;
    container.style.left = Math.max(20, Math.random() * maxX) + 'px';
    container.style.top = Math.max(20, Math.random() * maxY) + 'px';

    // Image
    var img = document.createElement('img');
    img.src = post.url;
    img.alt = post.title;
    img.style.cssText =
      'width: 100%; height: auto; max-height: 180px; ' + 'object-fit: cover; display: block;';
    img.onerror = function () {
      // Remove container if image fails to load
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
    container.appendChild(img);

    // Title overlay
    var titleOverlay = document.createElement('div');
    titleOverlay.className = 'aww-title';
    titleOverlay.style.cssText =
      'padding: 10px 12px; background: linear-gradient(135deg, #ff6b6b, #ff8e53); ' +
      'color: #fff; font-size: 11px; font-weight: bold; ' +
      'line-height: 1.3; max-height: 50px; overflow: hidden; ' +
      'text-overflow: ellipsis; font-family: system-ui, sans-serif;';
    titleOverlay.textContent = '🥰 ' + truncateTitle(post.title, 60);
    container.appendChild(titleOverlay);

    // Source badge
    var badge = document.createElement('div');
    badge.style.cssText =
      'position: absolute; top: 8px; right: 8px; ' +
      'background: rgba(255,107,0,0.9); color: #fff; ' +
      'font-size: 9px; padding: 3px 6px; border-radius: 4px; ' +
      'font-family: system-ui, sans-serif; font-weight: bold;';
    badge.textContent = 'r/aww';
    container.appendChild(badge);

    document.body.appendChild(container);

    // Fade in
    setTimeout(function () {
      container.style.opacity = '1';
    }, 50);

    // Apply animation if available
    if (typeof animationsNamespace !== 'undefined') {
      animationsNamespace.applyRandom(container, { delay: 500, duration: 2000 });
    }

    // Fade out and remove
    var duration = (config.durations && config.durations.aww) || 6000;
    setTimeout(function () {
      container.style.opacity = '0';
      setTimeout(function () {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      }, 500);
    }, duration);
  }

  /**
   * Truncate title to max length
   * @param {string} title - Original title
   * @param {number} maxLength - Max characters
   * @returns {string} Truncated title
   */
  function truncateTitle(title, maxLength) {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength - 3) + '...';
  }

  // ═══════════════════════════════════════════════════════════════════
  // 📦 Public API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Spawn a random aww image
   */
  namespace.spawn = function () {
    fetchPosts().then(function (posts) {
      if (posts.length === 0) {
        console.warn('🥰 No aww images available');
        return;
      }
      var post = posts[Math.floor(Math.random() * posts.length)];
      showImage(post);
    });
  };

  /**
   * Prefetch posts (call on page load for faster first spawn)
   */
  namespace.prefetch = function () {
    fetchPosts();
  };

  /**
   * Get cached post count
   * @returns {number} Number of cached posts
   */
  namespace.getCacheSize = function () {
    return cachedPosts.length;
  };

  /**
   * Clear the cache
   */
  namespace.clearCache = function () {
    cachedPosts = [];
    lastFetch = 0;
  };

  // Auto-register with spawn system if available
  if (typeof window.spawnRegistry !== 'undefined') {
    window.spawnRegistry.aww = {
      emoji: '🥰',
      spawn: namespace.spawn,
      weight: 2 // Higher weight = more likely to spawn
    };
  }

  // Prefetch on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', namespace.prefetch);
  } else {
    namespace.prefetch();
  }

  return namespace;
})();

// 🌍 Expose globally
window.awwNamespace = awwNamespace;
