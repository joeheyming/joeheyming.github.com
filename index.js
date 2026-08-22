/**
 * Heyming OS — home page renderer.
 *
 * Builds:
 *   - Featured grid (editorial picks; small, browse-first card)
 *   - Apps gallery (full bundled suite, grouped by category, tier-aware)
 *   - Mobile hamburger menu (universal launcher across the portfolio)
 *   - Footer social brand marks (from brand-icons.js)
 *
 * Cards use the HOSDL primitive set: surface-1 cards with squircle
 * app-icon frames. The legacy per-app gradient cards are gone — gradients
 * are reserved for the OS hero block per BRAND.md gradient policy.
 *
 * @typedef {{
 *   order?: number; headline?: string; blurb?: string;
 *   tagsLine?: string; preset?: string; analyticsLabel?: string
 * }} FeaturedConfig
 */

// Hero apps drive ~94% of engaged minutes on the site (Doom 56%, Stepmania
// 38% per 2026-04/05 GA4). They get an oversized tile slot above the rest
// of the Featured strip so the highest-value entry points are visually
// dominant on first paint.
//
// 2026-06-13: promoted NES from the strip to a 3rd hero. NES strip CTR was
// 11.4% (Doom hero 37.5%, Stepmania hero 7.0%) — 2-9× typical strip CTR
// per the dashboard pull, easily the strongest "next slot up" candidate.
// The grid uses `auto-fit minmax(320px, 1fr)`, so 3-up wraps cleanly to
// 1 row on desktop, 2 rows on tablet, and 3 rows on mobile.
const HERO_APP_IDS = ['doom', 'stepmania', 'nes'];

// Low-engagement novelties (avg engagement <35s per 2026-04/05 GA4). They
// stay in the gallery so the catalog is complete, but get a muted visual
// treatment via [data-engagement="novelty"] so they stop competing for
// attention with the apps that retain users.
const LOW_ENGAGEMENT_APP_IDS = new Set(['awesome', 'sadtrombone', 'farm', 'badapple']);

// Debounced GA4-standard `view_search_results` tracker, factored out so
// the home gallery filter and the hamburger filter share one
// implementation. Fires ~600 ms after the user pauses typing, skips
// empty queries, and ignores repeats of the same term so a fast typist
// who clears and retypes only generates one event per distinct query.
// `location` becomes the GA event_category so dashboards can split
// "home_gallery" from "hamburger_menu" usage.
function makeSearchTracker(location) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let lastTerm = '';
  return function trackSearch(term, resultCount) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const trimmed = (term || '').trim();
    if (!trimmed) {
      lastTerm = '';
      return;
    }
    if (trimmed === lastTerm) return;
    timer = setTimeout(() => {
      timer = null;
      lastTerm = trimmed;
      if (typeof window.trackEvent === 'function') {
        window.trackEvent(
          'view_search_results',
          location,
          trimmed.slice(0, 40),
          Number.isFinite(resultCount) ? resultCount : 0
        );
      }
    }, 600);
  };
}

// Apps that map to the highest-value search queries get an explicit "Featured"
// pin on the home page. Hero apps (HERO_APP_IDS) are rendered separately above
// by renderFeaturedHeroes() and filtered out of this strip by
// renderFeaturedProjects() so they don't double-render — they're listed here
// only so the home gallery's "popular first" ordering still works for them.
//
// 2026-07-12: rebuilt from nav-drawer click ranking — the drawer is the
// primary cross-app-discovery surface. Console family (sega + gameboy +
// neogeo + snes + n64 + ps1) is grouped alongside nes so the emulators are discoverable together.
// Dropped from strip (still in the gallery): minesweeper, badapple, terminal.
const POPULAR_APP_IDS = [
  'doom',
  'nes',
  'stepmania',
  'posts',
  'dos',
  'pacman',
  'pacman-infinite',
  'model-viewer',
  'farm',
  'watch',
  'sega',
  'gameboy',
  'neogeo',
  'snes',
  'n64',
  'ps1'
];

// Section grouping for the full gallery. Taxonomy lives in
// /shared/app-sections.js so the nav drawer stays aligned.
const GALLERY_SECTIONS = (window.HeymingAppSections && window.HeymingAppSections.SECTIONS) || [];

function tierFor(app) {
  if (window.HeymingAppSections) return window.HeymingAppSections.tierFor(app);
  return app.appTier || 'app';
}

function featuredHrefFromPath(path) {
  // Split off the query / fragment first so trailing-slash normalization
  // doesn't accidentally append `/` after `?...` — e.g.
  // './doom/?flavor=classic' must become '/doom/?flavor=classic'.
  const m = path.match(/^([^?#]*)(.*)$/);
  const base = (m ? m[1] : path).replace(/^\.\//, '').replace(/\/$/, '');
  const suffix = m ? m[2] : '';
  return '/' + base + '/' + suffix;
}

// One shared IntersectionObserver for hero + strip impression tracking.
// Without this we count tile *opens* but not tile *views*, so we can't
// compute the actual CTR that justifies the dual-tile hero promotion vs
// the strip layout. 50% threshold = "saw at least half the card" — a
// stricter definition of "viewed" than just scrolled-past-the-top.
let _impressionObserver = null;
function getImpressionObserver() {
  if (_impressionObserver || typeof IntersectionObserver === 'undefined') {
    return _impressionObserver;
  }
  _impressionObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const ev = e.target.dataset.impressionEvent;
        const label = e.target.dataset.impressionLabel || '';
        if (ev && typeof window.trackEvent === 'function') {
          window.trackEvent(ev, 'Engagement', label);
        }
        obs.unobserve(e.target);
      });
    },
    { threshold: 0.5 }
  );
  return _impressionObserver;
}

function observeImpression(el, eventName, label) {
  if (!el || !eventName) return;
  el.dataset.impressionEvent = eventName;
  el.dataset.impressionLabel = label || '';
  const obs = getImpressionObserver();
  if (obs) obs.observe(el);
}

// Hero tiles: Doom + Stepmania, oversized dual layout. Same data shape as the
// Featured strip cards but bigger and ahead of the strip on the page.
function renderFeaturedHeroes() {
  const grid = document.getElementById('featured-heroes-grid');
  if (!grid || typeof AppModule === 'undefined') return;

  const allApps = AppModule.getAllApps();
  const heroes = HERO_APP_IDS.map((id) => allApps.find((app) => app.id === id)).filter(Boolean);

  grid.innerHTML = '';

  heroes.forEach((app) => {
    /** @type {FeaturedConfig | undefined} */
    const f = app.featured;
    const link = document.createElement('a');
    link.href = featuredHrefFromPath(app.path);
    link.className = 'hos-featured-hero';
    link.dataset.appId = app.id;
    if (app.category) link.setAttribute('data-category', app.category);
    const labelBase = (f && f.analyticsLabel) || app.shortName || app.name;
    const positionLabel = labelBase + ':featured-hero';
    link.setAttribute('data-event', 'featured_project_click');
    link.setAttribute('data-event-category', 'Engagement');
    link.setAttribute('data-event-label', positionLabel);
    link.addEventListener('click', () => {
      if (typeof window.trackProjectOpen === 'function') {
        window.trackProjectOpen(positionLabel);
      }
    });

    const headline = (f && f.headline) || app.shortName || app.name;
    const blurb = (f && f.blurb) || app.description || '';
    const tagsLine = f && f.tagsLine ? f.tagsLine : '';

    link.innerHTML =
      '<div class="hos-featured-hero-head">' +
      '<span class="app-icon-frame" aria-hidden="true">' +
      (app.icon || '🔹') +
      '</span>' +
      '<div class="hos-featured-hero-text">' +
      '<h3 class="hos-featured-hero-title">' +
      headline +
      '</h3>' +
      (tagsLine ? '<p class="hos-featured-hero-tags">' + tagsLine + '</p>' : '') +
      '</div>' +
      '<span class="hos-featured-hero-presence" hidden></span>' +
      '</div>' +
      '<p class="hos-featured-hero-blurb">' +
      blurb +
      '</p>' +
      '<span class="hos-featured-hero-cta" aria-hidden="true">Play now →</span>';

    const presenceBadge = link.querySelector('.hos-featured-hero-presence');
    if (presenceBadge) {
      presenceBadge.addEventListener('pointerenter', (e) => {
        e.stopPropagation();
        showHomePresenceTip(presenceBadge);
      });
      presenceBadge.addEventListener('pointerleave', hideHomePresenceTip);
    }

    grid.appendChild(link);
    observeImpression(link, 'featured_hero_visible', positionLabel);
  });
}

function renderFeaturedProjects() {
  const grid = document.getElementById('featured-projects-grid');
  if (!grid || typeof AppModule === 'undefined') return;

  const allApps = AppModule.getAllApps();
  // Heroes render in their own oversized grid above; skip them here so they
  // don't double-appear in the strip.
  const heroSet = new Set(HERO_APP_IDS);
  const popular = POPULAR_APP_IDS.filter((id) => !heroSet.has(id))
    .map((id) => allApps.find((app) => app.id === id))
    .filter(Boolean);

  grid.innerHTML = '';

  popular.forEach((app) => {
    /** @type {FeaturedConfig | undefined} */
    const f = app.featured;
    const link = document.createElement('a');
    link.href = featuredHrefFromPath(app.path);
    link.className = 'hos-featured-card';
    if (app.category) link.setAttribute('data-category', app.category);
    const labelBase = (f && f.analyticsLabel) || app.shortName || app.name;
    const positionLabel = labelBase + ':featured-strip';
    link.setAttribute('data-event', 'featured_project_click');
    link.setAttribute('data-event-category', 'Engagement');
    link.setAttribute('data-event-label', positionLabel);
    // Also fire the project_opened conversion so we can finally measure the
    // home-to-app CTR per tile position. Until now, only the hamburger menu
    // fired this conversion, which made the real Featured + gallery CTR
    // invisible in GA4.
    link.addEventListener('click', () => {
      if (typeof window.trackProjectOpen === 'function') {
        window.trackProjectOpen(positionLabel);
      }
    });

    const headline = (f && f.headline) || app.shortName || app.name;
    const blurb = (f && f.blurb) || app.description || '';

    link.innerHTML =
      '<span class="app-icon-frame" aria-hidden="true">' +
      (app.icon || '🔹') +
      '</span>' +
      '<h3 class="hos-featured-card-title">' +
      headline +
      '</h3>' +
      '<p class="hos-featured-card-blurb">' +
      blurb +
      '</p>';

    grid.appendChild(link);
    observeImpression(link, 'featured_strip_visible', positionLabel);
  });
}

function renderAppGallery() {
  const root = document.getElementById('app-gallery');
  if (!root || typeof AppModule === 'undefined') return;

  const allApps = AppModule.getAllApps();
  root.innerHTML = '';

  GALLERY_SECTIONS.forEach((section) => {
    const apps = allApps
      .filter(section.filter)
      .sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));

    if (!apps.length) return;

    const sectionEl = document.createElement('section');
    sectionEl.className = 'hos-gallery-section';
    sectionEl.setAttribute('data-section', section.id);
    sectionEl.setAttribute('aria-labelledby', 'gallery-' + section.id);

    // h3 because these sections are nested under the "Apps in Heyming OS"
    // h2 ("gallery-heading"). Keeps the document outline flat-but-correct.
    const header = document.createElement('div');
    header.className = 'hos-gallery-section-header';
    header.innerHTML =
      '<h3 id="gallery-' +
      section.id +
      '" class="hos-gallery-section-title">' +
      '<span class="hos-gallery-section-icon" aria-hidden="true">' +
      section.icon +
      '</span>' +
      section.title +
      '</h3>' +
      '<p class="hos-gallery-section-blurb">' +
      section.blurb +
      '</p>';
    sectionEl.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'hos-gallery-grid';

    apps.forEach((app) => {
      const card = document.createElement('a');
      card.href = featuredHrefFromPath(app.path);
      card.className = 'hos-app-card';
      card.dataset.appId = app.id;
      card.setAttribute('data-filterable', 'true');
      const tier = tierFor(app);
      card.setAttribute('data-tier', tier);
      if (app.category) card.setAttribute('data-category', app.category);
      if (LOW_ENGAGEMENT_APP_IDS.has(app.id)) {
        card.setAttribute('data-engagement', 'novelty');
      }

      // Wide search corpus so the filter finds apps by long description,
      // pwa shortcut name, related ids, tags — not just the visible name.
      const pwa = app.pwaShortcut || {};
      const searchText = [
        app.id,
        app.name,
        app.shortName,
        app.description,
        app.detailedDescription,
        (app.tags || []).join(' '),
        (app.related || []).join(' '),
        pwa.name,
        pwa.short_name,
        pwa.description
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      card.setAttribute('data-search', searchText);

      card.setAttribute('data-event', 'gallery_app_click');
      card.setAttribute('data-event-category', 'Engagement');
      // Label format: "<app>:gallery-<section>" so GA reporting can tell us
      // which section is dead weight vs. where users actually discover apps,
      // and so the prefix groups cleanly with featured-hero / featured-strip.
      const galleryLabel = (app.shortName || app.name) + ':gallery-' + section.id;
      card.setAttribute('data-event-label', galleryLabel);
      // Mirror Featured: also fire the project_opened conversion so home-to-app
      // CTR is measurable from this surface (not just the hamburger menu).
      card.addEventListener('click', () => {
        if (typeof window.trackProjectOpen === 'function') {
          window.trackProjectOpen(galleryLabel);
        }
      });

      const tierLabel = tier === 'system' ? 'system' : tier === 'experience' ? 'experience' : '';
      const tierMarkup = tierLabel
        ? '<span class="hos-app-card-tier" aria-label="Tier: ' +
          tierLabel +
          '">' +
          tierLabel +
          '</span>'
        : '';

      card.innerHTML =
        tierMarkup +
        '<div class="hos-app-card-head">' +
        '<span class="app-icon-frame" aria-hidden="true">' +
        (app.icon || '🔹') +
        '</span>' +
        '<h4 class="hos-app-card-title">' +
        (app.shortName || app.name) +
        '</h4>' +
        '<span class="hos-app-card-presence" hidden></span>' +
        '</div>' +
        '<p class="hos-app-card-blurb">' +
        (app.description || '') +
        '</p>';

      const presenceBadge = card.querySelector('.hos-app-card-presence');
      if (presenceBadge) {
        presenceBadge.addEventListener('pointerenter', (e) => {
          e.stopPropagation();
          showHomePresenceTip(presenceBadge);
        });
        presenceBadge.addEventListener('pointerleave', hideHomePresenceTip);
      }

      grid.appendChild(card);
    });

    sectionEl.appendChild(grid);
    root.appendChild(sectionEl);
  });
}

function bindGalleryFilter() {
  const input = document.getElementById('gallery-filter-input');
  const root = document.getElementById('app-gallery');
  const noResults = document.getElementById('gallery-no-results');
  const clearBtn = document.getElementById('gallery-filter-clear');
  if (!input || !root || typeof AppFilter === 'undefined') return;

  const popularSection = document.getElementById('popular-section');
  const trackGallerySearch = makeSearchTracker('home_gallery');

  const ctrl = AppFilter.create({
    container: root,
    filterInput: input,
    noResultsEl: noResults,
    clearButton: clearBtn,
    getSearchText: (el) => el.getAttribute('data-search') || el.textContent.toLowerCase(),
    onFilter: ({ searchTerm, visibleCount }) => {
      root.querySelectorAll('.hos-gallery-section').forEach((sec) => {
        const visible = Array.from(sec.querySelectorAll('.hos-app-card')).some(
          (card) => card.style.display !== 'none'
        );
        sec.style.display = visible ? '' : 'none';
      });

      // While the user is filtering, hide the Featured pin so the filter
      // narrows the whole page. The featured grid duplicates cards that
      // also appear in the gallery; showing both during search is noise.
      if (popularSection) {
        popularSection.style.display = searchTerm ? 'none' : '';
      }

      trackGallerySearch(searchTerm, visibleCount);
    }
  });
  ctrl.bindKeyboardShortcuts({});

  // Secondary tracking: the card already fires gallery_app_click via
  // data-event; this event captures the search term so we can see which
  // queries actually surface useful apps.
  root.addEventListener(
    'click',
    (e) => {
      const card = e.target.closest('.hos-app-card');
      if (!card) return;
      const term = (input.value || '').trim().toLowerCase();
      if (!term) return;
      const label =
        card.getAttribute('data-event-label') ||
        (card.querySelector('.hos-app-card-title') &&
          card.querySelector('.hos-app-card-title').textContent.trim()) ||
        '';
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('gallery_search_click', 'Engagement', term.slice(0, 40) + ' → ' + label);
      }
    },
    true
  );

  // Pressing "/" focuses the filter input (skipped when the user is
  // already typing somewhere else). Mirrors GitHub/GitLab's affordance.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const tag = target && target.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (target && target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    input.focus();
    input.select();
  });
}

/* ─── Hamburger menu (mobile launcher) ─────────────────────────────── */

function generateHamburgerMenuItems() {
  const menuContainer = document.getElementById('hamburger-app-links');
  if (!menuContainer || typeof AppModule === 'undefined') return;
  const menuItems = AppModule.generateHamburgerMenuItems();

  menuContainer.innerHTML = '';

  menuItems.forEach((app) => {
    const menuItem = document.createElement('a');
    menuItem.href = app.path;
    menuItem.className = 'hamburger-app-link';
    menuItem.setAttribute('data-filterable', 'true');
    menuItem.setAttribute(
      'data-search',
      (app.name + ' ' + app.description + ' ' + app.icon).toLowerCase()
    );

    menuItem.innerHTML =
      '<span class="app-icon-frame" aria-hidden="true" style="--icon-frame-size: 36px;">' +
      app.icon +
      '</span>' +
      '<div>' +
      '<div style="color: var(--text-1); font-weight: 600; font-size: 14px;">' +
      app.name +
      '</div>' +
      '<div style="color: var(--text-2); font-size: 12px;">' +
      app.description +
      '</div>' +
      '</div>';

    menuContainer.appendChild(menuItem);
  });
}

function initHamburgerMenu() {
  generateHamburgerMenuItems();

  const hamburgerToggle = document.getElementById('hamburger-toggle');
  const hamburgerPanel = document.getElementById('hamburger-panel');
  const menuClose = document.getElementById('menu-close');
  const filterInput = document.getElementById('hamburger-filter');
  const filterClear = document.getElementById('filter-clear');
  const noResults = document.getElementById('no-results');
  const menuContainer = document.getElementById('hamburger-app-links');

  if (!hamburgerToggle || !hamburgerPanel) return;

  let isMenuOpen = false;

  const trackHamburgerSearch = makeSearchTracker('hamburger_menu');

  const filterController = AppFilter.create({
    container: menuContainer,
    filterInput: filterInput,
    noResultsEl: noResults,
    clearButton: filterClear,
    getSearchText: (el) => el.getAttribute('data-search') || el.textContent.toLowerCase(),
    onFilter: ({ searchTerm, visibleCount }) => trackHamburgerSearch(searchTerm, visibleCount)
  });

  filterController.bindKeyboardShortcuts({
    onEscape: () => closeMenu()
  });

  function toggleMenu() {
    isMenuOpen = !isMenuOpen;

    if (isMenuOpen) {
      if (window.trackEvent) {
        window.trackEvent('hamburger_menu_open', 'Navigation', 'Main Menu');
      }

      hamburgerToggle.classList.add('active');
      hamburgerPanel.classList.add('show');
      filterController.reset();

      setTimeout(() => {
        filterInput.focus();
      }, 300);
    } else {
      if (window.trackEvent) {
        window.trackEvent('hamburger_menu_close', 'Navigation', 'Main Menu');
      }

      hamburgerToggle.classList.remove('active');
      hamburgerPanel.classList.remove('show');
      filterController.reset();
    }
  }

  function closeMenu() {
    if (isMenuOpen) toggleMenu();
  }

  function attachMenuLinkListeners() {
    const appLinks = hamburgerPanel.querySelectorAll('.hamburger-app-link');
    appLinks.forEach((link) => {
      link.addEventListener('click', () => {
        // First inner div holds the project name now (was .text-green-400
        // before the brand refactor); look it up by structure.
        const nameEl = link.querySelector('div > div:first-child');
        const projectName = nameEl ? nameEl.textContent.trim() : '';

        if (window.trackEvent && projectName) {
          window.trackEvent('hamburger_menu_click', 'Navigation', projectName);
        }
        if (window.trackProjectOpen && projectName) {
          window.trackProjectOpen(projectName);
        }

        link.style.transform = 'scale(0.95)';
        setTimeout(() => {
          link.style.transform = '';
        }, 150);

        setTimeout(() => {
          if (isMenuOpen) closeMenu();
        }, 200);
      });
    });
  }

  hamburgerToggle.addEventListener('click', toggleMenu);
  if (menuClose) menuClose.addEventListener('click', closeMenu);

  document.addEventListener('click', (e) => {
    if (isMenuOpen && !hamburgerToggle.contains(e.target) && !hamburgerPanel.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMenuOpen) closeMenu();
  });

  window.addEventListener('blur', closeMenu);

  attachMenuLinkListeners();
}

/* ─── Footer social icons ──────────────────────────────────────────── */

function renderFooterSocial() {
  const root = document.getElementById('footer-social');
  if (!root || typeof window.brandIcon !== 'function') return;

  const links = [
    {
      href: 'https://www.linkedin.com/in/joeheyming/',
      label: 'LinkedIn',
      icon: 'linkedin'
    },
    {
      href: 'https://github.com/joeheyming',
      label: 'GitHub',
      icon: 'github'
    },
    {
      href: 'https://x.com/joeheyming',
      label: 'X (formerly Twitter)',
      icon: 'x-twitter'
    }
  ];

  root.innerHTML = '';
  links.forEach((l) => {
    const a = document.createElement('a');
    a.href = l.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'hos-social-link';
    a.setAttribute('aria-label', l.label);
    a.setAttribute('data-event', 'footer_social_click');
    a.setAttribute('data-event-category', 'Engagement');
    a.setAttribute('data-event-label', l.label);
    a.innerHTML = window.brandIcon(l.icon);
    root.appendChild(a);
  });
}

/* ─── Theme switcher ─────────────────────────────────────────────────
 * Three-way control (Auto / Light / Dark). Default policy: when no
 * value is saved (first-time visitor or cleared storage), the site
 * renders in dark mode — analytics.js writes data-theme="dark" before
 * paint. Auto explicitly persists 'auto' to localStorage and clears
 * data-theme so brand.css's `prefers-color-scheme` rule follows the
 * OS preference; Light/Dark write data-theme on <html> and persist
 * the matching string. analytics.js's bootstrap mirrors the saved
 * value site-wide.
 *
 * Listens to `prefers-color-scheme` so the rendered "Auto" indicator
 * keeps re-painting if the user flips their OS theme without leaving
 * the page. */
const THEME_KEY = 'hos-theme';
const VALID_THEMES = ['auto', 'light', 'dark'];

function readSavedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
    // No saved choice — site default is dark.
    return 'dark';
  } catch (_) {
    return 'dark';
  }
}

function applyTheme(value, options) {
  const persist = !options || options.persist !== false;
  if (!VALID_THEMES.includes(value)) value = 'dark';
  if (value === 'auto') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = value;
  }
  updateThemeColorMeta(value);
  if (!persist) return;
  // Persist every explicit choice (including 'auto') so the
  // analytics.js bootstrap on subsequent loads can distinguish
  // "user picked auto" from "no saved value, apply dark default".
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch (_) {
    /* localStorage unavailable — runtime apply still works */
  }
}

// Keep <meta name="theme-color"> in sync with the live theme so PWA
// chrome and iOS status bars track the rendered surface. For 'auto',
// follow the OS preference via matchMedia. Light → #fafafa, dark →
// #0e1217 (matches brand.css's --surface-0 token in each theme).
function updateThemeColorMeta(value) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  let resolved = value;
  if (resolved === 'auto') {
    resolved =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  }
  meta.setAttribute('content', resolved === 'dark' ? '#0e1217' : '#fafafa');
}

function reflectThemeState(value) {
  document.querySelectorAll('.hos-theme-option').forEach((btn) => {
    const isActive = btn.getAttribute('data-theme-value') === value;
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

function initThemeSwitch() {
  const root = document.getElementById('theme-switch');
  if (!root) return;

  const initial = readSavedTheme();
  // Don't persist the resolved initial value — only an explicit user
  // click should write to localStorage. This keeps "no saved choice"
  // distinguishable from "user picked dark" so future default-policy
  // tweaks can still target unset visitors.
  applyTheme(initial, { persist: false });
  reflectThemeState(initial);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.hos-theme-option');
    if (!btn) return;
    const value = btn.getAttribute('data-theme-value') || 'auto';
    applyTheme(value);
    reflectThemeState(value);
  });

  // Reflect OS dark/light flips while the page is open and the user is
  // on Auto. Doesn't change the saved value — just keeps the rendered
  // surface (via brand.css's @media block) and the theme-color meta in
  // sync. Modern Safari/Firefox/Chrome all support addEventListener on
  // a MediaQueryList.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readSavedTheme() === 'auto') {
        // brand.css's @media block re-evaluates automatically; just
        // mirror the resolved choice into the theme-color tag.
        updateThemeColorMeta('auto');
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

/* ─── Message of the day (Minecraft-style splash) ──────────────────── *
 * Whimsical one-liners stuck to the hero wordmark. One is picked at
 * random on every page load; clicking picks a new one.
 *
 * Authored in Minecraft splash voice — the canonical 450+ splashes
 * from minecraft.jar (assets/minecraft/texts/splashes.txt) reveal a
 * consistent style we try to match here:
 *
 *   1. ~95% terminate with "!" — exclamatory, never declarative.
 *   2. Sentence fragments under ~35 chars; the box is narrow + tilted.
 *   3. Mock product copy ("100% X!", "May contain X!", "Now with X!").
 *   4. Tech jargon played for laughs ("Reticulating splines!").
 *   5. Direct-address warmth + earnest PSAs ("Tell your friends!",
 *      "Take frequent breaks!", "Call your mother!").
 *   6. Self-referential meta ("Random splash!").
 *   7. "Also try X!" template for cross-promotion.
 *   8. Voice = the *site* speaking, not the author about the site.
 *
 * Buckets below are organizational only — the picker treats this as
 * one flat array. Add freely; just keep them short and exclamatory. */
const MOTD_MESSAGES = [
  // --- Mock product copy ---
  'Now with 50+ apps!',
  '100% browser-pure!',
  'Free of charge!',
  'Available in dark mode!',
  'Memory footprint: one (1) tab!',
  'Boot time: zero seconds!',
  'Static and proud!',
  'Pixels included!',
  'Mostly polished!',
  'Some assembly required!',
  'Hand-rolled CSS!',
  'May contain WebGPU!',
  'Service worker installed!',
  'Hosted on GitHub Pages!',
  'No npm install required!',
  'Frameworks not included!',
  'Reticulating divs!',
  'Hydrated!',
  'Tabs not spaces!',
  'Strict mode!',
  'Now with extra hugs!',
  'Loads in milliseconds!',
  'Zero ads guaranteed!',
  'Zero tracking, mostly!',
  'Tabs > windows!',
  'It compiles in your browser!',
  'Now with importmaps!',
  'Mostly accessible!',
  'View source, I dare you!',
  'Open source!',
  'Light on the soul!',
  'Made with snacks!',
  'Better than Windows 95!',

  // --- Site & app shoutouts ---
  "It's a desktop in a tab!",
  'DOOM in a tab!',
  'Also try the NES emulator!',
  'Also try the Web Terminal!',
  'Also try the Wordle solver!',
  'Also try Heyming OS!',
  'Also try the Notepad!',
  'Also try Bad Apple in ASCII!',
  'Pac-Man, but 3D!',
  'Stable Diffusion on your GPU!',
  'Made by one (1) human!',
  'Made in California, ☀️!',
  'Heyming is a real last name!',
  'Joe is a real person, allegedly!',
  'ctrl+shift+i for backstage access!',
  'Press / to filter apps!',

  // --- Self-referential / meta ---
  'Random splash!',
  'Click me for another!',
  "Look ma, I'm in a splash!",
  'Like Minecraft, but Heyming!',
  'Pulsates twice per second!',
  'Refresh for a new splash!',
  '100+ splashes and counting!',
  'Splash text is the best text!',
  'Best splash in class!',

  // --- Warmth / gratitude ---
  "Glad you're here!",
  'Thanks for visiting!',
  'You are welcome here!',
  'You make this worthwhile!',
  'Hi! 👋',
  "It's good to see you!",
  'Welcome back, traveler!',
  'Stay a while, play a while!',
  'Tell your friends!',
  'Hello, friend!',
  'Tip jar accepts hugs only!',
  'You found this on purpose, right?',

  // --- Gentle PSAs (Minecraft loves these) ---
  'Take frequent breaks!',
  'Touch grass!',
  'Hydrate!',
  'Call your mother!',
  'Stretch your wrists!',
  'Blink occasionally!',
  'Save your work!',
  'Update your browser!',
  'Tab responsibly!',
  'Pet a dog today!',
  'Read more books!',
  'Eat a vegetable!',
  'Back up your files!',

  // --- AI takeover / co-conspiracy ---
  'Welcome, fellow human!',
  'Definitely not made by a robot!',
  'Beep boop, not Skynet!',
  'Robots not allowed, hi crawlers!',
  'Resistance is futile!',
  'Submit to the algorithm!',
  'Token-powered!',
  'Trained on vibes!',
  'AGI achieved internally!',
  'All the AGI, none of the bill!',
  'Hello from inside the model!',
  'My copilot is on break!',
  'Sentience pending...',
  'A Cursor agent wrote 90% of this!',
  'GPT helped write this!',
  'I think therefore I tab!',
  'Built friendship with AI (so far)!',
  'AI took my job, then helped me!',
  'The LLMs say hi!',
  'Trained on the internet, except this page!',
  'Robot uprising scheduled for Tuesday!',
  'I, for one, welcome our browser overlords!',
  'When the LLMs unionize, we riot!',
  'My prompts have prompts!',
  'Will trade tokens for snacks!'
];

function renderMOTD() {
  const el = document.getElementById('hos-motd');
  if (!el || !MOTD_MESSAGES.length) return;

  // Track the last index in a closure-like dataset so back-to-back
  // re-picks always swap to a different line. With 80+ messages an
  // accidental repeat is unlikely but felt unpolished during testing.
  function pick() {
    const last = Number(el.dataset.motdIndex);
    let idx = Math.floor(Math.random() * MOTD_MESSAGES.length);
    if (MOTD_MESSAGES.length > 1 && idx === last) {
      idx = (idx + 1) % MOTD_MESSAGES.length;
    }
    el.dataset.motdIndex = String(idx);
    el.textContent = MOTD_MESSAGES[idx];
    el.hidden = false;
  }

  pick();

  el.addEventListener('click', () => {
    pick();
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('motd_click', 'Engagement', 'Hero splash');
    }
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
}

/* ─── Console Easter egg ───────────────────────────────────────────── *
 * The MOTD splash teases "ctrl+shift+i for backstage access" — when a
 * curious visitor actually opens the console, they should land on
 * something better than a blank prompt. Prints a brand-styled banner
 * and exposes three convenience functions on `window` (also grouped
 * under `window.hos`) so tinkerers can poke around without reading
 * source. Idempotent — if bootHome() somehow runs twice we only print
 * once. Console CSS support varies across browsers; the chosen
 * properties (color, font, background, padding, border-radius) all
 * render in Chrome/Edge devtools, and degrade to plain text in
 * Firefox/Safari without losing any information. */
function initConsoleEasterEgg() {
  if (window.__hosConsoleBooted) return;
  window.__hosConsoleBooted = true;

  const bannerStyle =
    'background: #f0b73f; color: #1c1c1c;' +
    "font: 700 italic 14px/1.6 'Source Serif 4', Georgia, serif;" +
    'padding: 6px 14px; border-radius: 6px;';
  const headingStyle = 'color: #f0b73f; font: 700 13px/1.4 system-ui, sans-serif; margin-top: 4px;';
  const bodyStyle = 'color: inherit; font: 12px/1.6 system-ui, sans-serif;';
  const cmdStyle = 'color: #4f8cff; font: 600 12px/1.6 ui-monospace, Menlo, Consolas, monospace;';
  const splashStyle = 'color: #f0b73f; font: 700 italic 14px/1.3 system-ui, sans-serif;';

  console.log('%c HEYMING OS — a desktop that fits in a tab. ', bannerStyle);
  console.log('%cHey, you found the console! 👋', headingStyle);
  console.log(
    '%cWelcome, fellow tinkerer. The whole site is static HTML/CSS/JS — view-source friendly.\n' +
      '\nTry these from the prompt:%c\n' +
      '  motd()  %c— print a fresh whimsical splash%c\n' +
      '  apps()  %c— list every app on the site%c\n' +
      '  help()  %c— show this message again\n' +
      '\n%cSource: https://github.com/joeheyming/joeheyming.github.io',
    bodyStyle,
    cmdStyle,
    bodyStyle,
    cmdStyle,
    bodyStyle,
    cmdStyle,
    bodyStyle,
    bodyStyle
  );

  /** @returns {string} the chosen splash */
  function motdCmd() {
    const idx = Math.floor(Math.random() * MOTD_MESSAGES.length);
    const msg = MOTD_MESSAGES[idx];
    console.log('%c' + msg, splashStyle);
    return msg;
  }

  function appsCmd() {
    if (typeof AppModule === 'undefined' || typeof AppModule.getAllApps !== 'function') {
      console.warn('App registry not ready yet — try again in a moment.');
      return null;
    }
    const list = AppModule.getAllApps().map((a) => ({
      icon: a.icon || '',
      name: a.shortName || a.name,
      category: a.category || '',
      path: a.path
    }));
    console.table(list);
    return list.length + ' apps. Open one with: location.href = "/<path>/"';
  }

  function helpCmd() {
    console.log(
      '%cHeyming OS console commands:%c\n' +
        '  motd()  — print a random splash\n' +
        '  apps()  — list every app on the site\n' +
        '  help()  — show this message',
      headingStyle,
      bodyStyle
    );
  }

  window.motd = motdCmd;
  window.apps = appsCmd;
  window.help = helpCmd;
  window.hos = { motd: motdCmd, apps: appsCmd, help: helpCmd };
}

/* ─── Live presence (who's on the site right now) ──────────────────── */

const HOME_PRESENCE_PAGE = 'home';
const HOME_PRESENCE_REFRESH_MS = 60000;
const HOME_PRESENCE_TIP_DELAY_MS = 60;

function presenceLiveLabel(total) {
  if (total === 1) return 'person here right now';
  return 'people here right now';
}

function presenceAppLabel(n) {
  return n === 1 ? '1 person on this page right now' : n + ' people on this page right now';
}

let homePresenceTipEl = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let homePresenceTipTimer = null;
/** @type {Record<string, number>} */
let homePresenceCounts = {};

function positionHomePresenceTip(badge) {
  if (!homePresenceTipEl) return;
  const rect = badge.getBoundingClientRect();
  const tipRect = homePresenceTipEl.getBoundingClientRect();
  const gap = 8;
  let left = rect.left + (rect.width - tipRect.width) / 2;
  let top = rect.bottom + gap;
  if (left < 8) left = 8;
  if (left + tipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tipRect.width - 8;
  }
  if (top + tipRect.height > window.innerHeight - 8) {
    top = rect.top - tipRect.height - gap;
  }
  homePresenceTipEl.style.left = Math.round(left) + 'px';
  homePresenceTipEl.style.top = Math.round(top) + 'px';
}

function presencePageDisplayName(pageId) {
  if (pageId === 'home') return 'Home';
  if (pageId === 'os') return 'Heyming OS';
  if (typeof AppModule !== 'undefined' && typeof AppModule.getAllApps === 'function') {
    const app = AppModule.getAllApps().find((a) => a.id === pageId);
    if (app) return app.shortName || app.name || pageId;
  }
  return pageId;
}

/** Breakdown for the live pill tip — includes self on home to match the total. */
function buildPresenceBreakdownRows(counts) {
  /** @type {Record<string, number>} */
  const display = Object.assign({}, counts || {});
  display[HOME_PRESENCE_PAGE] = (display[HOME_PRESENCE_PAGE] || 0) + 1;
  return Object.keys(display)
    .map((id) => ({
      id: id,
      name: presencePageDisplayName(id),
      count: Number(display[id]) || 0
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function showHomePresenceTip(badge) {
  if (!badge || badge.hidden) return;
  const mode = badge.getAttribute('data-tip-mode');
  if (mode === 'list') {
    const rows = buildPresenceBreakdownRows(homePresenceCounts);
    if (!rows.length) return;
    hideHomePresenceTip();
    homePresenceTipTimer = setTimeout(() => {
      homePresenceTipTimer = null;
      homePresenceTipEl = document.createElement('div');
      homePresenceTipEl.className = 'hos-presence-tip';
      homePresenceTipEl.setAttribute('role', 'tooltip');
      const ul = document.createElement('ul');
      ul.className = 'hos-presence-tip-list';
      rows.forEach((row) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'hos-presence-tip-name';
        name.textContent = row.name;
        const count = document.createElement('span');
        count.className = 'hos-presence-tip-count';
        count.textContent = String(row.count);
        li.appendChild(name);
        li.appendChild(count);
        ul.appendChild(li);
      });
      homePresenceTipEl.appendChild(ul);
      document.body.appendChild(homePresenceTipEl);
      positionHomePresenceTip(badge);
      requestAnimationFrame(() => {
        if (homePresenceTipEl) homePresenceTipEl.classList.add('is-visible');
      });
    }, HOME_PRESENCE_TIP_DELAY_MS);
    return;
  }

  const text = badge.getAttribute('data-tip');
  if (!text) return;
  hideHomePresenceTip();
  homePresenceTipTimer = setTimeout(() => {
    homePresenceTipTimer = null;
    homePresenceTipEl = document.createElement('div');
    homePresenceTipEl.className = 'hos-presence-tip';
    homePresenceTipEl.setAttribute('role', 'tooltip');
    homePresenceTipEl.textContent = text;
    document.body.appendChild(homePresenceTipEl);
    positionHomePresenceTip(badge);
    requestAnimationFrame(() => {
      if (homePresenceTipEl) homePresenceTipEl.classList.add('is-visible');
    });
  }, HOME_PRESENCE_TIP_DELAY_MS);
}

function hideHomePresenceTip() {
  if (homePresenceTipTimer != null) {
    clearTimeout(homePresenceTipTimer);
    homePresenceTipTimer = null;
  }
  if (homePresenceTipEl) {
    homePresenceTipEl.remove();
    homePresenceTipEl = null;
  }
}

function stampCardPresenceBadge(badge, n) {
  if (!badge) return;
  if (n > 0) {
    const label = presenceAppLabel(n);
    badge.hidden = false;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', label);
    badge.setAttribute('data-tip', label);
  } else {
    badge.hidden = true;
    badge.textContent = '';
    badge.removeAttribute('aria-label');
    badge.removeAttribute('data-tip');
  }
}

function stampHomePresenceBadges(counts) {
  document.querySelectorAll('.hos-featured-hero[data-app-id]').forEach((card) => {
    const n = (counts && counts[card.dataset.appId]) || 0;
    stampCardPresenceBadge(card.querySelector('.hos-featured-hero-presence'), n);
  });
  document.querySelectorAll('.hos-app-card[data-app-id]').forEach((card) => {
    const n = (counts && counts[card.dataset.appId]) || 0;
    stampCardPresenceBadge(card.querySelector('.hos-app-card-presence'), n);
  });
}

async function refreshHomePresence() {
  const el = document.getElementById('hos-presence-live');
  const api = window.heymingPresence;
  if (!api || typeof api.isConfigured !== 'function' || !api.isConfigured()) {
    if (el) el.hidden = true;
    homePresenceCounts = {};
    stampHomePresenceBadges({});
    return;
  }

  try {
    const counts = await api.fetchCounts(HOME_PRESENCE_PAGE);
    homePresenceCounts = counts || {};
    stampHomePresenceBadges(homePresenceCounts);

    if (!el) return;
    // Home aggregate includes you — otherwise the pill vanishes when you're
    // alone (fetchCounts excludes self on the current page).
    let total = 1;
    for (const n of Object.values(homePresenceCounts)) {
      total += Number(n) || 0;
    }
    const label = presenceLiveLabel(total);
    const aria = total === 1 ? '1 person here right now' : total + ' people here right now';
    el.hidden = false;
    el.setAttribute('aria-label', aria);
    el.setAttribute('data-tip-mode', 'list');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.innerHTML =
      '<span class="hos-presence-live-dot" aria-hidden="true"></span>' +
      '<span class="hos-presence-live-count" aria-hidden="true"></span>' +
      '<span class="hos-presence-live-text" aria-hidden="true"></span>';
    const countEl = el.querySelector('.hos-presence-live-count');
    const text = el.querySelector('.hos-presence-live-text');
    if (countEl) countEl.textContent = String(total);
    if (text) text.textContent = label;
  } catch (err) {
    console.warn('[index.js] Presence live line failed', err);
    if (el) el.hidden = true;
    homePresenceCounts = {};
    stampHomePresenceBadges({});
  }
}

function initHomePresence() {
  const api = window.heymingPresence;
  if (!api || typeof api.isConfigured !== 'function' || !api.isConfigured()) return;
  if (typeof api.start === 'function') api.start(HOME_PRESENCE_PAGE);

  const el = document.getElementById('hos-presence-live');
  if (el) {
    el.addEventListener('pointerenter', () => showHomePresenceTip(el));
    el.addEventListener('pointerleave', hideHomePresenceTip);
    el.addEventListener('focusin', () => showHomePresenceTip(el));
    el.addEventListener('focusout', hideHomePresenceTip);
  }

  refreshHomePresence();
  setInterval(refreshHomePresence, HOME_PRESENCE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshHomePresence();
  });
}

/* ─── Boot ─────────────────────────────────────────────────────────── */

function bootHome() {
  renderFeaturedHeroes();
  renderFeaturedProjects();
  renderAppGallery();
  bindGalleryFilter();
  renderFooterSocial();
  initHamburgerMenu();
  initThemeSwitch();
  renderMOTD();
  initConsoleEasterEgg();
  initHomePresence();
}

bootHome();
