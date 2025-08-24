// Application Configuration Module for HEYMING-OS
// Central configuration for all available applications

// Main application registry
const appRegistry = [
  {
    id: 'awesome',
    name: 'Everything is Awesome 🎉',
    shortName: 'Awesome',
    description: 'Pure joy in digital form',
    detailedDescription: 'Something totally awesome',
    icon: '🎉',
    path: './awesome/',
    category: 'entertainment',
    gradient: 'from-yellow-500/20 to-orange-500/20',
    border: 'border-yellow-500/30 hover:border-yellow-400/50',
    taskbarGradient: 'from-yellow-400 to-orange-500',
    taskbarText: 'text-black'
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
    taskbarText: 'text-white'
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
    gradient: 'from-teal-500/20 to-cyan-500/20',
    border: 'border-teal-500/30 hover:border-teal-400/50',
    taskbarGradient: 'from-teal-500 to-cyan-500',
    taskbarText: 'text-white'
  },
  {
    id: 'youtube',
    name: 'YouTube Channel 🎥',
    shortName: 'YouTube',
    description: "Joe's digital adventures & coding magic",
    detailedDescription: 'YouTube link utilities',
    icon: '🎥',
    path: './youtube/',
    category: 'utility',
    gradient: 'from-red-500/20 to-red-600/20',
    border: 'border-red-500/30 hover:border-red-400/50',
    taskbarGradient: 'from-red-500 to-red-600',
    taskbarText: 'text-white'
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
  }
].sort((a, b) => a.name.localeCompare(b.name));

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
    return AppModule.getAllApps().map((app) => ({
      id: app.id,
      name: app.shortName,
      description: app.detailedDescription,
      icon: app.icon,
      path: app.path,
      gradient: app.gradient,
      border: app.border
    }));
  }
};

// Export for module usage (if using ES6 modules)
// export default AppModule;

// Global namespace for direct script inclusion
window.AppModule = AppModule;

// Backward compatibility exports
window.availableApps = AppModule.getTaskbarApps();
window.appConfig = AppModule.getWindowConfig();
