// Application Configuration Module for HEYMING-OS
// Central configuration for all available applications

// Main application registry
let appRegistry = [
  {
    id: 'awesome',
    name: 'Everything is Awesome 🎉',
    shortName: 'Awesome',
    description: 'Pure joy in digital form',
    detailedDescription: 'Pure joy with music, animations, and good vibes!',
    icon: '🎉',
    path: './awesome/',
    category: 'entertainment',
    gradient: 'from-yellow-500/20 to-orange-500/20',
    border: 'border-yellow-500/30 hover:border-yellow-400/50',
    taskbarGradient: 'from-yellow-400 to-orange-500',
    taskbarText: 'text-black',
    desktopIcon: true,
    tags: ['fun', 'music', 'popular', 'interactive']
  },
  {
    id: 'doom',
    name: 'Doom 💀',
    shortName: 'Doom',
    description: 'Classic first-person shooter',
    detailedDescription: 'Classic FPS with WebAssembly. Full gameplay, music & sound.',
    icon: '💀',
    path: './doom/',
    category: 'game',
    defaultWidth: 1024,
    defaultHeight: 768,
    desktopIcon: true,
    tags: ['fps', 'retro', 'popular', 'wasm']
  },
  {
    id: 'farm',
    name: 'Farm Adventures 🚜',
    shortName: 'Farm',
    description: 'Digital agriculture adventures',
    detailedDescription: 'Digital farming experience',
    icon: '🚜',
    path: './farm/',
    category: 'game',
    gradient: 'from-green-500/20 to-emerald-500/20',
    border: 'border-green-500/30 hover:border-green-400/50',
    taskbarGradient: 'from-green-400 to-emerald-500',
    taskbarText: 'text-white',
    desktopIcon: true
  },
  {
    id: 'notepad',
    name: 'Notepad 📝',
    shortName: 'Notepad',
    description: 'Simple text editor',
    detailedDescription: 'A simple text editor for taking notes',
    icon: '📝',
    path: './notepad/',
    category: 'utility',
    gradient: 'from-blue-500/20 to-indigo-500/20',
    border: 'border-blue-500/30 hover:border-blue-400/50',
    taskbarGradient: 'from-blue-400 to-indigo-500',
    taskbarText: 'text-white',
    defaultWidth: 600,
    defaultHeight: 400,
    system: true,
    desktopIcon: true,
    desktopPosition: { x: 30, y: 230 },
    // MIME types this app can handle
    handles: [
      'text/*',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/x-sh'
    ]
  },
  {
    id: 'pacman',
    name: 'Pac-Man 👻',
    shortName: 'Pac-Man',
    description: 'Classic arcade game',
    detailedDescription: 'Classic 3D arcade game - eat pellets, avoid ghosts, chase high scores!',
    icon: '👻',
    path: './pacman/',
    category: 'game',
    gradient: 'from-yellow-400/20 to-yellow-600/20',
    border: 'border-yellow-500/30 hover:border-yellow-400/50',
    taskbarGradient: 'from-yellow-400 to-yellow-600',
    taskbarText: 'text-black',
    defaultWidth: 900,
    defaultHeight: 700,
    tags: ['arcade', 'retro', 'popular', '3d']
  },
  {
    id: 'periodic-speller',
    name: 'Periodic Speller ⚛️',
    shortName: 'Periodic',
    description: 'Spell words with element symbols',
    detailedDescription: 'Spell words using periodic table element symbols. Export as PNG.',
    icon: '⚛️',
    path: './periodic-speller/',
    category: 'utility',
    gradient: 'from-cyan-500/20 to-blue-500/20',
    border: 'border-cyan-500/30 hover:border-cyan-400/50',
    taskbarGradient: 'from-cyan-500 to-blue-500',
    taskbarText: 'text-white',
    defaultWidth: 800,
    defaultHeight: 600,
    tags: ['science', 'chemistry', 'fun', 'export']
  },
  {
    id: 'pbs',
    name: 'Pirate Broadcast System 🏴‍☠️',
    shortName: 'Pirates',
    description: 'Ahoy! Interactive pirate fun',
    detailedDescription: 'Arrr! Pirate broadcast system',
    icon: '🏴‍☠️',
    path: './pbs/',
    category: 'entertainment',
    gradient: 'from-red-500/20 to-pink-500/20',
    border: 'border-red-500/30 hover:border-red-400/50',
    taskbarGradient: 'from-red-500 to-pink-500',
    taskbarText: 'text-white'
  },
  {
    id: 'sadtrombone',
    name: 'Sad Trombone 🎺',
    shortName: 'Sad Trombone',
    description: 'For those "oops" moments',
    detailedDescription: 'For those disappointing moments',
    icon: '🎺',
    path: './sadtrombone/',
    category: 'utility',
    gradient: 'from-amber-500/20 to-yellow-500/20',
    border: 'border-amber-500/30 hover:border-amber-400/50',
    taskbarGradient: 'from-amber-400 to-yellow-500',
    taskbarText: 'text-black'
  },
  {
    id: 'sayhello',
    name: 'Say Hello 👋',
    shortName: 'Say Hello',
    description: 'Speech synthesis magic',
    detailedDescription: 'Text-to-speech greetings',
    icon: '👋',
    path: './sayhello/',
    category: 'utility',
    gradient: 'from-purple-500/20 to-indigo-500/20',
    border: 'border-purple-500/30 hover:border-purple-400/50',
    taskbarGradient: 'from-purple-500 to-indigo-500',
    taskbarText: 'text-white'
  },
  {
    id: 'sayit',
    name: 'Say It 🗣️',
    shortName: 'Say It',
    description: 'Text-to-speech experiments',
    detailedDescription: 'Advanced text-to-speech',
    icon: '🗣️',
    path: './sayit/',
    category: 'utility',
    gradient: 'from-indigo-500/20 to-blue-600/20',
    border: 'border-indigo-500/30 hover:border-indigo-400/50',
    taskbarGradient: 'from-indigo-500 to-blue-600',
    taskbarText: 'text-white'
  },
  {
    id: 'stepmania',
    name: 'Stepmania 💃',
    shortName: 'Stepmania',
    description: 'Rhythm game excellence',
    detailedDescription: 'Rhythm game experience',
    icon: '💃',
    path: './stepmania/',
    category: 'game',
    defaultWidth: 1000,
    defaultHeight: 700,
    gradient: 'from-pink-500/20 to-rose-500/20',
    border: 'border-pink-500/30 hover:border-pink-400/50',
    taskbarGradient: 'from-pink-500 to-rose-500',
    taskbarText: 'text-white'
  },
  {
    id: 'wordle-finder',
    name: 'Wordle Finder 🔤',
    shortName: 'Wordle',
    description: 'Word puzzle solving tools',
    detailedDescription: 'Wordle puzzle solver',
    icon: '🔤',
    path: './wordle-finder/',
    category: 'utility',
    defaultWidth: 800,
    defaultHeight: 600,
    gradient: 'from-teal-500/20 to-cyan-500/20',
    border: 'border-teal-500/30 hover:border-teal-400/50',
    taskbarGradient: 'from-teal-500 to-cyan-500',
    taskbarText: 'text-white',
    desktopIcon: true
  },
  {
    id: 'youtube',
    name: 'JoeTube 🎥',
    shortName: 'JoeTube',
    description: "Joe's digital adventures & coding magic",
    detailedDescription: 'Watch JoeTube',
    icon: '🎥',
    path: './youtube/',
    category: 'utility',
    gradient: 'from-red-500/20 to-red-600/20',
    border: 'border-red-500/30 hover:border-red-400/50',
    taskbarGradient: 'from-red-500 to-red-600',
    taskbarText: 'text-white',
    defaultWidth: 540,
    defaultHeight: 780
  },
  {
    id: 'shadowbox',
    name: 'Shadowbox 🕵️',
    shortName: 'Shadowbox',
    description: 'Classified surveillance mode',
    detailedDescription: 'Classified surveillance mode',
    icon: '🕵️',
    path: './shadowbox/',
    category: 'utility',
    gradient: 'from-gray-600/20 to-gray-700/20',
    border: 'border-gray-500/30 hover:border-gray-400/50',
    taskbarGradient: 'from-gray-600 to-gray-700',
    taskbarText: 'text-white'
  },
  {
    id: 'badapple',
    name: 'Bad Apple',
    shortName: 'Bad Apple',
    description: 'Bad Apple',
    detailedDescription: 'Bad Apple',
    icon: '🍎',
    path: './badapple/',
    category: 'entertainment',
    gradient: 'from-red-500/20 to-pink-500/20',
    border: 'border-red-500/30 hover:border-red-400/50',
    taskbarGradient: 'from-red-500 to-pink-500',
    taskbarText: 'text-white'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    shortName: 'Terminal',
    description: 'Command line interface',
    detailedDescription: 'Interactive command line with filesystem. Type "help" to explore!',
    icon: '💻',
    path: './terminal/',
    category: 'utility',
    gradient: 'from-gray-500/20 to-gray-700/20',
    border: 'border-gray-500/30 hover:border-gray-400/50',
    taskbarGradient: 'from-gray-500 to-gray-700',
    taskbarText: 'text-white',
    system: true,
    desktopIcon: true,
    desktopPosition: { x: 30, y: 30 },
    tags: ['utility', 'cli', 'filesystem', 'interactive']
  },
  {
    id: 'todo',
    name: 'Todo ✅',
    shortName: 'Todo',
    description: 'Google Sheets task lists',
    detailedDescription:
      'Sign in with Google and manage todos in your spreadsheet—multiple lists (tabs), rename, add, and remove tasks.',
    icon: '✅',
    path: './todo/',
    category: 'utility',
    gradient: 'from-violet-500/20 to-fuchsia-500/20',
    border: 'border-violet-500/30 hover:border-fuchsia-400/50',
    taskbarGradient: 'from-violet-500 to-fuchsia-600',
    taskbarText: 'text-white',
    defaultWidth: 440,
    defaultHeight: 720,
    desktopIcon: true,
    tags: ['productivity', 'google', 'sheets', 'tasks']
  },
  {
    id: 'calculator',
    name: 'Calculator',
    shortName: 'Calculator',
    description: 'Calculator',
    detailedDescription: 'Calculator',
    icon: '🔢',
    path: './calculator/',
    category: 'utility',
    system: true,
    desktopIcon: true,
    desktopPosition: { x: 30, y: 130 }
  },
  {
    id: 'countdown',
    name: 'Countdown ⏱️',
    shortName: 'Countdown',
    description: 'Event countdown timer',
    detailedDescription: 'Track events with style. Multiple display modes & animations.',
    icon: '⏱️',
    path: './countdown/',
    category: 'utility',
    gradient: 'from-amber-500/20 to-orange-500/20',
    border: 'border-amber-500/30 hover:border-amber-400/50',
    taskbarGradient: 'from-amber-500 to-orange-500',
    taskbarText: 'text-black',
    defaultWidth: 900,
    defaultHeight: 700,
    tags: ['utility', 'time', 'events', 'timer']
  },
  {
    id: 'programming-advice',
    name: 'Programming Wisdom 💡',
    shortName: 'Wisdom',
    description: 'Click anywhere for instant wisdom',
    detailedDescription:
      '230+ pieces of programming wisdom from legendary developers like Linus Torvalds, Rich Hickey, Uncle Bob, and more. Simple one-click interface. Every quote properly attributed with source links.',
    icon: '💡',
    path: './programming-advice/',
    category: 'utility',
    gradient: 'from-purple-500/20 to-indigo-500/20',
    border: 'border-purple-500/30 hover:border-purple-400/50',
    taskbarGradient: 'from-purple-500 to-indigo-500',
    taskbarText: 'text-white',
    defaultWidth: 900,
    defaultHeight: 700,
    tags: ['wisdom', 'learning', 'advice', 'quotes', 'developers'],
    desktopIcon: true
  },
  {
    id: 'minesweeper',
    name: 'Minesweeper 💣',
    shortName: 'Minesweeper',
    description: 'Classic puzzle game',
    detailedDescription:
      'Clear the minefield without detonating mines - Windows classic with modern UI!',
    icon: '💣',
    path: './minesweeper/',
    category: 'game',
    gradient: 'from-gray-500/20 to-slate-600/20',
    border: 'border-gray-500/30 hover:border-gray-400/50',
    taskbarGradient: 'from-gray-500 to-slate-600',
    taskbarText: 'text-white',
    defaultWidth: 400,
    defaultHeight: 500,
    tags: ['puzzle', 'strategy', 'retro', 'classic']
  },
  {
    id: 'nes',
    name: 'NES',
    shortName: 'NES',
    description: 'NES emulator',
    detailedDescription: 'NES emulator',
    icon: '🕹️',
    path: './nes/',
    category: 'game'
  },
  {
    id: 'vibe-coding',
    name: 'Vibe Coding 🤖',
    shortName: 'Vibe Coding',
    description: "The art of building websites that don't suck",
    detailedDescription:
      'Stop building shitty websites. Learn vibe coding - the art of creating fast, beautiful, accessible sites without the bullshit.',
    icon: '🤖',
    path: './vibe-coding/',
    category: 'utility',
    gradient: 'from-purple-500/20 to-indigo-500/20',
    border: 'border-purple-500/30 hover:border-purple-400/50',
    taskbarGradient: 'from-purple-500 to-indigo-500',
    taskbarText: 'text-white',
    defaultWidth: 800,
    defaultHeight: 600
  },
  {
    id: 'filemanager',
    name: 'File Manager 📂',
    shortName: 'Files',
    description: 'Browse your filesystem',
    detailedDescription: 'File manager with shared IndexedDB filesystem',
    icon: '📂',
    path: './filemanager/',
    category: 'utility',
    gradient: 'from-amber-500/20 to-yellow-500/20',
    border: 'border-amber-500/30 hover:border-amber-400/50',
    taskbarGradient: 'from-amber-500 to-yellow-500',
    taskbarText: 'text-black',
    defaultWidth: 900,
    defaultHeight: 600,
    desktopIcon: true,
    system: true
  },
  {
    id: 'media-player',
    name: 'Media Player 🎵',
    shortName: 'Media',
    description: 'Play video and audio files',
    detailedDescription: 'HTML5 media player for video (MP4, WebM) and audio (MP3, WAV, OGG)',
    icon: '🎵',
    path: './media-player/',
    category: 'utility',
    gradient: 'from-rose-500/20 to-pink-500/20',
    border: 'border-rose-500/30 hover:border-rose-400/50',
    taskbarGradient: 'from-rose-500 to-pink-500',
    taskbarText: 'text-white',
    defaultWidth: 800,
    defaultHeight: 500,
    system: true,
    // MIME types this app can handle
    handles: ['video/*', 'audio/*', 'application/x-youtube']
  },
  {
    id: 'image-viewer',
    name: 'Image Viewer 🖼️',
    shortName: 'Images',
    description: 'View image files',
    detailedDescription: 'Image viewer with zoom, pan, and rotate for PNG, JPG, GIF, WebP, SVG',
    icon: '🖼️',
    path: './image-viewer/',
    category: 'utility',
    gradient: 'from-cyan-500/20 to-blue-500/20',
    border: 'border-cyan-500/30 hover:border-cyan-400/50',
    taskbarGradient: 'from-cyan-500 to-blue-500',
    taskbarText: 'text-white',
    defaultWidth: 800,
    defaultHeight: 600,
    system: true,
    // MIME types this app can handle
    handles: ['image/*']
  }
];

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

      clear() {
        if (filterInput) {
          filterInput.value = '';
        }
        this.filter('');
        if (filterInput) {
          filterInput.focus();
        }
      },

      reset() {
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
              const first = this.getFirstVisible();
              if (first) {
                if (onEnter) {
                  onEnter(first);
                } else {
                  first.click();
                }
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const first = this.getFirstVisible();
              if (first) {
                first.focus();
              }
            }
          });

          // Bind input event
          filterInput.addEventListener('input', (e) => {
            this.filter(e.target.value);
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
  // Get all apps
  getAllApps: () => appRegistry,

  // Get app by ID
  getApp: (appId) => appRegistry[appId],

  // Get apps by category
  getAppsByCategory: (category) => {
    return AppModule.getAllApps().filter((app) => app.category === category);
  },

  // Get app categories
  getCategories: () => appCategories,

  // Get app IDs
  getAppIds: () => Object.keys(appRegistry),

  // Check if app exists
  hasApp: (appId) => appId in appRegistry,

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
   * Get the app that handles a given MIME type
   * Apps register their supported types via the 'handles' array
   * Supports wildcards like 'image/*' and 'text/*'
   * @param {string} mimeType - The MIME type to find a handler for
   * @returns {{ appId: string, appName: string } | null} App info or null if no handler
   */
  getAppForMimeType: (mimeType) => {
    if (!mimeType) return null;

    const [type, subtype] = mimeType.split('/');

    for (const app of appRegistry) {
      if (!app.handles) continue;

      for (const pattern of app.handles) {
        // Exact match
        if (pattern === mimeType) {
          return { appId: app.id, appName: app.name };
        }
        // Wildcard match (e.g., 'image/*' matches 'image/png')
        if (pattern.endsWith('/*')) {
          const patternType = pattern.slice(0, -2);
          if (type === patternType) {
            return { appId: app.id, appName: app.name };
          }
        }
      }
    }

    return null;
  }
};

// Export for module usage (if using ES6 modules)
// export default AppModule;

// Global namespace for direct script inclusion
window.AppModule = AppModule;

// Backward compatibility exports
window.availableApps = AppModule.getTaskbarApps();
window.appConfig = AppModule.getWindowConfig();
