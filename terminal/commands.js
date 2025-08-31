// Command Registry and Loader for Heyming Terminal
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.loadPromises = [];
  }

  // Register a command with its handler
  register(name, handler, description = '', category = 'Other') {
    this.commands.set(name.toLowerCase(), {
      handler,
      description,
      category
    });
  }

  // Get a command handler
  get(name) {
    const command = this.commands.get(name.toLowerCase());
    return command ? command.handler : null;
  }

  // Get all command names for tab completion
  getCommandNames() {
    return Array.from(this.commands.keys());
  }

  // Get command descriptions for help
  getCommands() {
    return Array.from(this.commands.entries()).map(([name, cmd]) => ({
      name,
      description: cmd.description,
      category: cmd.category
    }));
  }

  // Get commands grouped by category
  getCommandsByCategory() {
    const commands = this.getCommands();
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

  // Load command modules
  async loadCommands() {
    const commandModules = [
      'commands/file-system.js',
      'commands/fun-commands.js',
      'commands/system-commands.js',
      'commands/speech-commands.js'
    ];

    // Load all command modules
    for (const module of commandModules) {
      try {
        await this.loadScript(module);
      } catch (error) {
        console.warn(`Failed to load command module: ${module}`, error);
      }
    }

    // Wait for all modules to register their commands
    await Promise.all(this.loadPromises);
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
