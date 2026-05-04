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

  const featured = AppModule.getAllApps()
    .filter((app) => app.featured)
    .sort((a, b) => (a.featured.order || 0) - (b.featured.order || 0));

  grid.innerHTML = '';

  featured.forEach((app) => {
    /** @type {FeaturedConfig} */
    const f = app.featured;
    const presetKey = f.preset && FEATURED_PRESETS[f.preset] ? f.preset : 'doom';
    const preset = FEATURED_PRESETS[presetKey];
    const tone = preset.tone;
    const titleClass =
      tone === 'dark'
        ? 'text-2xl font-bold mb-2 group-hover:scale-105 transition-transform text-gray-900'
        : 'text-2xl font-bold mb-2 group-hover:scale-105 transition-transform';
    const bodyClass = tone === 'dark' ? 'text-sm text-gray-900/90' : 'text-sm text-white/90';
    const footerClass = tone === 'dark' ? 'mt-4 text-xs text-gray-900/70' : 'mt-4 text-xs text-white/70';

    const link = document.createElement('a');
    link.href = featuredHrefFromPath(app.path);
    link.setAttribute('data-event', 'featured_project_click');
    link.setAttribute('data-event-category', 'Engagement');
    link.setAttribute('data-event-label', f.analyticsLabel || app.shortName || app.name);
    link.className = `${FEATURED_CARD_BASE} ${preset.gradient}`;

    link.innerHTML = `
      <div class="text-5xl mb-3">${app.icon || ''}</div>
      <h3 class="${titleClass}">${f.headline || app.name}</h3>
      <p class="${bodyClass}">${f.blurb || app.detailedDescription || ''}</p>
      <div class="${footerClass}">${f.tagsLine || ''}</div>
    `;

    grid.appendChild(link);
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
// Dynamic fun facts with calculated experience
function getFunFacts() {
  const startYear = 2006;
  const currentYear = new Date().getFullYear();
  const yearsExperience = currentYear - startYear;

  return [
    '🚀 Currently crafting Trust & Safety UI at Roblox',
    "🎬 Aruba commercial star: 'Take it to the cloud!'",
    '🎯 Patent inventor for wireless RF visualization',
    '🏕️ Former Boy Scout Cubmaster in Campbell, CA',
    '🔧 Open source contributor & emacs wizard',
    '🎓 UCSB Computer Science graduate',
    '☁️ 7+ years building ML platforms at Cloudera',
    '🦄 Campbell, CA based unicorn engineer',
    '💻 High bar for code quality advocate',
    '🎮 Trust & Safety platform UI architect',
    `🔮 Turning coffee into code for ${yearsExperience}+ years`
  ];
}

const funFacts = getFunFacts();

let currentFactIndex = 0;
function changeFunFact() {
  currentFactIndex = (currentFactIndex + 1) % funFacts.length;
  document.querySelector('.fun-fact').textContent = funFacts[currentFactIndex];
}

// Easter egg functionality
// Easter egg function - may be called from HTML
function triggerEasterEgg() {
  // Create floating unicorns and tech emojis
  const emojis = ['🦄', '🚀', '⭐', '💫', '🌟', '✨', '🎉', '🎊', '💻', '🎮'];

  for (let i = 0; i < 25; i++) {
    setTimeout(() => {
      const emoji = document.createElement('div');
      emoji.className = 'fixed text-4xl pointer-events-none z-50 animate-bounce';
      emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      emoji.style.left = Math.random() * window.innerWidth + 'px';
      emoji.style.top = Math.random() * window.innerHeight + 'px';
      emoji.style.animationDuration = Math.random() * 3 + 2 + 's';
      document.body.appendChild(emoji);

      setTimeout(() => {
        emoji.remove();
      }, 5000);
    }, i * 100);
  }

  // Change page title temporarily
  const originalTitle = document.title;
  document.title = '🦄✨ UNICORN MAGIC ACTIVATED! ✨🦄';
  setTimeout(() => {
    document.title = originalTitle;
  }, 3000);

  // Animate the hero section
  const hero = document.querySelector('.hero-bg');
  hero.classList.add('animate-pulse');
  setTimeout(() => {
    hero.classList.remove('animate-pulse');
  }, 3000);
}

// Auto-change fun facts every 6 seconds
setInterval(changeFunFact, 6000);

// Calculate years of experience dynamically
function calculateYearsExperience() {
  const startYear = 2006; // Started at Opsware in August 2006
  const currentYear = new Date().getFullYear();
  const yearsExperience = currentYear - startYear;

  document.getElementById('years-experience').textContent = `${yearsExperience}+ years`;
}

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

// Add some sparkle animation to cards on load
document.addEventListener('DOMContentLoaded', () => {
  // Calculate experience on page load
  calculateYearsExperience();

  renderFeaturedProjects();

  // Initialize hamburger menu
  initHamburgerMenu();

  // Setup "View All Projects" button to open hamburger menu
  const viewAllBtn = document.getElementById('view-all-projects-btn');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent the click from bubbling to document
      const hamburgerToggle = document.getElementById('hamburger-toggle');
      if (hamburgerToggle) {
        hamburgerToggle.click();
      }
    });
  }

  const cards = document.querySelectorAll('.group');
  cards.forEach((card, index) => {
    setTimeout(() => {
      card.classList.add('animate-pulse');
      setTimeout(() => {
        card.classList.remove('animate-pulse');
      }, 1000);
    }, index * 200);
  });
});
