// Command Registry and Loader for Heyming Terminal
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.loadPromises = [];
    this.loadedScripts = new Set(); // Track loaded scripts to avoid duplicates
    this.loadingPromises = new Map(); // Track in-progress loads to avoid race conditions

    // Script dependency map -- keys are script paths relative to /terminal/,
    // values are arrays of scripts that must be loaded first.
    // Covers both lib-to-lib transitive deps and command-handler-to-lib deps.
    this.scriptDeps = {
      // Lib -> lib (transitive)
      'commands/filesystem/expand-lib.js': ['commands/system/less-lib.js'],
      'commands/filesystem/fmt-lib.js': ['commands/system/less-lib.js'],
      'commands/filesystem/sort-lib.js': ['commands/filesystem/lines-lib.js'],
      'commands/filesystem/uniq-lib.js': ['commands/filesystem/lines-lib.js'],
      'commands/filesystem/wc-lib.js': ['commands/filesystem/lines-lib.js'],

      // Filesystem command handlers -> libs
      'commands/filesystem/awk.js': ['commands/filesystem/awk-lib.js'],
      'commands/filesystem/basename.js': ['commands/filesystem/basename-lib.js'],
      'commands/filesystem/cat.js': ['commands/filesystem/cat-lib.js'],
      'commands/filesystem/chmod.js': ['commands/filesystem/chmod-lib.js'],
      'commands/filesystem/cp.js': ['commands/filesystem/fileops-lib.js'],
      'commands/filesystem/csplit.js': [
        'commands/filesystem/csplit-lib.js',
        'commands/filesystem/split-lib.js'
      ],
      'commands/filesystem/cut.js': ['commands/filesystem/cut-lib.js'],
      'commands/filesystem/dirname.js': ['commands/filesystem/basename-lib.js'],
      'commands/filesystem/echo.js': ['commands/filesystem/echo-lib.js'],
      'commands/filesystem/expand.js': ['commands/filesystem/expand-lib.js'],
      'commands/filesystem/fmt.js': ['commands/filesystem/fmt-lib.js'],
      'commands/filesystem/fold.js': ['commands/filesystem/fold-lib.js'],
      'commands/filesystem/grep.js': ['commands/filesystem/grep-lib.js'],
      'commands/filesystem/head.js': ['commands/filesystem/lines-lib.js'],
      'commands/filesystem/join.js': [
        'commands/filesystem/join-lib.js',
        'commands/filesystem/paste-lib.js'
      ],
      'commands/filesystem/ln.js': ['commands/filesystem/ln-lib.js'],
      'commands/filesystem/ls.js': ['commands/filesystem/ls-lib.js'],
      'commands/filesystem/mkdir.js': ['commands/filesystem/mkdir-lib.js'],
      'commands/filesystem/mv.js': ['commands/filesystem/fileops-lib.js'],
      'commands/filesystem/nl.js': ['commands/filesystem/nl-lib.js'],
      'commands/filesystem/paste.js': ['commands/filesystem/paste-lib.js'],
      'commands/filesystem/readlink.js': ['commands/filesystem/readlink-lib.js'],
      'commands/filesystem/rm.js': ['commands/filesystem/fileops-lib.js'],
      'commands/filesystem/rmdir.js': ['commands/filesystem/fileops-lib.js'],
      'commands/filesystem/sed.js': ['commands/filesystem/sed-lib.js'],
      'commands/filesystem/sort.js': ['commands/filesystem/sort-lib.js'],
      'commands/filesystem/split.js': ['commands/filesystem/split-lib.js'],
      'commands/filesystem/stat.js': ['commands/filesystem/stat-lib.js'],
      'commands/filesystem/tail.js': ['commands/filesystem/lines-lib.js'],
      'commands/filesystem/tee.js': ['commands/filesystem/tee-lib.js'],
      'commands/filesystem/touch.js': ['commands/filesystem/touch-lib.js'],
      'commands/filesystem/tr.js': ['commands/filesystem/tr-lib.js'],
      'commands/filesystem/uniq.js': ['commands/filesystem/uniq-lib.js'],
      'commands/filesystem/unlink.js': ['commands/filesystem/fileops-lib.js'],
      'commands/filesystem/wc.js': ['commands/filesystem/wc-lib.js'],
      'commands/filesystem/printf.js': ['commands/filesystem/printf-lib.js'],

      // System command handlers -> libs
      'commands/system/alias.js': ['commands/system/builtins-lib.js'],
      'commands/system/date.js': ['commands/system/date-lib.js'],
      'commands/system/env.js': ['commands/system/env-lib.js'],
      'commands/system/git.js': [
        'lib/jsh-git-http.js',
        'lib/jsh-git-fs.js',
        'lib/jsh-git-cache.js'
      ],
      'commands/system/less.js': ['commands/system/less-lib.js'],
      'commands/system/node.js': ['lib/node-helpers.js'],
      'commands/system/npm.js': ['lib/npm-helpers.js'],
      'commands/system/npx.js': ['lib/node-helpers.js', 'lib/npm-helpers.js'],
      'commands/system/printf.js': ['commands/filesystem/printf-lib.js'],
      'commands/system/seq.js': ['commands/system/seq-lib.js'],
      'commands/system/sleep.js': ['commands/system/sleep-lib.js'],
      'commands/system/test.js': ['commands/system/test-lib.js'],
      'commands/system/true-false.js': ['commands/system/test-lib.js'],
      'commands/system/type.js': ['commands/system/builtins-lib.js'],
      'commands/system/which.js': ['commands/system/builtins-lib.js'],
      'commands/system/xargs.js': ['commands/system/xargs-lib.js']
    };

    // Command mapping - maps command names to their file locations
    this.commandMap = {
      // System commands
      whoami: 'commands/system/whoami.js',
      date: 'commands/system/date.js',
      clear: 'commands/system/clear.js',
      version: 'commands/system/version.js',
      env: 'commands/system/env.js',
      export: 'commands/system/export.js',
      unset: 'commands/system/unset.js',
      hostname: 'commands/system/hostname.js',
      history: 'commands/system/history.js',
      alias: 'commands/system/alias.js',
      unalias: 'commands/system/unalias.js',
      which: 'commands/system/which.js',
      type: 'commands/system/type.js',
      ps: 'commands/system/ps.js',
      uptime: 'commands/system/uptime.js',
      reset: 'commands/system/reset.js',
      clearfs: 'commands/system/clearfs.js',
      cmdcount: 'commands/system/cmdcount.js',
      genbin: 'commands/system/genbin.js',
      git: 'commands/system/git.js',
      neofetch: 'commands/system/neofetch.js',
      ping: 'commands/system/ping.js',
      curl: 'commands/system/curl.js',
      vi: 'commands/system/vi.js',
      less: 'commands/system/less.js',
      'proxy-stats': 'commands/system/proxy-stats.js',
      top: 'commands/system/top.js',
      kill: 'commands/system/kill.js',
      debug: 'commands/system/debug.js',
      osinfo: 'commands/system/osinfo.js',
      uname: 'commands/system/uname.js',
      fsck: 'commands/system/fsck.js',
      exit: 'commands/system/exit.js',
      launch: 'commands/system/launch.js',
      man: 'commands/system/man.js',
      open: 'commands/system/open.js',
      'heyming-desktop': 'commands/system/heyming-desktop.js',
      spawn: 'commands/system/spawn.js',
      node: 'commands/system/node.js',
      true: 'commands/system/true-false.js',
      false: 'commands/system/true-false.js',
      ':': 'commands/system/true-false.js',
      test: 'commands/system/test.js',
      '[': 'commands/system/test.js',
      seq: 'commands/system/seq.js',
      sleep: 'commands/system/sleep.js',
      xargs: 'commands/system/xargs.js',
      printf: 'commands/system/printf.js',
      npm: 'commands/system/npm.js',
      npx: 'commands/system/npx.js',

      // User and group management
      useradd: 'commands/system/useradd.js',
      userdel: 'commands/system/userdel.js',
      usermod: 'commands/system/usermod.js',
      groupadd: 'commands/system/groupadd.js',
      groupdel: 'commands/system/groupdel.js',
      passwd: 'commands/system/passwd.js',
      id: 'commands/system/id.js',
      groups: 'commands/system/groups.js',
      su: 'commands/system/su.js',

      // Filesystem commands
      ls: 'commands/filesystem/ls.js',
      pwd: 'commands/filesystem/pwd.js',
      cd: 'commands/filesystem/cd.js',
      basename: 'commands/filesystem/basename.js',
      cat: 'commands/filesystem/cat.js',
      hexdump: 'commands/filesystem/hexdump.js',
      mkdir: 'commands/filesystem/mkdir.js',
      chmod: 'commands/filesystem/chmod.js',
      touch: 'commands/filesystem/touch.js',
      rm: 'commands/filesystem/rm.js',
      rmdir: 'commands/filesystem/rmdir.js',
      unlink: 'commands/filesystem/unlink.js',
      cp: 'commands/filesystem/cp.js',
      mv: 'commands/filesystem/mv.js',
      grep: 'commands/filesystem/grep.js',
      find: 'commands/filesystem/find.js',
      echo: 'commands/filesystem/echo.js',
      df: 'commands/filesystem/df.js',
      dirname: 'commands/filesystem/dirname.js',
      head: 'commands/filesystem/head.js',
      tail: 'commands/filesystem/tail.js',
      wc: 'commands/filesystem/wc.js',
      sort: 'commands/filesystem/sort.js',
      uniq: 'commands/filesystem/uniq.js',
      tee: 'commands/filesystem/tee.js',
      stat: 'commands/filesystem/stat.js',
      readlink: 'commands/filesystem/readlink.js',
      ln: 'commands/filesystem/ln.js',
      cut: 'commands/filesystem/cut.js',
      tr: 'commands/filesystem/tr.js',
      sed: 'commands/filesystem/sed.js',
      awk: 'commands/filesystem/awk.js',
      nl: 'commands/filesystem/nl.js',
      paste: 'commands/filesystem/paste.js',
      join: 'commands/filesystem/join.js',
      expand: 'commands/filesystem/expand.js',
      fold: 'commands/filesystem/fold.js',
      fmt: 'commands/filesystem/fmt.js',
      split: 'commands/filesystem/split.js',
      csplit: 'commands/filesystem/csplit.js',

      // Fun commands
      sudo: 'commands/fun/sudo.js',
      hack: 'commands/fun/hack.js',
      matrix: 'commands/fun/matrix.js',
      sl: 'commands/fun/sl.js',
      cowsay: 'commands/fun/cowsay.js',
      fortune: 'commands/fun/fortune.js',
      rick: 'commands/fun/rick.js',
      coffee: 'commands/fun/coffee.js',
      pizza: 'commands/fun/pizza.js',
      joke: 'commands/fun/joke.js',

      // Speech commands
      say: 'commands/speech/say.js',
      hollywood: 'commands/speech/hollywood.js'
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
    return (
      this.commands.has(lowerName) ||
      Object.prototype.hasOwnProperty.call(this.commandMap, lowerName)
    );
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
    const commandSet = new Set(commands.map((cmd) => cmd.name));

    // Add unloaded commands with basic info
    Object.keys(this.commandMap).forEach((name) => {
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

  // Load a script and all of its transitive dependencies first.
  async ensureLoaded(scriptPath) {
    if (this.loadedScripts.has(scriptPath)) return;
    if (this.loadingPromises.has(scriptPath)) {
      return this.loadingPromises.get(scriptPath);
    }

    const promise = (async () => {
      const deps = this.scriptDeps[scriptPath] || [];
      await Promise.all(deps.map((dep) => this.ensureLoaded(dep)));
      await this.loadScript(scriptPath);
    })();

    this.loadingPromises.set(scriptPath, promise);
    try {
      await promise;
      this.loadedScripts.add(scriptPath);
    } finally {
      this.loadingPromises.delete(scriptPath);
    }
  }

  // Load a specific command script (and its lib dependencies).
  async loadCommandScript(scriptPath) {
    await this.ensureLoaded(scriptPath);
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
