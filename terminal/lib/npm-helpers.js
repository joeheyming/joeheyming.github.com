// Shared helpers for npm and npx commands — CDN fetching, VFS writes, process shim.
'use strict';

// Ensure globalThis.process exists before any esm.sh imports.
// Modules like get-stdin capture process.stdin at import time.
if (!globalThis.process || !globalThis.process.stdin || !globalThis.process.stdin.setEncoding) {
  var _mkStdin = function () {
    var _ls = {};
    var s = {
      readable: false,
      isTTY: false,
      setEncoding: function () {
        return s;
      },
      on: function (ev, cb) {
        if (!_ls[ev]) _ls[ev] = [];
        _ls[ev].push(cb);
        if (ev === 'end') setTimeout(cb, 0);
        return s;
      },
      once: function (ev, cb) {
        return s.on(ev, cb);
      },
      removeListener: function () {
        return s;
      },
      resume: function () {
        return s;
      },
      pause: function () {
        return s;
      },
      read: function () {
        return null;
      },
      pipe: function (d) {
        return d;
      }
    };
    return s;
  };
  var _mkStream = function () {
    var st = {
      writable: true,
      isTTY: false,
      write: function () {},
      end: function () {},
      on: function () {
        return st;
      },
      once: function () {
        return st;
      }
    };
    return st;
  };
  globalThis.process = {
    argv: [],
    env: {},
    cwd: function () {
      return '/';
    },
    exit: function () {},
    stdin: _mkStdin(),
    stdout: _mkStream(),
    stderr: _mkStream(),
    platform: 'browser',
    version: 'v18.0.0',
    versions: { node: '18.0.0' }
  };
}

var CDN_BASE = 'https://esm.sh';
var UNPKG_BASE = 'https://unpkg.com';
var GLOBAL_MODULES = '/usr/lib/node_modules';

function ensureNpmRegistry() {
  if (!window.npmRegistry) {
    window.npmRegistry = {
      modules: new Map(),
      CDN_BASE,
      UNPKG_BASE,
      GLOBAL_MODULES
    };
  }
  return window.npmRegistry;
}

function parsePackageSpec(spec) {
  var atIdx = spec.lastIndexOf('@');
  if (atIdx > 0) {
    return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) };
  }
  return { name: spec, version: 'latest' };
}

function stripLeadingSlashes(p) {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function hasJsExtension(p) {
  return typeof NodeHelpers !== 'undefined'
    ? NodeHelpers.hasJsExtension(p)
    : /\.(js|mjs|cjs|json)$/.test(p);
}

async function fetchPackageJson(name, version) {
  var versionSuffix = version && version !== 'latest' ? '@' + version : '';
  var url = UNPKG_BASE + '/' + name + versionSuffix + '/package.json';
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('Could not fetch package.json from ' + url);
  return resp.json();
}

async function fetchFileFromUnpkg(name, version, filePath) {
  var versionSuffix = version ? '@' + version : '';
  var clean = stripLeadingSlashes(filePath);
  var url = UNPKG_BASE + '/' + name + versionSuffix + '/' + clean;
  var resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.text();
}

function resolveRelativePath(from, to) {
  var fromClean = stripLeadingSlashes(from);
  var dir = fromClean.substring(0, fromClean.lastIndexOf('/'));
  var combined = dir ? dir + '/' + to : to;
  var parts = combined.split('/');
  var resolved = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p === '' || p === '.') continue;
    if (p === '..') resolved.pop();
    else resolved.push(p);
  }
  return resolved.join('/');
}

function extractRelativeRequires(content) {
  var requires = [];
  var reqRegex = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  var match;
  while ((match = reqRegex.exec(content)) !== null) {
    requires.push(match[1]);
  }
  var impRegex = /import\s+(?:[^'"]+)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;
  while ((match = impRegex.exec(content)) !== null) {
    requires.push(match[1]);
  }
  return requires;
}

function stripShebang(content) {
  if (content.startsWith('#!')) {
    var newline = content.indexOf('\n');
    return newline >= 0 ? content.slice(newline + 1) : '';
  }
  return content;
}

async function ensureDir(db, path) {
  var existing = await db.getItem(path);
  if (existing) return;
  var parent = path.substring(0, path.lastIndexOf('/')) || '/';
  await ensureDir(db, parent);
  await db.createDirectory(path);
}

async function writeFileToVFS(db, filePath, content) {
  var dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await ensureDir(db, dir);
  await db.createFile(filePath, content, true);
  if (window._vfsSyncCache) {
    window._vfsSyncCache.files.set(filePath, content);
    var d = dir;
    while (d && d !== '/') {
      if (!window._vfsSyncCache.dirs.has(d)) window._vfsSyncCache.dirs.set(d, []);
      d = d.substring(0, d.lastIndexOf('/')) || '/';
    }
  }
}

async function vfsHasFile(db, path) {
  if (window._vfsSyncCache && window._vfsSyncCache.files.has(path)) return true;
  if (!db) return false;
  try {
    var item = await db.getItem(path);
    return item && item.type === 'file';
  } catch (_) {
    return false;
  }
}

async function fetchPackageFiles(db, pkgName, pkgVersion, entryFile, pkgDir, visited, log) {
  if (!visited) visited = new Set();
  var clean = stripLeadingSlashes(entryFile);
  var withExt = hasJsExtension(clean) ? clean : clean + '.js';
  var vfsPath = pkgDir + '/' + withExt;

  if (visited.has(vfsPath)) return;
  visited.add(vfsPath);

  if (await vfsHasFile(db, vfsPath)) {
    if (log) log('  cached ' + withExt);
    var cached = (window._vfsSyncCache && window._vfsSyncCache.files.get(vfsPath)) || '';
    if (cached) {
      for (var _r of extractRelativeRequires(cached)) {
        var resolved = resolveRelativePath(clean, _r);
        await fetchPackageFiles(db, pkgName, pkgVersion, resolved, pkgDir, visited, log);
      }
    }
    return;
  }

  var content = await fetchFileFromUnpkg(pkgName, pkgVersion, clean);
  if (content == null) {
    if (!hasJsExtension(clean)) {
      content = await fetchFileFromUnpkg(pkgName, pkgVersion, clean + '.js');
    }
    if (content == null) {
      var asIndex = clean.replace(/\/$/, '') + '/index.js';
      var indexVfs = pkgDir + '/' + asIndex;
      if (await vfsHasFile(db, indexVfs)) {
        visited.add(indexVfs);
        if (log) log('  cached ' + asIndex);
        return;
      }
      content = await fetchFileFromUnpkg(pkgName, pkgVersion, asIndex);
      if (content != null) {
        visited.add(indexVfs);
        if (log) log('  fetched ' + asIndex);
        await writeFileToVFS(db, indexVfs, stripShebang(content));
        for (var _req of extractRelativeRequires(content)) {
          var _resolved = resolveRelativePath(asIndex, _req);
          await fetchPackageFiles(db, pkgName, pkgVersion, _resolved, pkgDir, visited, log);
        }
        return;
      }
      return;
    }
  }

  if (log) log('  fetched ' + withExt);
  await writeFileToVFS(db, vfsPath, stripShebang(content));

  for (var _req2 of extractRelativeRequires(content)) {
    var _resolved2 = resolveRelativePath(clean, _req2);
    await fetchPackageFiles(db, pkgName, pkgVersion, _resolved2, pkgDir, visited, log);
  }
}

var NpmHelpers = {
  CDN_BASE,
  UNPKG_BASE,
  GLOBAL_MODULES,
  ensureNpmRegistry,
  parsePackageSpec,
  stripLeadingSlashes,
  hasJsExtension,
  fetchPackageJson,
  fetchFileFromUnpkg,
  resolveRelativePath,
  extractRelativeRequires,
  stripShebang,
  ensureDir,
  writeFileToVFS,
  vfsHasFile,
  fetchPackageFiles
};

if (typeof globalThis !== 'undefined') {
  /** @type {*} */ (globalThis).NpmHelpers = NpmHelpers;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NpmHelpers;
}
