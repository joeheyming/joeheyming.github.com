/**
 * Heyming OS - App Launcher (Start Menu)
 * Handles the application launcher menu
 */

import { Constants } from './constants.js';

export class Launcher {
  constructor(onLaunchApp) {
    this.onLaunchApp = onLaunchApp;
    this.visible = false;
    this.availableApps = [];
    this.filter = null;
    this.C = Constants;

    // DOM elements - populated in init()
    this.menu = null;
    this.launcherButton = null;
    this.container = null;
    this.filterInput = null;
    this.noResultsEl = null;
  }

  /**
   * Initialize the launcher with apps from registry
   */
  init() {
    this.menu = document.getElementById('app-launcher-menu');
    this.launcherButton = document.getElementById('app-launcher');
    this.container = /** @type {HTMLElement|null} */ (
      document.getElementById('launcher-apps-container')
    );
    this.filterInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('launcher-filter')
    );
    this.noResultsEl = document.getElementById('launcher-no-results');

    this.menu?.setAttribute('aria-hidden', 'true');

    this._ensureAppModuleAndPopulate();
    this._initFilter();
  }

  /**
   * Toggle launcher visibility
   */
  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Show the launcher
   */
  show() {
    if (!this.menu) return;

    this.menu.classList.remove('hidden', 'hide');
    this.menu.classList.add('show');
    this.menu.setAttribute('aria-hidden', 'false');
    this.visible = true;
    this.launcherButton?.setAttribute('aria-expanded', 'true');

    // Clear and focus filter
    if (this.filter) {
      this.filter.reset();
      setTimeout(() => this.filterInput?.focus(), 100);
    }

    this._animateAppItems();
  }

  /**
   * Hide the launcher
   */
  hide() {
    if (!this.menu) return;

    this.menu.classList.remove('show');
    this.menu.classList.add('hide');
    this.menu.setAttribute('aria-hidden', 'true');
    this.visible = false;
    this.launcherButton?.setAttribute('aria-expanded', 'false');

    setTimeout(() => {
      if (!this.visible) {
        this.menu.classList.add('hidden');
        this.menu.classList.remove('hide');
        this._resetAppItemsAnimation();
        if (this.filter) {
          this.filter.reset();
        }
      }
    }, Constants.ANIMATION_DURATION);
  }

  /**
   * Check if launcher is visible
   */
  isVisible() {
    return this.visible;
  }

  // ========== Private Methods ==========

  _ensureAppModuleAndPopulate() {
    if (typeof window.AppModule === 'undefined' || !window.__heymingAppRegistryReady) {
      console.error(
        '[Launcher] AppModule not ready — ensure mime-handlers.js and app.js load before the OS module.'
      );
      return;
    }
    this.availableApps = window.AppModule.getAllApps();
    this._updateMenu();
  }

  _initFilter() {
    if (!this.filterInput || !this.container || !window.AppFilter) return;

    this.filter = window.AppFilter.create({
      container: this.container,
      filterInput: this.filterInput,
      noResultsEl: this.noResultsEl,
      getSearchText: (el) => el.getAttribute('data-search') || el.textContent.toLowerCase(),
      onFilter: ({ searchTerm }) => {
        const separator = /** @type {HTMLElement|null} */ (
          this.container.querySelector('.launcher-separator')
        );
        const categoryHeaders = this.container.querySelectorAll('.launcher-category-header');

        if (searchTerm) {
          if (separator) separator.style.display = 'none';
          categoryHeaders.forEach((h) => {
            /** @type {HTMLElement} */ (h).style.display = 'none';
          });
        } else {
          if (separator) separator.style.display = '';
          categoryHeaders.forEach((h) => {
            /** @type {HTMLElement} */ (h).style.display = '';
          });
        }
      }
    });

    this.filter.bindKeyboardShortcuts({
      onEscape: () => this.hide(),
      onEnter: (firstVisible) => {
        const appId = firstVisible.getAttribute('data-app');
        if (appId) {
          this.onLaunchApp(appId);
          this.hide();
        }
      }
    });
  }

  _updateMenu() {
    if (!this.container || !this.availableApps) return;

    this.container.innerHTML = '';

    // Add system apps from registry
    const systemApps = window.AppModule?.getSystemApps() || [];
    systemApps.forEach((app) => {
      const searchText = `${app.shortName} ${app.name} ${app.category} ${app.icon}`.toLowerCase();
      const button = this._createAppButton(app.id, app.icon, app.shortName, searchText);
      this.container.appendChild(button);
    });

    // Add separator
    const separator = document.createElement('div');
    separator.className = 'border-t border-hairline my-2 launcher-separator';
    this.container.appendChild(separator);

    // Get non-system apps
    const nonSystemApps = window.AppModule?.getNonSystemApps() || [];

    // Group apps by category
    const categories = {};
    nonSystemApps.forEach((app) => {
      if (!categories[app.category]) {
        categories[app.category] = [];
      }
      categories[app.category].push(app);
    });

    // Sort apps within each category
    Object.keys(categories).forEach((category) => {
      categories[category].sort((a, b) => a.shortName.localeCompare(b.shortName));
    });

    // Add categorized apps
    this.C.CATEGORY_ORDER.forEach((category) => {
      if (!categories[category]) return;

      // Category header
      const header = document.createElement('div');
      header.className =
        'text-text-3 text-xs font-bold uppercase tracking-wide px-3 py-1 mt-3 mb-1 launcher-category-header';
      header.setAttribute('data-category', category);
      header.textContent = this.C.CATEGORY_NAMES[category] || category;
      this.container.appendChild(header);

      // Apps in category
      categories[category].forEach((app) => {
        const searchText = `${app.shortName} ${app.name} ${app.category} ${app.icon}`.toLowerCase();
        const button = this._createAppButton(app.id, app.icon, app.shortName, searchText, category);
        this.container.appendChild(button);
      });
    });

    if (this.visible) {
      setTimeout(() => this._animateAppItems(), 50);
    }
  }

  _createAppButton(appId, icon, name, searchText, category = null) {
    const button = document.createElement('button');
    button.className =
      'app-item w-full text-left px-3 py-2 text-text-1 hover:bg-surface-2 rounded transition-colors duration-200';
    button.setAttribute('data-app', appId);
    button.setAttribute('data-filterable', 'true');
    button.setAttribute('data-search', searchText);
    if (category) {
      button.setAttribute('data-category', category);
    }
    button.innerHTML = `${icon} ${name}`;

    button.addEventListener('click', () => {
      this.onLaunchApp(appId);
      this.hide();
    });

    return button;
  }

  _animateAppItems() {
    if (!this.menu) return;
    const items = this.menu.querySelectorAll('.app-item');
    items.forEach((item, index) => {
      /** @type {HTMLElement} */ (item).style.setProperty('--item-index', index.toString());
      item.classList.remove('animated');
      void (/** @type {HTMLElement} */ (item).offsetWidth);
      item.classList.add('animated');
    });
  }

  _resetAppItemsAnimation() {
    if (!this.menu) return;
    const items = this.menu.querySelectorAll('.app-item');
    items.forEach((item) => {
      item.classList.remove('animated');
      /** @type {HTMLElement} */ (item).style.removeProperty('--item-index');
    });
  }
}
