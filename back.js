// Back to Portfolio Navigation Component
// Include this script on project pages to add a "Back to Portfolio" button

(function () {
  'use strict';

  // Only run once
  if (window.backButtonInitialized) return;
  window.backButtonInitialized = true;

  // Don't show on the home page or inside the OS (iframe)
  if (window.location.pathname === '/os/' || window.location.pathname === '/os/index.html') {
    return;
  }
  if (window.self !== window.top) {
    return;
  }

  // Don't show inside an installed PWA — the back-to-portfolio link
  // is cross-app navigation and would dump the user out of their
  // standalone music app into Safari/Chrome. The in-app router (the
  // "Instruments" link inside /play/) stays.
  //
  // Detection covers: modern iOS / Android Chrome (display-mode media
  // query), legacy iOS Safari (`navigator.standalone`), and Android
  // TWA / Trusted Web Activity. We also tag <html> with a `standalone`
  // class so CSS can hide other in-page chrome (like the gallery
  // footer's "Back home" link) without re-implementing this detection.
  const isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://');
  if (isStandalone) {
    document.documentElement.classList.add('pwa-standalone');
    return;
  }

  // Propagate data-back-size from the <script> tag to <html> for CSS selectors
  const selfScript = document.currentScript;
  const backSize = selfScript && selfScript.getAttribute('data-back-size');
  if (backSize) {
    document.documentElement.setAttribute('data-back-size', backSize);
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
  //
  // The back button is the one piece of brand chrome that every
  // standalone app on the site inherits. After the Heyming OS brand
  // pass it switched from a two-stop violet gradient to a flat
  // accent-primary-bg fill — solid violet that clears WCAG AA with
  // white text (~6.7:1). Geometry is preserved exactly so the
  // tests/e2e/back-button-overlap spec still passes.
  //
  // var() with hex fallbacks means the button still looks like the
  // brand on pages that haven't loaded /brand.css yet.
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
      background: var(--accent-primary-bg, #5b3cdc);
      color: var(--text-on-accent, #fff);
      text-decoration: none;
      border-radius: 12px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.005em;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: background var(--motion-hover, 150ms ease),
                  transform var(--motion-hover, 150ms ease),
                  box-shadow var(--motion-hover, 150ms ease);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .back-to-portfolio:hover {
      transform: translateX(-4px) translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      background: var(--accent-primary-bg-hover, #6e50e6);
    }

    .back-to-portfolio:active {
      transform: translateX(-2px) translateY(-1px);
    }

    .back-to-portfolio:focus-visible {
      outline: 2px solid var(--focus-ring-inner, #7c5cff);
      outline-offset: 3px;
      box-shadow: 0 0 0 5px var(--focus-ring-outer, rgba(255, 255, 255, 0.65)),
                  0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .back-arrow {
      font-size: 18px;
      display: inline-block;
      transition: transform var(--motion-hover, 150ms ease);
    }

    .back-to-portfolio:hover .back-arrow {
      transform: translateX(-4px);
    }

    .back-text {
      letter-spacing: 0.5px;
    }

    /* Compact mode — pages opt in with <script src="/back.js" data-back-size="compact"> */
    html[data-back-size="compact"] .back-to-portfolio {
      top: 10px;
      left: 10px;
      padding: 6px 12px;
      font-size: 11px;
      border-radius: 8px;
      opacity: 0.6;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    html[data-back-size="compact"] .back-to-portfolio:hover {
      opacity: 1;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }

    html[data-back-size="compact"] .back-arrow {
      font-size: 13px;
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

      html[data-back-size="compact"] .back-to-portfolio {
        top: 8px;
        left: 8px;
        padding: 5px 10px;
        font-size: 10px;
      }
    }

    /* Landscape phones — short heights collapse the button to icon-only
     * so it doesn't overlap content rows below a compressed header. */
    @media (max-height: 480px) {
      .back-to-portfolio {
        top: 8px;
        left: 8px;
        padding: 8px 10px;
        font-size: 13px;
        gap: 0;
      }

      .back-text {
        display: none;
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
