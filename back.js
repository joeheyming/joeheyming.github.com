// Back to Portfolio Navigation Component
// Include this script on project pages to add a "Back to Portfolio" button

(function () {
  'use strict';

  // Only run once
  if (window.backButtonInitialized) return;
  window.backButtonInitialized = true;

  // Don't show on the home page
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    return;
  }

  // Create the back button
  const backButton = document.createElement('a');
  backButton.href = '/';
  backButton.className = 'back-to-portfolio';
  backButton.setAttribute('data-event', 'back_to_home');
  backButton.setAttribute('data-event-category', 'Navigation');
  backButton.setAttribute('data-event-label', getPageName());
  backButton.innerHTML = `
    <span class="back-arrow">←</span>
    <span class="back-text">Back</span>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .back-to-portfolio {
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 999999;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.95), rgba(124, 58, 237, 0.95));
      color: white;
      text-decoration: none;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .back-to-portfolio:hover {
      transform: translateX(-4px) translateY(-2px);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.98), rgba(109, 40, 217, 0.98));
    }

    .back-to-portfolio:active {
      transform: translateX(-2px) translateY(-1px);
    }

    .back-arrow {
      font-size: 18px;
      display: inline-block;
      transition: transform 0.3s ease;
    }

    .back-to-portfolio:hover .back-arrow {
      transform: translateX(-4px);
    }

    .back-text {
      letter-spacing: 0.5px;
    }

    /* Mobile responsive */
    @media (max-width: 640px) {
      .back-to-portfolio {
        top: 12px;
        left: 12px;
        padding: 10px 16px;
        font-size: 13px;
      }

      .back-arrow {
        font-size: 16px;
      }
    }

    /* Print - hide button */
    @media print {
      .back-to-portfolio {
        display: none !important;
      }
    }
  `;

  // Helper to get page name
  function getPageName() {
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    if (segments.length === 0) return 'Home';
    const name = segments[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  // Insert when DOM is ready
  function insertButton() {
    document.head.appendChild(style);
    document.body.appendChild(backButton);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertButton);
  } else {
    insertButton();
  }
})();
