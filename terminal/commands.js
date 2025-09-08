// Command Registry and Loader for Heyming Terminal
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.loadPromises = [];
    this.loadedScripts = new Set(); // Track loaded scripts to avoid duplicates
    this.loadingPromises = new Map(); // Track in-progress loads to avoid race conditions
    
    // Command mapping - maps command names to their file locations
    this.commandMap = {
      // System commands
      'whoami': 'commands/system/whoami.js',
      'date': 'commands/system/date.js',
      'clear': 'commands/system/clear.js',
      'version': 'commands/system/version.js',
      'env': 'commands/system/env.js',
      'export': 'commands/system/export.js',
      'unset': 'commands/system/unset.js',
      'hostname': 'commands/system/hostname.js',
      'history': 'commands/system/history.js',
      'alias': 'commands/system/alias.js',
      'unalias': 'commands/system/unalias.js',
      'which': 'commands/system/which.js',
      'ps': 'commands/system/ps.js',
      'uptime': 'commands/system/uptime.js',
      'reset': 'commands/system/reset.js',
      'clearfs': 'commands/system/clearfs.js',
      'cmdcount': 'commands/system/cmdcount.js',
      'genbin': 'commands/system/genbin.js',
      'neofetch': 'commands/system/neofetch.js',
      'ping': 'commands/system/ping.js',
      'curl': 'commands/system/curl.js',
      'vi': 'commands/system/vi.js',
      'less': 'commands/system/less.js',
      'proxy-stats': 'commands/system/proxy-stats.js',
      'top': 'commands/system/top.js',
      'kill': 'commands/system/kill.js',
      'debug': 'commands/system/debug.js',
      'osinfo': 'commands/system/osinfo.js',
      'uname': 'commands/system/uname.js',
      'fsck': 'commands/system/fsck.js',
      'exit': 'commands/system/exit.js',
      'launch': 'commands/system/launch.js',
      
      // Filesystem commands
      'ls': 'commands/filesystem/ls.js',
      'pwd': 'commands/filesystem/pwd.js',
      'cd': 'commands/filesystem/cd.js',
      'cat': 'commands/filesystem/cat.js',
      'hexdump': 'commands/filesystem/hexdump.js',
      'mkdir': 'commands/filesystem/mkdir.js',
      'touch': 'commands/filesystem/touch.js',
      'rm': 'commands/filesystem/rm.js',
      'cp': 'commands/filesystem/cp.js',
      'mv': 'commands/filesystem/mv.js',
      'grep': 'commands/filesystem/grep.js',
      'find': 'commands/filesystem/find.js',
      'echo': 'commands/filesystem/echo.js',
      'df': 'commands/filesystem/df.js',
      'head': 'commands/filesystem/head.js',
      'tail': 'commands/filesystem/tail.js',
      'wc': 'commands/filesystem/wc.js',
      'sort': 'commands/filesystem/sort.js',
      'uniq': 'commands/filesystem/uniq.js',
      
      // Fun commands
      'npm': 'commands/fun/npm.js',
      'sudo': 'commands/fun/sudo.js',
      'hack': 'commands/fun/hack.js',
      'matrix': 'commands/fun/matrix.js',
      'sl': 'commands/fun/sl.js',
      'cowsay': 'commands/fun/cowsay.js',
      'fortune': 'commands/fun/fortune.js',
      'rick': 'commands/fun/rick.js',
      'coffee': 'commands/fun/coffee.js',
      'pizza': 'commands/fun/pizza.js',
      'joke': 'commands/fun/joke.js',
      
      // Speech commands
      'say': 'commands/speech/say.js',
      'hollywood': 'commands/speech/hollywood.js'
    };
  }

  // Register a command with its handler
  register(name, handler, description = '', category = 'Other') {
    this.commands.set(name.toLowerCase(), {
      handler,
      description,
      category
    });
  }

  // Get a command handler - now with dynamic loading
  async get(name) {
    const lowerName = name.toLowerCase();
    
    // If command is already loaded, return it
    const command = this.commands.get(lowerName);
    if (command) {
      return command.handler;
    }
    
    // If command has a mapping, try to load it
    const scriptPath = this.commandMap[lowerName];
    if (scriptPath) {
      try {
        await this.loadCommandScript(scriptPath);
        // Try to get the command again after loading
        const loadedCommand = this.commands.get(lowerName);
        return loadedCommand ? loadedCommand.handler : null;
      } catch (error) {
        console.warn(`Failed to load command '${name}' from '${scriptPath}':`, error);
        return null;
      }
    }
    
    return null;
  }

  // Synchronous get for commands that are already loaded
  getSync(name) {
    const command = this.commands.get(name.toLowerCase());
    return command ? command.handler : null;
  }

  // Check if a command exists (either loaded or loadable)
  has(name) {
    const lowerName = name.toLowerCase();
    return this.commands.has(lowerName) || this.commandMap.hasOwnProperty(lowerName);
  }

  // Get all command names for tab completion (includes unloaded commands)
  getCommandNames() {
    const loadedCommands = Array.from(this.commands.keys());
    const mappedCommands = Object.keys(this.commandMap);
    return [...new Set([...loadedCommands, ...mappedCommands])];
  }

  // Get command descriptions for help (only loaded commands)
  getCommands() {
    return Array.from(this.commands.entries()).map(([name, cmd]) => ({
      name,
      description: cmd.description,
      category: cmd.category
    }));
  }

  // Get all available commands (including unloaded ones with basic info)
  getAllCommands() {
    const commands = this.getCommands();
    const commandSet = new Set(commands.map(cmd => cmd.name));
    
    // Add unloaded commands with basic info
    Object.keys(this.commandMap).forEach(name => {
      if (!commandSet.has(name)) {
        const category = this.getCategoryFromPath(this.commandMap[name]);
        commands.push({
          name,
          description: '(not loaded yet)',
          category
        });
      }
    });
    
    return commands;
  }

  // Get category from file path
  getCategoryFromPath(path) {
    if (path.includes('/system/')) return 'System';
    if (path.includes('/filesystem/')) return 'File System';
    if (path.includes('/fun/')) return 'Fun Stuff';
    if (path.includes('/speech/')) return 'Speech & Media';
    return 'Other';
  }

  // Get commands grouped by category
  getCommandsByCategory() {
    const commands = this.getAllCommands();
    const categories = {};

    commands.forEach((cmd) => {
      if (!categories[cmd.category]) {
        categories[cmd.category] = [];
      }
      categories[cmd.category].push(cmd);
    });

    // Sort commands within each category
    Object.keys(categories).forEach((category) => {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    });

    return categories;
  }

  // Load command modules (legacy method for backward compatibility)
  async loadCommands() {
    // This method is now mostly for initialization
    // Individual commands will be loaded on-demand
    console.log('Command registry initialized with dynamic loading');
  }

  // Load a specific command script
  async loadCommandScript(scriptPath) {
    // Check if already loaded
    if (this.loadedScripts.has(scriptPath)) {
      return;
    }
    
    // Check if already loading (avoid race conditions)
    if (this.loadingPromises.has(scriptPath)) {
      return await this.loadingPromises.get(scriptPath);
    }
    
    // Start loading
    const loadPromise = this.loadScript(scriptPath);
    this.loadingPromises.set(scriptPath, loadPromise);
    
    try {
      await loadPromise;
      this.loadedScripts.add(scriptPath);
    } finally {
      this.loadingPromises.delete(scriptPath);
    }
  }

  // Dynamically load a script
  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Allow modules to register async initialization
  addLoadPromise(promise) {
    this.loadPromises.push(promise);
  }
}

// Global command registry
window.commandRegistry = new CommandRegistry();

// Helper function for commands to register themselves
window.registerCommand = (name, handler, description, category) => {
  window.commandRegistry.register(name, handler, description, category);
};

// Helper function for commands to register async initialization
window.addCommandLoadPromise = (promise) => {
  window.commandRegistry.addLoadPromise(promise);
};
