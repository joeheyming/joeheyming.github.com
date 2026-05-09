/** @typedef {{ order?: number; headline?: string; blurb?: string; tagsLine?: string; preset?: string; analyticsLabel?: string }} FeaturedConfig */

const FEATURED_CARD_BASE =
  'group rounded-2xl p-6 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 block';
const FEATURED_PRESETS = {
  doom: { gradient: 'bg-gradient-to-br from-red-600 to-orange-700', tone: 'light' },
  pacman: { gradient: 'bg-gradient-to-br from-yellow-500 to-yellow-600', tone: 'dark' },
  minesweeper: { gradient: 'bg-gradient-to-br from-gray-600 to-gray-700', tone: 'light' },
  awesome: { gradient: 'bg-gradient-to-br from-yellow-400 to-orange-500', tone: 'dark' },
  terminal: { gradient: 'bg-gradient-to-br from-green-600 to-emerald-700', tone: 'light' },
  countdown: { gradient: 'bg-gradient-to-br from-amber-500 to-orange-600', tone: 'light' }
};

// Apps that map to the highest-value search queries get an explicit "popular"
// pin on the home page. Order matches the keyword-report priority: DOOM
// first (~14k impressions/mo), then NES, Pac-Man, StepMania, Wordle, etc.
const POPULAR_APP_IDS = [
  'doom',
  'nes',
  'pacman',
  'stepmania',
  'wordle-finder',
  'minesweeper',
  'badapple',
  'terminal'
];

// Section grouping for the full gallery. Order here is presentation order
// on the home page. Each section pulls from the registry by category, with
// special-case overrides for music (the /play/* family).
const GALLERY_SECTIONS = [
  {
    id: 'games',
    title: '🕹️ Games',
    blurb: 'Browser games — no install, no signup, no ads.',
    filter: (app) => app.category === 'game'
  },
  {
    id: 'music',
    title: '🎵 Make music',
    blurb: 'Pick an instrument and play it right in your browser.',
    filter: (app) => app.id === 'play' || /^play-/.test(app.id)
  },
  {
    id: 'tools',
    title: '🛠️ Tools',
    blurb: 'Useful little utilities.',
    filter: (app) => app.category === 'utility' && app.id !== 'play' && !/^play-/.test(app.id)
  },
  {
    id: 'fun',
    title: '🎉 Fun &amp; experiments',
    blurb: 'Just-for-fun side projects.',
    filter: (app) => app.category === 'entertainment' && app.id !== 'play' && !/^play-/.test(app.id)
  }
];

const GALLERY_FALLBACK_GRADIENT = 'bg-gradient-to-br from-slate-700 to-slate-900';

function tailwindGradientFromTokens(tokens) {
  // Apps in the registry use Tailwind tokens like "from-yellow-500/20 to-orange-500/20"
  // (designed for the OS chrome). On the home page gallery cards we want a
  // bolder fill, so strip the /alpha suffixes if present and prepend
  // "bg-gradient-to-br".
  if (!tokens || typeof tokens !== 'string') return GALLERY_FALLBACK_GRADIENT;
  const cleaned = tokens.replace(/\/\d+/g, '');
  return 'bg-gradient-to-br ' + cleaned;
}

function featuredHrefFromPath(path) {
  // Split off the query string / fragment first so trailing-slash
  // normalization doesn't accidentally append `/` after `?...` —
  // e.g. './doom/?flavor=classic' must become '/doom/?flavor=classic'
  // (the slash belongs after the directory, not after the value).
  const m = path.match(/^([^?#]*)(.*)$/);
  const base = (m ? m[1] : path).replace(/^\.\//, '').replace(/\/$/, '');
  const suffix = m ? m[2] : '';
  return '/' + base + '/' + suffix;
}

function renderFeaturedProjects() {
  const grid = document.getElementById('featured-projects-grid');
  if (!grid || typeof AppModule === 'undefined') return;

  const allApps = AppModule.getAllApps();
  const popular = POPULAR_APP_IDS.map((id) => allApps.find((app) => app.id === id)).filter(Boolean);

  grid.innerHTML = '';

  popular.forEach((app) => {
    /** @type {FeaturedConfig | undefined} */
    const f = app.featured;
    const presetKey = f && f.preset && FEATURED_PRESETS[f.preset] ? f.preset : 'doom';
    const preset = FEATURED_PRESETS[presetKey] || FEATURED_PRESETS.doom;
    const tone = preset.tone;
    const titleClass =
      tone === 'dark'
        ? 'text-2xl font-bold mb-2 group-hover:scale-105 transition-transform text-gray-900'
        : 'text-2xl font-bold mb-2 group-hover:scale-105 transition-transform';
    const bodyClass = tone === 'dark' ? 'text-sm text-gray-900/90' : 'text-sm text-white/90';
    const footerClass =
      tone === 'dark' ? 'mt-4 text-xs text-gray-900/70' : 'mt-4 text-xs text-white/70';

    const link = document.createElement('a');
    link.href = featuredHrefFromPath(app.path);
    link.setAttribute('data-event', 'featured_project_click');
    link.setAttribute('data-event-category', 'Engagement');
    link.setAttribute('data-event-label', (f && f.analyticsLabel) || app.shortName || app.name);
    link.className = `${FEATURED_CARD_BASE} ${preset.gradient}`;

    const headline = (f && f.headline) || app.name;
    const blurb = (f && f.blurb) || app.detailedDescription || app.description || '';
    const tagsLine = (f && f.tagsLine) || '';

    link.innerHTML = `
      <div class="text-5xl mb-3">${app.icon || ''}</div>
      <h3 class="${titleClass}">${headline}</h3>
      <p class="${bodyClass}">${blurb}</p>
      <div class="${footerClass}">${tagsLine}</div>
    `;

    grid.appendChild(link);
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
    sectionEl.className = 'gallery-section mb-10';
    sectionEl.setAttribute('aria-labelledby', `gallery-${section.id}`);

    const header = document.createElement('div');
    header.className = 'mb-4';
    header.innerHTML = `
      <h2
        id="gallery-${section.id}"
        class="text-2xl sm:text-3xl font-bold text-white mb-1"
      >${section.title}</h2>
      <p class="text-white/80 text-sm">${section.blurb}</p>
    `;
    sectionEl.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';

    apps.forEach((app) => {
      const card = document.createElement('a');
      card.href = featuredHrefFromPath(app.path);
      card.setAttribute('data-filterable', 'true');
      // Wide search corpus so the filter input finds apps by long
      // description, pwa shortcut name, related ids, and tags — not just
      // the visible name. e.g. "stradella" finds the accordion, "ocr"
      // finds Say It, "ascii" finds Bad Apple.
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
      card.setAttribute('data-event-label', app.shortName || app.name);
      card.className = `gallery-card group relative overflow-hidden rounded-xl p-4 text-white shadow-md hover:shadow-2xl hover:-translate-y-1 transition-all duration-200 ${tailwindGradientFromTokens(
        app.gradient
      )}`;
      const taskbarText = app.taskbarText === 'text-black' ? 'text-gray-900' : 'text-white';
      card.classList.add(taskbarText);
      card.innerHTML = `
        <div class="text-3xl mb-2">${app.icon || '🔹'}</div>
        <div class="font-bold text-sm sm:text-base leading-tight">
          ${app.shortName || app.name}
        </div>
        <div class="text-xs opacity-80 mt-1 leading-snug">
          ${app.description || ''}
        </div>
      `;
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

  const ctrl = AppFilter.create({
    container: root,
    filterInput: input,
    noResultsEl: noResults,
    clearButton: clearBtn,
    getSearchText: (el) => el.getAttribute('data-search') || el.textContent.toLowerCase(),
    onFilter: ({ searchTerm }) => {
      // Hide section headers whose grid is now empty so the page doesn't
      // show a heading like "Games" with nothing under it. Each section
      // is `.gallery-section`; a card is `.gallery-card`.
      root.querySelectorAll('.gallery-section').forEach((sec) => {
        const visible = Array.from(sec.querySelectorAll('.gallery-card')).some(
          (card) => card.style.display !== 'none'
        );
        sec.style.display = visible ? '' : 'none';
      });

      // While the user is filtering, hide the "Popular projects" pin so
      // the filter narrows the whole page. The popular grid is just a
      // duplicate of cards that also appear in the gallery, so showing
      // it during search is confusing.
      if (popularSection) {
        popularSection.style.display = searchTerm ? 'none' : '';
      }
    }
  });
  ctrl.bindKeyboardShortcuts({});

  // Page-level shortcut: pressing "/" focuses the filter input (skipped
  // when the user is already typing in another input/textarea or in
  // contenteditable). Mirrors GitHub/GitLab's filter affordance.
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

tailwind.config = {
  theme: {
    extend: {
      animation: {
        gradient: 'gradient 15s ease infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      },
      keyframes: {
        gradient: {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' }
        }
      }
    }
  }
};

// Hamburger Menu Functionality
function generateHamburgerMenuItems() {
  const menuContainer = document.getElementById('hamburger-app-links');
  const menuItems = AppModule.generateHamburgerMenuItems();

  // Clear existing content
  menuContainer.innerHTML = '';

  // Generate menu items with data-filterable attribute
  menuItems.forEach((app) => {
    const menuItem = document.createElement('a');
    menuItem.href = app.path;
    menuItem.className = `hamburger-app-link flex items-center space-x-3 p-3 rounded-lg bg-gradient-to-r ${app.gradient} border ${app.border} transition-all duration-200 group`;
    menuItem.setAttribute('data-filterable', 'true');
    menuItem.setAttribute(
      'data-search',
      `${app.name} ${app.description} ${app.icon}`.toLowerCase()
    );

    menuItem.innerHTML = `
      <span class="text-2xl">${app.icon}</span>
      <div>
        <div class="text-green-400 font-mono font-bold group-hover:text-green-300">
          ${app.name}
        </div>
        <div class="text-gray-400 text-sm">${app.description}</div>
      </div>
    `;

    menuContainer.appendChild(menuItem);
  });
}

function initHamburgerMenu() {
  // Generate menu items from AppModule
  generateHamburgerMenuItems();

  const hamburgerToggle = document.getElementById('hamburger-toggle');
  const hamburgerPanel = document.getElementById('hamburger-panel');
  const menuClose = document.getElementById('menu-close');
  const filterInput = document.getElementById('hamburger-filter');
  const filterClear = document.getElementById('filter-clear');
  const noResults = document.getElementById('no-results');
  const menuContainer = document.getElementById('hamburger-app-links');

  let isMenuOpen = false;

  // Create shared filter controller
  const filterController = AppFilter.create({
    container: menuContainer,
    filterInput: filterInput,
    noResultsEl: noResults,
    clearButton: filterClear,
    getSearchText: (el) => el.getAttribute('data-search') || el.textContent.toLowerCase()
  });

  // Bind keyboard shortcuts
  filterController.bindKeyboardShortcuts({
    onEscape: () => closeMenu()
  });

  function toggleMenu() {
    isMenuOpen = !isMenuOpen;

    if (isMenuOpen) {
      // Track menu open
      if (window.trackEvent) {
        window.trackEvent('hamburger_menu_open', 'Navigation', 'Main Menu');
      }

      // Open menu
      hamburgerToggle.classList.add('active');
      hamburgerPanel.classList.add('show');

      // Clear filter and focus input
      filterController.reset();

      // Focus the filter input after a short delay for the animation
      setTimeout(() => {
        filterInput.focus();
      }, 300);

      // Add staggered animation to links
      const links = hamburgerPanel.querySelectorAll('.hamburger-app-link');
      links.forEach((link, index) => {
        setTimeout(() => {
          link.style.opacity = '1';
        }, index * 50);
      });
    } else {
      // Track menu close
      if (window.trackEvent) {
        window.trackEvent('hamburger_menu_close', 'Navigation', 'Main Menu');
      }

      // Close menu
      hamburgerToggle.classList.remove('active');
      hamburgerPanel.classList.remove('show');

      // Clear filter
      filterController.reset();

      // Reset link opacity
      const links = hamburgerPanel.querySelectorAll('.hamburger-app-link');
      links.forEach((link) => {
        link.style.opacity = '0';
      });
    }
  }

  function closeMenu() {
    if (isMenuOpen) {
      toggleMenu();
    }
  }

  function attachMenuLinkListeners() {
    // Handle app link clicks with some visual feedback
    const appLinks = hamburgerPanel.querySelectorAll('.hamburger-app-link');

    appLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        // Track the click
        const projectName = link.querySelector('.text-green-400').textContent.trim();
        const projectUrl = link.getAttribute('href');

        if (window.trackEvent) {
          window.trackEvent('hamburger_menu_click', 'Navigation', projectName);
        }
        if (window.trackProjectOpen) {
          window.trackProjectOpen(projectName);
        }

        // Add click animation
        link.style.transform = 'scale(0.95)';
        setTimeout(() => {
          link.style.transform = '';
        }, 150);

        // Close menu after a short delay for better UX
        setTimeout(() => {
          if (isMenuOpen) {
            closeMenu();
          }
        }, 200);
      });
    });
  }

  // Event listeners
  hamburgerToggle.addEventListener('click', toggleMenu);
  menuClose.addEventListener('click', closeMenu);

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (isMenuOpen && !hamburgerToggle.contains(e.target) && !hamburgerPanel.contains(e.target)) {
      closeMenu();
    }
  });

  // Close menu on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMenuOpen) {
      closeMenu();
    }
  });

  // Close menu when window loses focus (for better mobile experience)
  window.addEventListener('blur', closeMenu);

  // Attach listeners to dynamically generated menu items
  attachMenuLinkListeners();
}

// Wire everything up once the DOM is ready. The home page is now an
// apps gallery, so the only legacy bits we still need are the hamburger
// menu (used as the universal launcher across the portfolio) and the
// featured/popular grid.
document.addEventListener('DOMContentLoaded', () => {
  renderFeaturedProjects();
  renderAppGallery();
  bindGalleryFilter();

  initHamburgerMenu();
});
