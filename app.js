// Application Configuration Module for HEYMING-OS
// Application list is loaded from apps-registry.json (sync XHR; use http-server for local dev).

function loadAppRegistrySync() {
  try {
    const url =
      typeof document !== 'undefined' && document.currentScript && document.currentScript.src
        ? new URL('apps-registry.json', document.currentScript.src).href
        : '/apps-registry.json';
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    const ok = xhr.status === 200 || xhr.status === 304 || xhr.status === 0;
    if (!ok) {
      console.error('[AppModule] Failed to load apps-registry.json', xhr.status, url);
      return [];
    }
    const data = JSON.parse(xhr.responseText);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[AppModule] apps-registry.json load/parse error', e);
    return [];
  }
}

let appRegistry = loadAppRegistrySync();

// sort appRegistry by name
appRegistry = appRegistry.sort((a, b) => a.name.localeCompare(b.name));

// App categories for organization
const appCategories = {
  game: {
    name: 'Games',
    icon: '🎮',
    description: 'Interactive entertainment applications'
  },
  utility: {
    name: 'Utilities',
    icon: '🛠️',
    description: 'Useful tools and utilities'
  },
  entertainment: {
    name: 'Entertainment',
    icon: '🎪',
    description: 'Fun and entertaining applications'
  }
};

// Shared App Filter utility
const AppFilter = {
  /**
   * Create a filterable app list manager
   * @param {Object} config - Configuration object
   * @param {HTMLElement} config.container - Container element for app items
   * @param {HTMLElement} config.filterInput - Filter input element
   * @param {HTMLElement} config.noResultsEl - "No results" message element (optional)
   * @param {HTMLElement} config.clearButton - Clear filter button (optional)
   * @param {Function} config.getSearchText - Function to extract search text from an element
   * @param {Function} config.onFilter - Callback after filtering (optional)
   * @returns {Object} - Filter controller with methods
   */
  create(config) {
    const { container, filterInput, noResultsEl, clearButton, getSearchText, onFilter } = config;

    const controller = {
      filterTimer: null,
      pendingSearchTerm: null,

      filter(searchTerm) {
        const term = (searchTerm || '').toLowerCase().trim();
        const items = container.querySelectorAll('[data-filterable="true"]');
        let visibleCount = 0;

        items.forEach((item) => {
          const searchText = getSearchText ? getSearchText(item) : item.textContent.toLowerCase();
          const matches = !term || searchText.includes(term);

          if (matches) {
            item.style.display = '';
            visibleCount++;
          } else {
            item.style.display = 'none';
          }
        });

        // Handle no results message
        if (noResultsEl) {
          noResultsEl.classList.toggle('hidden', visibleCount > 0 || !term);
        }

        // Handle clear button visibility
        if (clearButton) {
          clearButton.classList.toggle('hidden', !term);
        }

        // Call optional callback
        if (onFilter) {
          onFilter({ visibleCount, searchTerm: term });
        }

        return visibleCount;
      },

      scheduleFilter(searchTerm) {
        this.pendingSearchTerm = searchTerm;
        if (this.filterTimer) clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(() => {
          this.filterTimer = null;
          const pending = this.pendingSearchTerm;
          this.pendingSearchTerm = null;
          this.filter(pending);
        }, 120);
      },

      flushScheduledFilter() {
        if (!this.filterTimer) return;
        clearTimeout(this.filterTimer);
        this.filterTimer = null;
        const pending = this.pendingSearchTerm;
        this.pendingSearchTerm = null;
        this.filter(pending);
      },

      cancelScheduledFilter() {
        if (this.filterTimer) clearTimeout(this.filterTimer);
        this.filterTimer = null;
        this.pendingSearchTerm = null;
      },

      clear() {
        this.cancelScheduledFilter();
        if (filterInput) {
          filterInput.value = '';
        }
        this.filter('');
        if (filterInput) {
          filterInput.focus();
        }
      },

      reset() {
        this.cancelScheduledFilter();
        if (filterInput) {
          filterInput.value = '';
        }
        this.filter('');
      },

      getFirstVisible() {
        return container.querySelector('[data-filterable="true"]:not([style*="display: none"])');
      },

      // Bind standard keyboard shortcuts
      bindKeyboardShortcuts(options = {}) {
        const { onEscape, onEnter } = options;

        if (filterInput) {
          filterInput.addEventListener('keydown', (e) => {
            // Ignore bare Meta key press (used for OS-level shortcuts like opening start menu)
            // But allow Meta+key combos like Cmd+A (select all), Cmd+C (copy), etc.
            if (e.key === 'Meta') {
              e.stopPropagation();
              return;
            }

            if (e.key === 'Escape') {
              if (filterInput.value) {
                e.stopPropagation();
                this.clear();
              } else if (onEscape) {
                onEscape();
              }
            } else if (e.key === 'Enter') {
              this.flushScheduledFilter();
              const first = this.getFirstVisible();
              if (first) {
                if (onEnter) {
                  onEnter(first);
                } else {
                  first.click();
                }
              }
            } else if (e.key === 'ArrowDown') {
              this.flushScheduledFilter();
              e.preventDefault();
              const first = this.getFirstVisible();
              if (first) {
                first.focus();
              }
            }
          });

          // Bind input event
          filterInput.addEventListener('input', (e) => {
            this.scheduleFilter(e.target.value);
          });
        }

        // Bind clear button
        if (clearButton) {
          clearButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clear();
          });
        }
      }
    };

    return controller;
  }
};

// Expose globally
window.AppFilter = AppFilter;

// App module namespace
const AppModule = {
  /** Resolves when the registry and AppModule are safe to read (sync load today). */
  ready: Promise.resolve(),

  // Get all apps
  getAllApps: () => appRegistry,

  // Get app by ID
  getApp: (appId) => appRegistry.find((app) => app.id === appId),

  // Get apps by category
  getAppsByCategory: (category) => {
    return AppModule.getAllApps().filter((app) => app.category === category);
  },

  // Get app categories
  getCategories: () => appCategories,

  // Get app IDs
  getAppIds: () => appRegistry.map((app) => app.id),

  // Check if app exists
  hasApp: (appId) => appRegistry.some((app) => app.id === appId),

  // Get apps for taskbar (existing format for backward compatibility)
  getTaskbarApps: () => {
    const apps = {};
    AppModule.getAllApps().forEach((app) => {
      apps[app.id] = {
        name: app.name,
        description: app.description
      };
    });
    return apps;
  },

  // Get app config for window system (existing format for backward compatibility)
  getWindowConfig: () => {
    const config = {};
    AppModule.getAllApps().forEach((app) => {
      config[app.id] = {
        title: app.name,
        icon: app.icon
      };
    });
    return config;
  },

  // Generate hamburger menu items
  generateHamburgerMenuItems: () => {
    return AppModule.getAllApps()
      .slice() // Create a copy to avoid modifying the original array
      .sort((a, b) => a.shortName.localeCompare(b.shortName))
      .map((app) => ({
        id: app.id,
        name: app.shortName,
        description: app.detailedDescription,
        icon: app.icon,
        path: app.path,
        gradient: app.gradient,
        border: app.border
      }));
  },

  // Get system apps (pinned to start menu, context menu, etc.)
  getSystemApps: () => {
    return AppModule.getAllApps().filter((app) => app.system === true);
  },

  // Get apps with desktop icons
  getDesktopApps: () => {
    return AppModule.getAllApps().filter((app) => app.desktopIcon === true);
  },

  // Get non-system apps (for launcher categories)
  getNonSystemApps: () => {
    return AppModule.getAllApps().filter((app) => app.system !== true);
  },

  /**
   * All apps that handle a MIME type, with exact matches listed before wildcard matches.
   * @param {string} mimeType
   * @returns {Array<{ appId: string, appName: string, shortName: string, icon: string }>}
   */
  getAppsForMimeType: (mimeType) => {
    if (window.MimeHandlers && typeof window.MimeHandlers.getAppsForMimeType === 'function') {
      return window.MimeHandlers.getAppsForMimeType(mimeType, appRegistry);
    }
    return [];
  },

  /**
   * Get the app that handles a given MIME type
   * Apps register their supported types via the 'handles' array
   * Supports wildcards like 'image/*' and 'text/*'
   * @param {string} mimeType - The MIME type to find a handler for
   * @returns {{ appId: string, appName: string } | null} App info or null if no handler
   */
  getAppForMimeType: (mimeType) => {
    const apps = AppModule.getAppsForMimeType(mimeType);
    if (!apps.length) return null;
    return { appId: apps[0].appId, appName: apps[0].appName };
  }
};

// Export for module usage (if using ES6 modules)
// export default AppModule;

// Global namespace for direct script inclusion
window.AppModule = AppModule;
window.__heymingAppRegistryReady = true;

// Backward compatibility exports
window.availableApps = AppModule.getTaskbarApps();
window.appConfig = AppModule.getWindowConfig();
