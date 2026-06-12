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
// 38% per 2026-04/05 GA4). They get an oversized dual-tile slot above the
// rest of the Featured strip so the highest-value entry points are visually
// dominant on first paint.
const HERO_APP_IDS = ['doom', 'stepmania'];

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
// pin on the home page. Order matches the keyword-report priority: DOOM first
// (~14k impressions/mo), then NES, Pac-Man, StepMania, Wordle, etc. The hero
// apps are rendered separately above by renderFeaturedHeroes() and filtered
// out of this strip by renderFeaturedProjects() so they don't double-render.
const POPULAR_APP_IDS = [
  'doom',
  'nes',
  'pacman',
  'pacman-infinite',
  'stepmania',
  'wordle-finder',
  'minesweeper',
  'badapple',
  'terminal',
  'code-ide'
];

// Section grouping for the full gallery. Order is presentation order on
// the page. Each section pulls from the registry by category, with the
// /play/* music family carved out so it gets its own bucket.
const GALLERY_SECTIONS = [
  {
    id: 'games',
    icon: '🕹️',
    title: 'Games',
    blurb: 'Browser games — no install, no signup, no ads.',
    filter: (app) => app.category === 'game'
  },
  {
    id: 'music',
    icon: '🎵',
    title: 'Make music',
    blurb: 'Pick an instrument and play it right in your browser.',
    filter: (app) => app.id === 'play' || /^play-/.test(app.id)
  },
  {
    id: 'tools',
    icon: '🛠️',
    title: 'Tools',
    blurb: 'Useful little utilities.',
    filter: (app) => app.category === 'utility' && app.id !== 'play' && !/^play-/.test(app.id)
  },
  {
    id: 'fun',
    icon: '🎉',
    title: 'Fun & experiments',
    blurb: 'Just-for-fun side projects.',
    filter: (app) => app.category === 'entertainment' && app.id !== 'play' && !/^play-/.test(app.id)
  }
];

// Stand-in tier map for the gallery during the rollout. Once
// apps-registry.json carries an `appTier` field on every entry, this map
// becomes obsolete and tierFor() reads from app.appTier directly.
const TIER_FALLBACK = {
  calculator: 'system',
  notepad: 'system',
  'wordle-finder': 'system',
  terminal: 'system',
  weather: 'system',
  stock: 'system',
  clock: 'system',
  countdown: 'system',
  filemanager: 'system',
  'image-viewer': 'system',
  'media-player': 'system',
  read: 'system',
  doom: 'experience',
  nes: 'experience',
  stepmania: 'experience',
  pacman: 'experience',
  'pacman-infinite': 'experience',
  badapple: 'experience',
  starwars: 'experience',
  'bad-apple': 'experience',
  pbs: 'experience',
  paint: 'experience',
  'model-viewer': 'experience',
  farm: 'experience',
  ascii: 'experience'
};

function tierFor(app) {
  if (app.appTier) return app.appTier;
  return TIER_FALLBACK[app.id] || 'app';
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
      '</div>' +
      '<p class="hos-featured-hero-blurb">' +
      blurb +
      '</p>' +
      '<span class="hos-featured-hero-cta" aria-hidden="true">Play now →</span>';

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
        '</div>' +
        '<p class="hos-app-card-blurb">' +
        (app.description || '') +
        '</p>';
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

      const links = hamburgerPanel.querySelectorAll('.hamburger-app-link');
      links.forEach((link, index) => {
        setTimeout(() => {
          link.style.opacity = '1';
        }, index * 50);
      });
    } else {
      if (window.trackEvent) {
        window.trackEvent('hamburger_menu_close', 'Navigation', 'Main Menu');
      }

      hamburgerToggle.classList.remove('active');
      hamburgerPanel.classList.remove('show');
      filterController.reset();

      const links = hamburgerPanel.querySelectorAll('.hamburger-app-link');
      links.forEach((link) => {
        link.style.opacity = '0';
      });
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

/* ─── Boot ─────────────────────────────────────────────────────────── */

function bootHome() {
  renderFeaturedHeroes();
  renderFeaturedProjects();
  renderAppGallery();
  bindGalleryFilter();
  renderFooterSocial();
  initHamburgerMenu();
  initThemeSwitch();
}

bootHome();
