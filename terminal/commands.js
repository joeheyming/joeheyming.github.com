// Command Registry and Loader for Heyming Terminal
export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.loadPromises = [];
    this.loadedScripts = new Set();
    this.loadingPromises = new Map();

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

  register(name, handler, description = '', category = 'Other') {
    this.commands.set(name.toLowerCase(), {
      handler,
      description,
      category
    });
  }

  async get(name) {
    const lowerName = name.toLowerCase();

    const command = this.commands.get(lowerName);
    if (command) {
      return command.handler;
    }

    const scriptPath = this.commandMap[lowerName];
    if (scriptPath) {
      try {
        await this.loadCommandScript(scriptPath);
        const loadedCommand = this.commands.get(lowerName);
        return loadedCommand ? loadedCommand.handler : null;
      } catch (error) {
        console.warn(`Failed to load command '${name}' from '${scriptPath}':`, error);
        return null;
      }
    }

    return null;
  }

  getSync(name) {
    const command = this.commands.get(name.toLowerCase());
    return command ? command.handler : null;
  }

  has(name) {
    const lowerName = name.toLowerCase();
    return (
      this.commands.has(lowerName) ||
      Object.prototype.hasOwnProperty.call(this.commandMap, lowerName)
    );
  }

  getCommandNames() {
    const loadedCommands = Array.from(this.commands.keys());
    const mappedCommands = Object.keys(this.commandMap);
    return [...new Set([...loadedCommands, ...mappedCommands])];
  }

  getCommands() {
    return Array.from(this.commands.entries()).map(([name, cmd]) => ({
      name,
      description: cmd.description,
      category: cmd.category
    }));
  }

  getAllCommands() {
    const commands = this.getCommands();
    const commandSet = new Set(commands.map((cmd) => cmd.name));

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

  getCategoryFromPath(path) {
    if (path.includes('/system/')) return 'System';
    if (path.includes('/filesystem/')) return 'File System';
    if (path.includes('/fun/')) return 'Fun Stuff';
    if (path.includes('/speech/')) return 'Speech & Media';
    return 'Other';
  }

  getCommandsByCategory() {
    const commands = this.getAllCommands();
    const categories = {};

    commands.forEach((cmd) => {
      if (!categories[cmd.category]) {
        categories[cmd.category] = [];
      }
      categories[cmd.category].push(cmd);
    });

    Object.keys(categories).forEach((category) => {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    });

    return categories;
  }

  async loadCommands() {
    console.log('Command registry initialized with dynamic loading');
  }

  async loadCommandScript(scriptPath) {
    if (this.loadedScripts.has(scriptPath)) return;
    if (this.loadingPromises.has(scriptPath)) {
      return this.loadingPromises.get(scriptPath);
    }

    const promise = this.loadScript(scriptPath);
    this.loadingPromises.set(scriptPath, promise);
    try {
      await promise;
      this.loadedScripts.add(scriptPath);
    } finally {
      this.loadingPromises.delete(scriptPath);
    }
  }

  async loadScript(src) {
    const mod = await import('./' + src);
    if (mod.default) {
      const defs = Array.isArray(mod.default) ? mod.default : [mod.default];
      for (const def of defs) {
        if (def && def.name && def.handler) {
          this.register(def.name, def.handler, def.description || '', def.category || 'Other');
        }
      }
    }
  }

  addLoadPromise(promise) {
    this.loadPromises.push(promise);
  }
}

export const commandRegistry = new CommandRegistry();

export function registerCommand(name, handler, description, category) {
  commandRegistry.register(name, handler, description, category);
}

export function addCommandLoadPromise(promise) {
  commandRegistry.addLoadPromise(promise);
}
