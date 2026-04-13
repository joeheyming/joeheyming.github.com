// Node.js command - Execute JavaScript files using Node-like runtime

import { NodeHelpers } from '../../lib/node-helpers.js';

const moduleCache = new Map();

// In-memory sync cache for fs.readFileSync etc.
// Populated when files are written to VFS via writeFileToVFS/npm install/npx.
if (!window._vfsSyncCache) {
  window._vfsSyncCache = { files: new Map(), dirs: new Map() };
}

function syncFetchFromUnpkg(filePath) {
  // Attempt to resolve VFS path like /usr/lib/node_modules/<pkg>/... to unpkg URL
  var prefix = '/usr/lib/node_modules/';
  if (!filePath.startsWith(prefix)) return null;
  var rest = filePath.slice(prefix.length);
  var slash = rest.indexOf('/');
  if (slash === -1) return null;
  var pkgName = rest.slice(0, slash);
  var pkgFile = rest.slice(slash + 1);
  var registry = window.npmRegistry;
  var version = '';
  if (registry && registry.modules.has(pkgName)) {
    var info = registry.modules.get(pkgName);
    if (info.packageJson && info.packageJson.version) {
      version = '@' + info.packageJson.version;
    }
  }
  var url = 'https://unpkg.com/' + pkgName + version + '/' + pkgFile;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status === 200) {
      var content = xhr.responseText;
      window._vfsSyncCache.files.set(filePath, content);
      return content;
    }
  } catch (_) {
    // sync XHR failed
  }
  return null;
}

function createFSModule(terminal) {
  var cache = window._vfsSyncCache;

  function _readFileSync(filePath) {
    if (cache.files.has(filePath)) {
      return cache.files.get(filePath);
    }
    var fetched = syncFetchFromUnpkg(filePath);
    if (fetched !== null) return fetched;
    throw new Error("ENOENT: no such file or directory, open '" + filePath + "'");
  }

  function _readdirSync(dirPath) {
    var normalized = dirPath.replace(/\/+$/, '');
    if (cache.dirs.has(normalized)) {
      return cache.dirs.get(normalized);
    }
    var entries = [];
    var prefix = normalized + '/';
    cache.files.forEach(function (_, key) {
      if (key.startsWith(prefix)) {
        var rest = key.slice(prefix.length);
        if (rest.indexOf('/') === -1) {
          entries.push(rest);
        }
      }
    });
    if (entries.length > 0) return entries;
    var modulePrefix = '/usr/lib/node_modules/';
    if (normalized.startsWith(modulePrefix)) {
      var rest2 = normalized.slice(modulePrefix.length);
      var sl = rest2.indexOf('/');
      if (sl !== -1) {
        var pkg = rest2.slice(0, sl);
        var subdir = rest2.slice(sl);
        var reg = window.npmRegistry;
        var ver = '';
        if (reg && reg.modules.has(pkg)) {
          var inf = reg.modules.get(pkg);
          if (inf.packageJson && inf.packageJson.version) ver = '@' + inf.packageJson.version;
        }
        try {
          var xhr2 = new XMLHttpRequest();
          xhr2.open('GET', 'https://unpkg.com/' + pkg + ver + subdir + '/?meta', false);
          xhr2.send();
          if (xhr2.status === 200) {
            var meta = JSON.parse(xhr2.responseText);
            if (meta.files) {
              entries = meta.files.map(function (f) {
                return f.path.split('/').pop();
              });
              cache.dirs.set(normalized, entries);
              return entries;
            }
          }
        } catch (_) {
          // ignore
        }
      }
    }
    return entries;
  }

  return {
    readFileSync: _readFileSync,
    writeFileSync: function () {
      throw new Error('writeFileSync not implemented in web terminal');
    },
    existsSync: function (filePath) {
      return cache.files.has(filePath) || cache.dirs.has(filePath);
    },
    readdirSync: _readdirSync,
    readFile: function (filePath, optionsOrCallback, callback) {
      var cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      try {
        var data = _readFileSync(filePath);
        if (cb)
          setTimeout(function () {
            cb(null, data);
          }, 0);
        return Promise.resolve(data);
      } catch (err) {
        if (cb)
          setTimeout(function () {
            cb(err);
          }, 0);
        return Promise.reject(err);
      }
    },
    readdir: function (dirPath, optionsOrCallback, callback) {
      var cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      try {
        var result = _readdirSync(dirPath);
        if (cb)
          setTimeout(function () {
            cb(null, result);
          }, 0);
        return Promise.resolve(result);
      } catch (err) {
        if (cb)
          setTimeout(function () {
            cb(err);
          }, 0);
        return Promise.reject(err);
      }
    },
    statSync: function (filePath) {
      var isFile = cache.files.has(filePath);
      var isDir = cache.dirs.has(filePath);
      if (!isFile && !isDir) {
        throw new Error("ENOENT: no such file or directory '" + filePath + "'");
      }
      return {
        isFile: function () {
          return isFile;
        },
        isDirectory: function () {
          return isDir;
        }
      };
    }
  };
}

var transformImportStatements = NodeHelpers.transformImportStatements;
var transformExportStatements = NodeHelpers.transformExportStatements;

var createPathModule = NodeHelpers.createPathModule;
var createOSModule = NodeHelpers.createOSModule;
var createUrlModule = NodeHelpers.createUrlModule;

const builtinModules = {
  fs: null,
  path: createPathModule(),
  os: createOSModule(),
  url: createUrlModule()
};

// Browser shims for npm packages whose esm.sh bundles don't work properly.
// esm.sh bundles include [unenv] polyfills for process/fs that we can't override,
// so we provide our own shims that use globalThis.process instead.
const moduleShims = {
  'get-stdin': (function () {
    var fn = function () {
      return Promise.resolve('');
    };
    fn.buffer = function () {
      return Promise.resolve(new Uint8Array(0));
    };
    return fn;
  })(),
  'strip-final-newline': function (input) {
    if (typeof input === 'string') {
      return input.replace(/\n$/, '');
    }
    return input;
  },
  yargs: createYargsShim(),
  commander: createCommanderShim()
};

function createYargsShim() {
  function Yargs(rawArgs) {
    var self = this;
    self._options = {};
    self._booleans = [];
    self._aliases = {};
    self._descriptions = {};
    self._usageStr = '';
    self._rawArgs = rawArgs || null;
  }

  Yargs.prototype.usage = function (msg) {
    this._usageStr = msg;
    return this;
  };
  Yargs.prototype.options = function (opts) {
    for (var key in opts) {
      this._options[key] = opts[key];
    }
    return this;
  };
  Yargs.prototype.option = Yargs.prototype.options;
  Yargs.prototype.describe = function (obj) {
    if (typeof obj === 'object') {
      for (var key in obj) {
        this._descriptions[key] = obj[key];
      }
    }
    return this;
  };
  Yargs.prototype.boolean = function (keys) {
    if (Array.isArray(keys)) {
      this._booleans = this._booleans.concat(keys);
    } else {
      this._booleans.push(keys);
    }
    return this;
  };
  Yargs.prototype.string = function () {
    return this;
  };
  Yargs.prototype.number = function () {
    return this;
  };
  Yargs.prototype.alias = function (a, b) {
    this._aliases[a] = b;
    this._aliases[b] = a;
    return this;
  };
  Yargs.prototype.help = function () {
    return this;
  };
  Yargs.prototype.version = function () {
    return this;
  };
  Yargs.prototype.demandCommand = function () {
    return this;
  };
  Yargs.prototype.epilog = function () {
    return this;
  };
  Yargs.prototype.epilogue = Yargs.prototype.epilog;
  Yargs.prototype.wrap = function () {
    return this;
  };
  Yargs.prototype.strict = function () {
    return this;
  };
  Yargs.prototype.command = function () {
    return this;
  };
  Yargs.prototype.showHelp = function () {
    if (typeof console !== 'undefined') {
      console.log(this._usageStr || 'Usage: <command> [options]');
    }
  };

  Yargs.prototype.parse = function (args) {
    if (!args) {
      args = globalThis.process ? globalThis.process.argv.slice(2) : [];
    }
    return parseArgs(args, this._options, this._booleans, this._aliases);
  };

  Object.defineProperty(Yargs.prototype, 'argv', {
    get: function () {
      return this.parse(this._rawArgs);
    }
  });

  function parseArgs(args, optDefs, boolKeys, aliases) {
    var result = { _: [], $0: 'node' };
    // Set defaults from option definitions
    for (var key in optDefs) {
      if (optDefs[key] && optDefs[key].default !== undefined) {
        result[key] = optDefs[key].default;
      }
    }
    for (var bi = 0; bi < boolKeys.length; bi++) {
      if (result[boolKeys[bi]] === undefined) result[boolKeys[bi]] = false;
    }
    var i = 0;
    while (i < args.length) {
      var arg = args[i];
      if (arg === '--') {
        result._ = result._.concat(args.slice(i + 1));
        break;
      }
      if (arg.startsWith('--')) {
        var eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          var k = arg.slice(2, eqIdx);
          result[k] = arg.slice(eqIdx + 1);
        } else {
          var k2 = arg.slice(2);
          if (boolKeys.indexOf(k2) !== -1 || boolKeys.indexOf(aliases[k2]) !== -1) {
            result[k2] = true;
          } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
            result[k2] = args[++i];
          } else {
            result[k2] = true;
          }
        }
      } else if (arg.startsWith('-') && arg.length > 1) {
        for (var ci = 1; ci < arg.length; ci++) {
          var ch = arg[ci];
          if (boolKeys.indexOf(ch) !== -1 || (optDefs[ch] && optDefs[ch].type === 'boolean')) {
            result[ch] = true;
          } else if (ci === arg.length - 1 && i + 1 < args.length) {
            result[ch] = args[++i];
          } else {
            result[ch] = true;
          }
        }
      } else {
        result._.push(arg);
      }
      i++;
    }
    // Apply aliases
    for (var ak in aliases) {
      if (result[ak] !== undefined && result[aliases[ak]] === undefined) {
        result[aliases[ak]] = result[ak];
      }
    }
    return result;
  }

  var yargsFactory = function (args) {
    return new Yargs(args);
  };
  // Also support require('yargs') being called directly as a function or used as yargs(...)
  // Cowsay does: const yargs = require('yargs').usage(...).options(...)
  // So require('yargs') needs to return something with .usage() etc.
  var instance = new Yargs(null);
  var proxy = function (args) {
    return new Yargs(args);
  };
  // Copy prototype methods onto proxy so require('yargs').usage(...) works
  var proto = Yargs.prototype;
  for (var m in proto) {
    if (typeof proto[m] === 'function') {
      proxy[m] = proto[m].bind(instance);
    }
  }
  Object.defineProperty(proxy, 'argv', {
    get: function () {
      return instance.argv;
    }
  });
  proxy.Yargs = Yargs;
  return proxy;
}

function createCommanderShim() {
  function Command(name) {
    this._name = name || '';
    this._desc = '';
    this._version = '';
    this._args = [];
    this._opts = [];
    this._actionFn = null;
  }
  var p = Command.prototype;
  p.name = function (n) {
    this._name = n;
    return this;
  };
  p.description = function (d) {
    this._desc = d;
    return this;
  };
  p.version = function (v) {
    this._version = v;
    return this;
  };
  p.argument = function (spec, desc) {
    this._args.push({ spec: spec, desc: desc || '' });
    return this;
  };
  p.option = function (flags, desc, defaultVal) {
    var parts = flags.split(/[,\s]+/);
    var long = null;
    var short = null;
    var argName = null;
    for (var i = 0; i < parts.length; i++) {
      var pt = parts[i];
      if (pt.startsWith('--')) long = pt.slice(2);
      else if (pt.startsWith('-') && pt.length === 2) short = pt.slice(1);
      else if (pt.startsWith('<') || pt.startsWith('[')) argName = pt;
    }
    this._opts.push({
      long: long,
      short: short,
      hasArg: !!argName,
      desc: desc || '',
      defaultVal: defaultVal
    });
    return this;
  };
  p.action = function (fn) {
    this._actionFn = fn;
    return this;
  };
  p.help = function () {
    var lines = [this._desc || this._name, ''];
    console.log(lines.join('\n'));
  };
  p.command = function () {
    return this;
  };
  p.addCommand = function () {
    return this;
  };
  /**
   * @this {{
   *   _opts: Array<{ long: string | null, short: string | null, hasArg: boolean, desc: string, defaultVal: unknown }>,
   *   _actionFn: Function | null,
   *   _parseResult?: unknown
   * }}
   */
  p.parse = function (argv) {
    var args = argv ? argv.slice(2) : globalThis.process ? globalThis.process.argv.slice(2) : [];
    var opts = {};
    var positional = [];
    for (var oi = 0; oi < this._opts.length; oi++) {
      var od = this._opts[oi];
      if (od.defaultVal !== undefined && od.long) opts[od.long] = od.defaultVal;
    }
    var ai = 0;
    while (ai < args.length) {
      var a = args[ai];
      var matched = false;
      for (var j = 0; j < this._opts.length; j++) {
        var opt = this._opts[j];
        if (a === '--' + opt.long || a === '-' + opt.short) {
          if (opt.hasArg && ai + 1 < args.length) {
            opts[opt.long || opt.short] = args[++ai];
          } else {
            opts[opt.long || opt.short] = true;
          }
          matched = true;
          break;
        }
      }
      if (!matched && !a.startsWith('-')) {
        positional.push(a);
      }
      ai++;
    }
    if (this._actionFn) {
      var fnArgs = positional.slice();
      fnArgs.push(opts);
      fnArgs.push(this);
      // Store the result (may be a Promise for async actions)
      this._parseResult = this._actionFn.apply(null, fnArgs);
    }
    return this._parseResult;
  };

  var program = new Command();
  return { program: program, Command: Command };
}

var _fsModuleCache = null;
var _fsModuleTerminal = null;

var withDefaultSelf = NodeHelpers.withDefaultSelf;

function getBuiltinModule(name, terminal) {
  if (name === 'fs') {
    if (!_fsModuleCache || _fsModuleTerminal !== terminal) {
      _fsModuleCache = withDefaultSelf(createFSModule(terminal));
      _fsModuleTerminal = terminal;
    }
    return _fsModuleCache;
  }
  if (builtinModules[name]) return withDefaultSelf(builtinModules[name]);
  if (moduleShims[name]) return withDefaultSelf(moduleShims[name]);
  return null;
}

function createMockStdin() {
  const listeners = {};
  const stdin = {
    readable: false,
    isTTY: false,
    setEncoding: function () {
      return stdin;
    },
    on: function (event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      if (event === 'end') setTimeout(cb, 0);
      return stdin;
    },
    once: function (event, cb) {
      return stdin.on(event, cb);
    },
    removeListener: function () {
      return stdin;
    },
    resume: function () {
      return stdin;
    },
    pause: function () {
      return stdin;
    },
    read: function () {
      return null;
    },
    pipe: function (dest) {
      return dest;
    },
    [Symbol.asyncIterator]: async function* () {
      /* empty stdin */
    }
  };
  return stdin;
}

function createMockStream(writeFn) {
  const stream = {
    writable: true,
    isTTY: false,
    write: writeFn || function () {},
    end: function () {},
    on: function () {
      return stream;
    },
    once: function () {
      return stream;
    }
  };
  return stream;
}

// Fallback: ensure globalThis.process exists (npm.js/npx.js set this up earlier)
if (!globalThis.process || !globalThis.process.stdin || !globalThis.process.stdin.setEncoding) {
  globalThis.process = {
    argv: [],
    env: {},
    cwd: function () {
      return '/';
    },
    exit: function () {},
    stdin: createMockStdin(),
    stdout: createMockStream(),
    stderr: createMockStream(),
    platform: 'browser',
    version: 'v18.0.0',
    versions: { node: '18.0.0' }
  };
}

const savedProcessProps = [];

function patchGlobalProcess(terminal, filePath, extraArgs, stdoutWrite, stderrWrite) {
  const gp = globalThis.process;
  savedProcessProps.push({
    argv: gp.argv,
    env: gp.env,
    cwd: gp.cwd,
    exit: gp.exit,
    stdoutWrite: gp.stdout.write,
    stderrWrite: gp.stderr.write
  });
  gp.argv = ['node', filePath].concat(extraArgs || []);
  gp.env = terminal.env || {};
  gp.cwd = function () {
    return terminal.currentDirectory || '/';
  };
  gp.exit = function (code) {
    throw new Error('Process exited with code ' + (code === undefined ? 0 : code));
  };
  if (stdoutWrite) gp.stdout.write = stdoutWrite;
  if (stderrWrite) gp.stderr.write = stderrWrite;
  return gp;
}

function unpatchGlobalProcess() {
  const saved = savedProcessProps.pop();
  if (!saved) return;
  const gp = globalThis.process;
  gp.argv = saved.argv;
  gp.env = saved.env;
  gp.cwd = saved.cwd;
  gp.exit = saved.exit;
  gp.stdout.write = saved.stdoutWrite;
  gp.stderr.write = saved.stderrWrite;
}

function createProcessObject(terminal, filePath, extraArgs, stdoutWrite, stderrWrite) {
  return {
    argv: ['node', filePath].concat(extraArgs || []),
    env: terminal.env || {},
    cwd: () => terminal.currentDirectory || '/',
    exit: (code) => {
      throw new Error('Process exited with code ' + (code === undefined ? 0 : code));
    },
    stdin: createMockStdin(),
    stdout: createMockStream(stdoutWrite),
    stderr: createMockStream(stderrWrite),
    platform: 'browser',
    version: 'v18.0.0',
    versions: { node: '18.0.0' }
  };
}

var isBareModuleName = NodeHelpers.isBareModuleName;
var hasJsExtension = NodeHelpers.hasJsExtension;

function isNpmOrBuiltin(importPath) {
  if (importPath in builtinModules) return true;
  if (importPath in moduleShims) return true;
  if (!isBareModuleName(importPath)) return false;
  return window.npmRegistry && window.npmRegistry.modules.has(importPath);
}

function resolveImportPath(importPath, currentFilePath, terminal) {
  return NodeHelpers.resolveImportPath(importPath, currentFilePath, function (p) {
    return terminal.resolvePath(p);
  });
}

async function executeModuleSync(filePath, terminal, parentPath = null, visited = new Set()) {
  if (moduleCache.has(filePath)) {
    return moduleCache.get(filePath);
  }

  if (!hasJsExtension(filePath)) {
    throw new Error(`Can only import JavaScript files: ${filePath}`);
  }

  let content = null;

  // Try VFS first
  const fileItem = await terminal.getFileSystemItem(filePath);
  if (fileItem) {
    if (fileItem.type !== 'file') {
      throw new Error(`Cannot import directory: ${filePath}`);
    }
    content = fileItem.content;
  }

  // Fallback to in-memory sync cache
  if (!content && window._vfsSyncCache && window._vfsSyncCache.files.has(filePath)) {
    content = window._vfsSyncCache.files.get(filePath);
  }

  // Fallback to sync fetch from unpkg
  if (!content) {
    content = syncFetchFromUnpkg(filePath);
  }

  if (!content) {
    throw new Error(`Module not found: ${filePath}`);
  }

  content = transformImportStatements(content);
  content = transformExportStatements(content);

  // Recursively preload this module's dependencies before executing
  await preloadModules(content, filePath, terminal, visited);

  const moduleExports = {};
  const moduleObject = { exports: moduleExports };

  const requireFunction = (importPath) => {
    const resolvedPath = resolveImportPath(importPath, filePath, terminal);
    if (moduleCache.has(resolvedPath)) {
      return moduleCache.get(resolvedPath);
    }
    throw new Error(`Module '${importPath}' not found or not preloaded`);
  };

  const enhancedRequire = (moduleName) => {
    const builtin = getBuiltinModule(moduleName, terminal);
    if (builtin) return builtin;
    if (
      isBareModuleName(moduleName) &&
      window.npmRegistry &&
      window.npmRegistry.modules.has(moduleName)
    ) {
      const esmMod = /** @type {{ default?: unknown; __esModule?: boolean }} */ (
        window.npmRegistry.modules.get(moduleName).module
      );
      if (esmMod && esmMod.default !== undefined && !esmMod.__esModule) {
        return esmMod.default;
      }
      return esmMod;
    }
    return requireFunction(moduleName);
  };

  moduleCache.set(filePath, moduleExports);

  try {
    const context = {
      module: moduleObject,
      exports: moduleExports,
      require: enhancedRequire,
      __filename: filePath,
      __dirname: filePath.substring(0, filePath.lastIndexOf('/')) || '/',
      console: {
        log: (...args) => console.log(...args),
        error: (...args) => console.error(...args),
        warn: (...args) => console.warn(...args)
      },
      process: patchGlobalProcess(terminal, filePath, [])
    };

    try {
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);
      const wrappedContent = '(async () => {\n' + content + '\n})()';
      const func = new Function(...contextKeys, 'return ' + wrappedContent);
      await func.apply(null, contextValues);
    } finally {
      unpatchGlobalProcess();
    }

    // Return module.exports directly for CommonJS compatibility.
    // If module.exports was reassigned (e.g. module.exports = function),
    // return the new value; otherwise return the original exports object.
    var finalExports =
      moduleObject.exports !== moduleExports ? moduleObject.exports : moduleExports;
    moduleCache.set(filePath, finalExports);
    return finalExports;
  } catch (error) {
    // Remove from cache on error
    moduleCache.delete(filePath);
    throw error;
  }
}

async function preloadModules(content, currentFilePath, terminal, visited = new Set()) {
  if (visited.has(currentFilePath)) return;
  visited.add(currentFilePath);

  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requireRegex.exec(content)) !== null) {
    const importPath = match[1];

    if (importPath in builtinModules || importPath in moduleShims) continue;
    if (isBareModuleName(importPath)) {
      if (window.npmRegistry && window.npmRegistry.modules.has(importPath)) continue;
      // Re-import from esm.sh if not in live registry (e.g. after page refresh)
      try {
        var esmUrl = 'https://esm.sh/' + importPath;
        var mod = await import(esmUrl);
        if (!window.npmRegistry) {
          window.npmRegistry = /** @type {NpmRegistry} */ ({
            modules: new Map(),
            packages: new Map(),
            search: () => [],
            getPackage: () => undefined
          });
        }
        window.npmRegistry.modules.set(importPath, { module: mod });
      } catch (_) {
        // not available on esm.sh, skip
      }
      continue;
    }

    const resolvedPath = resolveImportPath(importPath, currentFilePath, terminal);
    if (moduleCache.has(resolvedPath)) continue;

    try {
      await executeModuleSync(resolvedPath, terminal, currentFilePath, visited);
    } catch (error) {
      console.warn('Failed to preload module:', resolvedPath, error.message);
    }
  }
}

var nodeResult = NodeHelpers.nodeResult;

async function executeCode(terminal, content, filePath, nodeArgs) {
  // Clear module cache so each execution gets fresh modules with correct require() bindings
  moduleCache.clear();

  let output = '';
  let errorOutput = '';

  content = transformImportStatements(content);
  content = transformExportStatements(content);

  const originalConsole = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...logArgs) => {
    output += logArgs.join(' ') + '\n';
    originalConsole(...logArgs);
  };

  console.error = (...logArgs) => {
    errorOutput += logArgs.join(' ') + '\n';
    originalError(...logArgs);
  };

  console.warn = (...logArgs) => {
    errorOutput += logArgs.join(' ') + '\n';
    originalWarn(...logArgs);
  };

  try {
    await preloadModules(content, filePath, terminal, new Set());

    const requireFunction = (importPath) => {
      const resolvedPath = resolveImportPath(importPath, filePath, terminal);
      if (moduleCache.has(resolvedPath)) {
        return moduleCache.get(resolvedPath);
      }
      throw new Error(
        `Module '${importPath}' not preloaded. This is a limitation of the web environment.`
      );
    };

    const enhancedRequire = (moduleName) => {
      const builtin = getBuiltinModule(moduleName, terminal);
      if (builtin) return builtin;
      if (
        isBareModuleName(moduleName) &&
        window.npmRegistry &&
        window.npmRegistry.modules.has(moduleName)
      ) {
        const esmMod = /** @type {{ default?: unknown; __esModule?: boolean }} */ (
          window.npmRegistry.modules.get(moduleName).module
        );
        if (esmMod && esmMod.default !== undefined && !esmMod.__esModule) {
          return esmMod.default;
        }
        return esmMod;
      }
      return requireFunction(moduleName);
    };

    const context = {
      require: enhancedRequire,
      __filename: filePath,
      __dirname: filePath.substring(0, filePath.lastIndexOf('/')) || '/',
      console: {
        log: console.log,
        error: console.error,
        warn: console.warn
      },
      process: patchGlobalProcess(
        terminal,
        filePath,
        nodeArgs,
        (chunk) => {
          output += String(chunk);
        },
        (chunk) => {
          errorOutput += String(chunk);
        }
      )
    };

    try {
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);
      const wrappedContent = '(async () => {\n' + content + '\n})()';
      const func = new Function(...contextKeys, 'return ' + wrappedContent);
      await func.apply(null, contextValues);
    } finally {
      unpatchGlobalProcess();
    }
  } finally {
    console.log = originalConsole;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return nodeResult(output, errorOutput, 0);
}

async function nodeCommand(terminal, args) {
  if (args.length === 0) {
    return nodeResult(
      [
        'Welcome to Node.js (heyming-terminal).',
        '',
        'Usage:',
        '  node <file.js> [args...]    Run a JavaScript file',
        '  node -e "code"              Evaluate a JavaScript expression',
        '  node << EOF                 Enter multiline JavaScript (heredoc)',
        '    code...',
        '  EOF',
        ''
      ].join('\n'),
      '',
      0
    );
  }

  if (args[0] === '-e' || args[0] === '--eval') {
    const code = args.slice(1).join(' ');
    if (!code) {
      return nodeResult('', 'node: -e requires an argument\n', 1);
    }
    const evalPath = terminal.resolvePath('(eval)');
    try {
      return await executeCode(terminal, code, evalPath, []);
    } catch (error) {
      const exitMatch = /^Process exited with code (.+)$/.exec(error.message);
      if (exitMatch) {
        const n = Math.trunc(Number(exitMatch[1]));
        const exitCode = Number.isFinite(n) ? ((n % 256) + 256) % 256 : 0;
        return nodeResult('', '', exitCode);
      }
      return nodeResult('', `node: ${error.message}`, 1);
    }
  }

  const filename = args[0];
  const nodeArgs = args.slice(1);
  const filePath = terminal.resolvePath(filename);

  try {
    let content = null;
    const fileItem = await terminal.getFileSystemItem(filePath);
    if (fileItem) {
      if (fileItem.type !== 'file') {
        return nodeResult('', `node: '${filename}' is a directory`, 1);
      }
      content = fileItem.content;
    }
    if (!content && window._vfsSyncCache && window._vfsSyncCache.files.has(filePath)) {
      content = window._vfsSyncCache.files.get(filePath);
    }
    if (!content) {
      content = syncFetchFromUnpkg(filePath);
    }
    if (!content) {
      return nodeResult('', `node: can't open file '${filename}': No such file or directory`, 1);
    }
    if (!hasJsExtension(filePath)) {
      return nodeResult('', `node: '${filename}' is not a JavaScript file`, 1);
    }
    return await executeCode(terminal, content, filePath, nodeArgs);
  } catch (error) {
    const exitMatch = /^Process exited with code (.+)$/.exec(error.message);
    if (exitMatch) {
      const n = Math.trunc(Number(exitMatch[1]));
      const code = Number.isFinite(n) ? ((n % 256) + 256) % 256 : 0;
      return nodeResult('', '', code);
    }
    return nodeResult('', `node: ${error.message}`, 1);
  }
}

export default {
  name: 'node',
  handler: nodeCommand,
  description: 'Execute JavaScript files using Node-like runtime',
  category: 'System'
};
