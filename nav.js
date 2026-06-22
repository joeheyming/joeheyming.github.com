// Site-wide navigation: hamburger toggle + left-rail app drawer.
//
// Replaces the original /back.js "Back to portfolio" button. Every
// public page that's not the home gallery, /os/, or a redirect stub
// loads this script in <head>; the toggle injects itself top-left and
// opens a drawer populated from /apps-registry.json.
//
// Behavior:
//   • Skipped on /os/ (the OS shell renders its own taskbar/launcher).
//   • Skipped inside an iframe (so OS windows don't double up).
//   • Skipped in standalone PWAs (cross-app nav would dump users out
//     of their installed app into a browser tab).
//   • <script src="/nav.js" data-nav-size="compact"> opts the host page
//     into a smaller, dimmer toggle for dense app chrome (terminal,
//     paint, doom, …). The attribute is mirrored onto <html> so CSS
//     can hook into it.

(function () {
  'use strict';

  if (window.heymingNavInitialized) return;
  window.heymingNavInitialized = true;

  if (window.location.pathname === '/os/' || window.location.pathname === '/os/index.html') {
    return;
  }
  if (window.self !== window.top) {
    return;
  }

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

  const selfScript = document.currentScript;
  const backSize = selfScript && selfScript.getAttribute('data-nav-size');
  if (backSize) {
    document.documentElement.setAttribute('data-nav-size', backSize);
  }

  // Section grouping for the drawer. Order = render order in the rail.
  // Anything in apps-registry.json with a category outside this list
  // falls through to "More" so we never silently drop apps.
  const SECTION_DEFS = [
    { id: 'utility', label: 'Utilities', categories: ['utility'] },
    { id: 'game', label: 'Games', categories: ['game'] },
    { id: 'entertainment', label: 'Entertainment', categories: ['entertainment'] }
  ];

  function getCurrentProject() {
    const path = window.location.pathname;
    const segments = path.split('/').filter((s) => s);
    return segments[0] || null;
  }

  function getPageName() {
    const id = getCurrentProject();
    if (!id) return 'Home';
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // ─── Toggle button ───────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'heyming-nav-toggle';
  toggle.setAttribute('aria-label', 'Open navigation menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'heyming-nav-drawer');
  toggle.setAttribute('data-event', 'nav_drawer_open');
  toggle.setAttribute('data-event-category', 'Navigation');
  toggle.setAttribute('data-event-label', getPageName());
  toggle.innerHTML = `
    <span class="heyming-nav-toggle-icon" aria-hidden="true">
      <span class="heyming-nav-bar"></span>
      <span class="heyming-nav-bar"></span>
      <span class="heyming-nav-bar"></span>
    </span>
    <span class="heyming-nav-toggle-label">Menu</span>
  `;

  // ─── Backdrop + drawer skeleton (populated after registry loads) ─────
  const backdrop = document.createElement('div');
  backdrop.className = 'heyming-nav-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const drawer = document.createElement('aside');
  drawer.className = 'heyming-nav-drawer';
  drawer.id = 'heyming-nav-drawer';
  drawer.setAttribute('role', 'navigation');
  drawer.setAttribute('aria-label', 'Site apps');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <header class="heyming-nav-drawer-header">
      <a href="/" class="heyming-nav-brand"
         data-event="nav_brand_home"
         data-event-category="Navigation">
        <span class="heyming-nav-brand-icon" aria-hidden="true">🚀</span>
        <span class="heyming-nav-brand-text">Heyming OS</span>
      </a>
      <button type="button" class="heyming-nav-close"
              aria-label="Close navigation menu">×</button>
    </header>
    <div class="heyming-nav-search">
      <input type="search"
             class="heyming-nav-search-input"
             placeholder="Filter apps…"
             aria-label="Filter apps"
             autocomplete="off"
             autocapitalize="off"
             spellcheck="false" />
    </div>
    <nav class="heyming-nav-list" aria-label="Apps">
      <div class="heyming-nav-system">
        <a href="/" class="heyming-nav-item"
           data-event="nav_home"
           data-event-category="Navigation">
          <span class="heyming-nav-item-icon" aria-hidden="true">🏠</span>
          <span class="heyming-nav-item-label">Home</span>
        </a>
        <a href="/os/" class="heyming-nav-item"
           data-event="nav_os"
           data-event-category="Navigation">
          <span class="heyming-nav-item-icon" aria-hidden="true">🖥️</span>
          <span class="heyming-nav-item-label">Heyming OS</span>
        </a>
      </div>
      <div class="heyming-nav-sections" aria-busy="true">
        <div class="heyming-nav-skeleton">Loading apps…</div>
      </div>
    </nav>
    <footer class="heyming-nav-drawer-footer">
      <a href="/about/" class="heyming-nav-footer-link">About →</a>
    </footer>
  `;

  // ─── Styles ──────────────────────────────────────────────────────────
  // Brand tokens are routed through local --hn-* variables with both
  // light fallbacks (default) and dark fallbacks (under
  // @media (prefers-color-scheme: dark)). When /brand.css is loaded its
  // tokens win — the brand layer already handles light vs dark via its
  // own theme machinery. When brand.css is missing (e.g. /meme/, which
  // declares its own bespoke :root), the OS color preference picks the
  // right fallback so the drawer still looks native on dark-mode pages
  // instead of flashing a white panel. Dark hex values mirror the
  // :root[data-theme="dark"] block in brand.css.
  //
  // Z-index plan:
  //   backdrop  999997
  //   drawer    999998
  //   toggle    999999 — hidden via the [hidden] attribute while the
  //                      drawer is open so the hamburger doesn't punch
  //                      through the drawer header.
  const style = document.createElement('style');
  style.textContent = `
    /* Local theme tokens. Each --hn-* prefers the matching brand token
     * when present; the inline hex is the offline fallback. The dark
     * media query below replaces only the fallbacks. */
    .heyming-nav-toggle,
    .heyming-nav-backdrop,
    .heyming-nav-drawer {
      --hn-surface: var(--surface-1, #ffffff);
      --hn-surface-soft: var(--surface-2, #f0eee8);
      --hn-fg: var(--text-1, #1a1a1a);
      --hn-fg-mute: var(--text-2, #555555);
      --hn-fg-faint: var(--text-3, #6e6e6e);
      --hn-line: var(--hairline, #e5e5e0);
      --hn-line-strong: var(--hairline-strong, #c8c8c0);
      --hn-accent: var(--accent-primary, #1a73e8);
      --hn-accent-hover: var(--accent-primary-hover, #1558b8);
      --hn-accent-soft: var(--accent-primary-soft, #e8f0fe);
      --hn-accent-bg: var(--accent-primary-bg, #1a73e8);
      --hn-accent-bg-hover: var(--accent-primary-bg-hover, #1558b8);
      --hn-on-accent: var(--text-on-accent, #ffffff);
      --hn-scrim: var(--scrim, rgba(0, 0, 0, 0.5));
      --hn-shadow-soft: var(--shadow-soft, 0 1px 2px rgba(0, 0, 0, 0.06));
      --hn-shadow-modal: var(--shadow-modal, 0 4px 16px rgba(0, 0, 0, 0.12));
      --hn-focus-inner: var(--focus-ring-inner, #1a73e8);
      --hn-focus-outer: var(--focus-ring-outer, rgba(26, 115, 232, 0.2));
    }

    @media (prefers-color-scheme: dark) {
      .heyming-nav-toggle,
      .heyming-nav-backdrop,
      .heyming-nav-drawer {
        --hn-surface: var(--surface-1, #161b22);
        --hn-surface-soft: var(--surface-2, #1f262f);
        --hn-fg: var(--text-1, #e6edf3);
        --hn-fg-mute: var(--text-2, #aab1b9);
        --hn-fg-faint: var(--text-3, #8b949e);
        --hn-line: var(--hairline, #2a3138);
        --hn-line-strong: var(--hairline-strong, #3a434b);
        --hn-accent: var(--accent-primary, #4f8cff);
        --hn-accent-hover: var(--accent-primary-hover, #75a5ff);
        --hn-accent-soft: var(--accent-primary-soft, #1a2740);
        --hn-accent-bg: var(--accent-primary-bg, #4f8cff);
        --hn-accent-bg-hover: var(--accent-primary-bg-hover, #75a5ff);
        --hn-scrim: var(--scrim, rgba(0, 0, 0, 0.65));
        --hn-shadow-soft: var(--shadow-soft, 0 1px 2px rgba(0, 0, 0, 0.4));
        --hn-shadow-modal: var(--shadow-modal, 0 4px 16px rgba(0, 0, 0, 0.65));
        --hn-focus-inner: var(--focus-ring-inner, #4f8cff);
        --hn-focus-outer: var(--focus-ring-outer, rgba(79, 140, 255, 0.32));
      }
    }

    .heyming-nav-toggle {
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 999999;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: var(--hn-accent-bg);
      color: var(--hn-on-accent);
      border: 1px solid var(--hn-accent-bg-hover);
      border-radius: var(--radius, 4px);
      font-family: var(--font-ui, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--hn-shadow-soft);
      transition: background var(--motion-hover, 150ms ease),
                  transform var(--motion-hover, 150ms ease),
                  box-shadow var(--motion-hover, 150ms ease);
    }

    /* Hide the hamburger while the drawer is open. Two selectors so we
     * stay correct whether the JS sets the [hidden] attribute, the
     * aria-expanded="true" state, or both — the drawer itself slides
     * over this same top-left position so any visible toggle is a bug. */
    .heyming-nav-toggle[hidden],
    .heyming-nav-toggle[aria-expanded='true'] {
      display: none !important;
    }

    .heyming-nav-toggle:hover {
      background: var(--hn-accent-bg-hover);
      transform: translateY(-1px);
      box-shadow: var(--hn-shadow-modal);
    }

    .heyming-nav-toggle:active {
      transform: translateY(0);
    }

    .heyming-nav-toggle:focus-visible {
      outline: 2px solid var(--hn-focus-inner);
      outline-offset: 3px;
      box-shadow: 0 0 0 5px var(--hn-focus-outer), var(--hn-shadow-soft);
    }

    .heyming-nav-toggle-icon {
      display: inline-flex;
      flex-direction: column;
      justify-content: space-between;
      width: 16px;
      height: 12px;
    }

    .heyming-nav-bar {
      display: block;
      width: 100%;
      height: 2px;
      background: currentColor;
      border-radius: 1px;
      transition: transform var(--motion-hover, 150ms ease),
                  opacity var(--motion-hover, 150ms ease);
    }

    .heyming-nav-toggle-label {
      letter-spacing: 0.5px;
    }

    /* Backdrop scrim */
    .heyming-nav-backdrop {
      position: fixed;
      inset: 0;
      background: var(--hn-scrim);
      z-index: 999997;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--motion-modal, 220ms ease);
    }

    .heyming-nav-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .heyming-nav-drawer {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 300px;
      max-width: 90vw;
      background: var(--hn-surface);
      border-right: 1px solid var(--hn-line-strong);
      box-shadow: var(--hn-shadow-modal);
      z-index: 999998;
      transform: translateX(-100%);
      transition: transform var(--motion-modal, 220ms ease);
      display: flex;
      flex-direction: column;
      font-family: var(--font-ui, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
      color: var(--hn-fg);
    }

    .heyming-nav-drawer.open {
      transform: translateX(0);
    }

    .heyming-nav-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--hn-line);
      flex-shrink: 0;
    }

    .heyming-nav-brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--hn-fg);
      font-family: var(--font-display, Georgia, 'Times New Roman', serif);
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.005em;
      padding: 4px 6px;
      margin: -4px -6px;
      border-radius: var(--radius, 4px);
      transition: background var(--motion-hover, 150ms ease);
    }

    .heyming-nav-brand:hover {
      background: var(--hn-accent-soft);
      color: var(--hn-accent-hover);
    }

    .heyming-nav-brand-icon {
      font-size: 22px;
      line-height: 1;
    }

    .heyming-nav-close {
      width: 32px;
      height: 32px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--hn-fg-mute);
      border-radius: var(--radius, 4px);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: background var(--motion-hover, 150ms ease),
                  color var(--motion-hover, 150ms ease);
    }

    .heyming-nav-close:hover {
      background: var(--hn-accent-soft);
      color: var(--hn-accent-hover);
    }

    .heyming-nav-close:focus-visible {
      outline: 2px solid var(--hn-focus-inner);
      outline-offset: 1px;
    }

    .heyming-nav-search {
      padding: 10px 12px;
      border-bottom: 1px solid var(--hn-line);
      flex-shrink: 0;
    }

    .heyming-nav-search-input {
      width: 100%;
      padding: 8px 10px;
      font-size: 14px;
      font-family: inherit;
      color: var(--hn-fg);
      background: var(--hn-surface-soft);
      border: 1px solid var(--hn-line);
      border-radius: var(--radius, 4px);
      transition: border-color var(--motion-hover, 150ms ease),
                  background var(--motion-hover, 150ms ease);
    }

    .heyming-nav-search-input::placeholder {
      color: var(--hn-fg-faint);
    }

    .heyming-nav-search-input:focus {
      outline: none;
      border-color: var(--hn-accent);
      background: var(--hn-surface);
      box-shadow: 0 0 0 3px var(--hn-focus-outer);
    }

    .heyming-nav-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 8px 12px;
    }

    .heyming-nav-section-label {
      padding: 12px 10px 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--hn-fg-faint);
    }

    .heyming-nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: var(--radius, 4px);
      text-decoration: none;
      color: var(--hn-fg);
      font-size: 14px;
      transition: background var(--motion-hover, 150ms ease),
                  color var(--motion-hover, 150ms ease),
                  transform var(--motion-hover, 150ms ease);
    }

    .heyming-nav-item:hover {
      background: var(--hn-accent-soft);
      color: var(--hn-accent-hover);
      transform: translateX(2px);
    }

    .heyming-nav-item:focus-visible {
      outline: 2px solid var(--hn-focus-inner);
      outline-offset: 1px;
    }

    .heyming-nav-item.is-active {
      background: var(--hn-accent-soft);
      color: var(--hn-accent-hover);
      font-weight: 600;
      border-left: 3px solid var(--hn-accent);
      padding-left: 7px;
    }

    .heyming-nav-item-icon {
      font-size: 20px;
      line-height: 1;
      flex-shrink: 0;
      width: 24px;
      text-align: center;
    }

    .heyming-nav-item-label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* "System" shortcuts (Home + OS desktop) are pinned above the app
     * sections under a single bottom divider so the pair reads as one
     * group rather than two stray rows. */
    .heyming-nav-system {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 4px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--hn-line);
    }

    .heyming-nav-skeleton,
    .heyming-nav-empty {
      padding: 12px 10px;
      font-size: 13px;
      color: var(--hn-fg-faint);
      text-align: center;
    }

    .heyming-nav-drawer-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--hn-line);
      text-align: center;
      flex-shrink: 0;
    }

    .heyming-nav-footer-link {
      font-size: 13px;
      color: var(--hn-accent);
      text-decoration: none;
      font-weight: 600;
    }

    .heyming-nav-footer-link:hover {
      text-decoration: underline;
      color: var(--hn-accent-hover);
    }

    /* Compact mode — pages opt in with <script data-nav-size="compact"> */
    html[data-nav-size="compact"] .heyming-nav-toggle {
      top: 10px;
      left: 10px;
      padding: 6px 10px;
      font-size: 11px;
      opacity: 0.65;
    }

    html[data-nav-size="compact"] .heyming-nav-toggle:hover {
      opacity: 1;
    }

    html[data-nav-size="compact"] .heyming-nav-toggle-icon {
      width: 12px;
      height: 9px;
    }

    /* Mobile responsive */
    @media (max-width: 640px) {
      .heyming-nav-toggle {
        top: 12px;
        left: 12px;
        padding: 9px 14px;
        font-size: 13px;
      }

      .heyming-nav-drawer {
        width: 88vw;
      }

      html[data-nav-size="compact"] .heyming-nav-toggle {
        top: 8px;
        left: 8px;
        padding: 5px 8px;
        font-size: 10px;
      }
    }

    /* Landscape phones — collapse toggle to icon-only so it doesn't
     * stomp content rows below a compressed header (matches the old
     * back button's @media (max-height: 480px) treatment). */
    @media (max-height: 480px) {
      .heyming-nav-toggle {
        top: 8px;
        left: 8px;
        padding: 8px 10px;
        gap: 0;
      }
      .heyming-nav-toggle-label {
        display: none;
      }
    }

    @media print {
      .heyming-nav-toggle,
      .heyming-nav-backdrop,
      .heyming-nav-drawer {
        display: none !important;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .heyming-nav-toggle,
      .heyming-nav-bar,
      .heyming-nav-backdrop,
      .heyming-nav-drawer,
      .heyming-nav-item {
        transition: none;
      }
    }
  `;

  // ─── Behavior ────────────────────────────────────────────────────────
  let isOpen = false;
  let lastFocus = null;

  function openDrawer() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
    // Hide the toggle while the drawer is open so the hamburger doesn't
    // visually punch through the drawer header. Close affordances are
    // the drawer's × button, the backdrop, and the Esc key.
    toggle.setAttribute('hidden', '');

    const searchInput = drawer.querySelector('.heyming-nav-search-input');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 80);
    }

    if (window.trackEvent) {
      window.trackEvent('nav_drawer_open', 'Navigation', getPageName());
    }
  }

  function closeDrawer() {
    if (!isOpen) return;
    isOpen = false;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.removeAttribute('hidden');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  backdrop.addEventListener('click', closeDrawer);

  drawer.querySelector('.heyming-nav-close').addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      closeDrawer();
    }
  });

  // ─── Registry load + drawer population ───────────────────────────────
  async function loadRegistry() {
    try {
      const res = await fetch('/apps-registry.json', { cache: 'default' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[nav.js] Could not load apps-registry.json', e);
      return [];
    }
  }

  function appHrefForRegistryEntry(app) {
    const path = app.path || '';
    if (path.startsWith('./')) return '/' + path.slice(2);
    return path || '/';
  }

  function isCurrentApp(app) {
    const current = getCurrentProject();
    if (!current) return false;
    return app.id === current;
  }

  function buildSection(label, apps) {
    if (!apps.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'heyming-nav-section';
    wrap.dataset.sectionLabel = label;

    const heading = document.createElement('div');
    heading.className = 'heyming-nav-section-label';
    heading.textContent = label;
    wrap.appendChild(heading);

    for (const app of apps) {
      const a = document.createElement('a');
      a.className = 'heyming-nav-item';
      a.href = appHrefForRegistryEntry(app);
      a.dataset.appId = app.id;
      a.dataset.search = (
        (app.shortName || app.name || '') +
        ' ' +
        (app.description || '') +
        ' ' +
        (Array.isArray(app.tags) ? app.tags.join(' ') : '')
      ).toLowerCase();
      a.setAttribute('data-event', 'nav_app_click');
      a.setAttribute('data-event-category', 'Navigation');
      a.setAttribute('data-event-label', app.id);
      if (isCurrentApp(app)) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
      a.innerHTML = `
        <span class="heyming-nav-item-icon">${app.icon || '📦'}</span>
        <span class="heyming-nav-item-label"></span>
      `;
      a.querySelector('.heyming-nav-item-label').textContent = app.shortName || app.name || app.id;
      wrap.appendChild(a);
    }

    return wrap;
  }

  function populateDrawer(registry) {
    const sectionsHost = drawer.querySelector('.heyming-nav-sections');
    if (!sectionsHost) return;
    sectionsHost.removeAttribute('aria-busy');
    sectionsHost.innerHTML = '';

    if (!registry.length) {
      const empty = document.createElement('div');
      empty.className = 'heyming-nav-empty';
      empty.textContent = 'No apps found.';
      sectionsHost.appendChild(empty);
      return;
    }

    const visible = registry.filter((app) => {
      // Hide redirect-style stubs (e.g. doom-mods, emulator console aliases)
      // by skipping any path that contains a query string. Direct app
      // entries (path: "./foo/") are kept.
      const path = app.path || '';
      return path && !path.includes('?');
    });

    const placed = new Set();
    const byCategory = new Map();
    for (const app of visible) {
      const cat = app.category || 'utility';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(app);
    }

    for (const def of SECTION_DEFS) {
      const apps = [];
      for (const cat of def.categories) {
        const list = byCategory.get(cat) || [];
        for (const app of list) {
          apps.push(app);
          placed.add(app.id);
        }
      }
      apps.sort((a, b) =>
        (a.shortName || a.name || a.id).localeCompare(b.shortName || b.name || b.id)
      );
      const section = buildSection(def.label, apps);
      if (section) sectionsHost.appendChild(section);
    }

    // Anything left over (unknown category) goes into "More"
    const leftovers = visible.filter((app) => !placed.has(app.id));
    leftovers.sort((a, b) =>
      (a.shortName || a.name || a.id).localeCompare(b.shortName || b.name || b.id)
    );
    const moreSection = buildSection('More', leftovers);
    if (moreSection) sectionsHost.appendChild(moreSection);

    wireSearch();
    scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    const active = drawer.querySelector('.heyming-nav-item.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function wireSearch() {
    const input = drawer.querySelector('.heyming-nav-search-input');
    const sectionsHost = drawer.querySelector('.heyming-nav-sections');
    if (!input || !sectionsHost) return;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const sections = sectionsHost.querySelectorAll('.heyming-nav-section');

      if (!q) {
        sections.forEach((section) => {
          section.style.display = '';
          section
            .querySelectorAll('.heyming-nav-item')
            .forEach((item) => (item.style.display = ''));
        });
        return;
      }

      sections.forEach((section) => {
        let anyVisible = false;
        section.querySelectorAll('.heyming-nav-item').forEach((item) => {
          const haystack = item.dataset.search || '';
          const match = haystack.includes(q);
          item.style.display = match ? '' : 'none';
          if (match) anyVisible = true;
        });
        section.style.display = anyVisible ? '' : 'none';
      });
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const firstVisible = drawer.querySelector(
          '.heyming-nav-sections .heyming-nav-item:not([style*="display: none"])'
        );
        if (firstVisible && firstVisible instanceof HTMLAnchorElement) {
          firstVisible.click();
        }
      }
    });
  }

  // Mark the static "system" rows (Home, OS desktop) as active when the
  // current pathname matches their href. Registry-driven rows get the
  // same treatment in buildSection() via isCurrentApp().
  function markSystemActive() {
    const here = window.location.pathname.replace(/\/+$/, '') || '/';
    drawer.querySelectorAll('.heyming-nav-system .heyming-nav-item').forEach((a) => {
      const href = (a.getAttribute('href') || '').replace(/\/+$/, '') || '/';
      if (href === here) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  // Insert when DOM ready, then async-fetch the registry to fill in the rail.
  function insertChrome() {
    document.head.appendChild(style);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    document.body.appendChild(toggle);
    markSystemActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      insertChrome();
      loadRegistry().then(populateDrawer);
    });
  } else {
    insertChrome();
    loadRegistry().then(populateDrawer);
  }
})();
