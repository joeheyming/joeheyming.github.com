/**
 * Pure helpers for the browser-based Node.js runtime.
 */

function transformImportStatements(content) {
  content = content.replace(
    /^(?:const|let|var)\s+__filename\s*=.*$/gm,
    '// __filename provided by runtime'
  );
  content = content.replace(
    /^(?:const|let|var)\s+__dirname\s*=.*$/gm,
    '// __dirname provided by runtime'
  );

  content = content.replace(
    /^import\s+\{[^}]*fileURLToPath[^}]*\}\s+from\s+['"]url['"];?\s*$/gm,
    '// url import stripped'
  );

  content = content.replace(/import\.meta\.url/g, '__filename');

  content = content.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    "const $1 = require('$2').default;"
  );

  content = content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    function (_, names, mod) {
      var converted = names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2');
      return 'const {' + converted + "} = require('" + mod + "');";
    }
  );

  content = content.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
    "const $1 = require('$2');"
  );

  content = content.replace(/^(\s*)program\.parse\s*\(/gm, '$1await program.parse(');

  var lines = content.split('\n');
  var result = [];
  var skipDepth = 0;
  for (var li = 0; li < lines.length; li++) {
    if (skipDepth === 0 && /^\s*process\.on\s*\(/.test(lines[li])) {
      for (var ci = 0; ci < lines[li].length; ci++) {
        if (lines[li][ci] === '(') skipDepth++;
        if (lines[li][ci] === ')') skipDepth--;
      }
      if (skipDepth <= 0) {
        skipDepth = 0;
      }
      continue;
    }
    if (skipDepth > 0) {
      for (var ci2 = 0; ci2 < lines[li].length; ci2++) {
        if (lines[li][ci2] === '(') skipDepth++;
        if (lines[li][ci2] === ')') skipDepth--;
      }
      if (skipDepth <= 0) skipDepth = 0;
      continue;
    }
    result.push(lines[li]);
  }
  content = result.join('\n');

  return content;
}

function transformExportStatements(content) {
  content = content.replace(/export\s+default\s+(.+);?$/gm, 'module.exports = $1;');

  content = content.replace(/export\s+\{([^}]+)\};?$/gm, function (_, names) {
    var converted = names.replace(/(\w+)\s+as\s+(\w+)/g, '$2: $1');
    return 'module.exports = {' + converted + '};';
  });

  content = content.replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function $1');

  content = content.replace(/export\s+const\s+(\w+)\s*=\s*(.+);?$/gm, 'exports.$1 = $2;');

  return content;
}

function hasJsExtension(p) {
  return /\.(js|mjs|cjs|json)$/.test(p);
}

function isBareModuleName(importPath) {
  return (
    !importPath.startsWith('./') && !importPath.startsWith('../') && !importPath.startsWith('/')
  );
}

function withDefaultSelf(mod) {
  if (mod && typeof mod === 'object' && !('default' in mod)) {
    mod.default = mod;
  }
  return mod;
}

function createPathModule() {
  const sep = '/';
  function normalize(p) {
    const parts = p.split('/');
    const resolved = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') resolved.pop();
      else resolved.push(part);
    }
    const result = resolved.join('/');
    return p.startsWith('/') ? '/' + result : result || '.';
  }
  function join() {
    return normalize(Array.prototype.slice.call(arguments).filter(Boolean).join('/'));
  }
  function dirname(p) {
    const idx = p.lastIndexOf('/');
    return idx <= 0 ? (p.startsWith('/') ? '/' : '.') : p.substring(0, idx);
  }
  function basename(p, ext) {
    let base = p.substring(p.lastIndexOf('/') + 1);
    if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
    return base;
  }
  function extname(p) {
    const base = basename(p);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.substring(dot);
  }
  function resolve() {
    let resolved = '';
    for (let i = arguments.length - 1; i >= 0; i--) {
      resolved = arguments[i] + (resolved ? '/' + resolved : '');
      if (resolved.startsWith('/')) break;
    }
    return normalize(resolved.startsWith('/') ? resolved : '/' + resolved);
  }
  function isAbsolute(p) {
    return p.startsWith('/');
  }
  function relative(from, to) {
    const fromParts = normalize(from).split('/').filter(Boolean);
    const toParts = normalize(to).split('/').filter(Boolean);
    let common = 0;
    while (
      common < fromParts.length &&
      common < toParts.length &&
      fromParts[common] === toParts[common]
    ) {
      common++;
    }
    const ups = fromParts.length - common;
    const result = [];
    for (let i = 0; i < ups; i++) result.push('..');
    return result.concat(toParts.slice(common)).join('/') || '.';
  }
  return {
    sep,
    delimiter: ':',
    join,
    resolve,
    normalize,
    dirname,
    basename,
    extname,
    isAbsolute,
    relative,
    parse: function (p) {
      return {
        root: p.startsWith('/') ? '/' : '',
        dir: dirname(p),
        base: basename(p),
        ext: extname(p),
        name: basename(p, extname(p))
      };
    },
    format: function (obj) {
      return (obj.dir || obj.root || '') + '/' + (obj.base || obj.name + (obj.ext || ''));
    }
  };
}

function createOSModule() {
  return {
    EOL: '\n',
    platform: function () {
      return 'browser';
    },
    type: function () {
      return 'Browser';
    },
    homedir: function () {
      return '/home/user';
    },
    tmpdir: function () {
      return '/tmp';
    },
    hostname: function () {
      return 'localhost';
    },
    arch: function () {
      return 'wasm';
    }
  };
}

function createUrlModule() {
  return {
    fileURLToPath: function (url) {
      if (typeof url === 'string' && url.startsWith('file://')) {
        return url.slice(7);
      }
      return url;
    },
    pathToFileURL: function (p) {
      return 'file://' + p;
    }
  };
}

function nodeResult(stdout, stderr, exitCode) {
  return {
    stdout: stdout != null ? String(stdout) : '',
    stderr: stderr != null ? String(stderr) : '',
    exitCode: exitCode !== undefined && exitCode !== null ? exitCode : 0
  };
}

function resolveImportPath(importPath, currentFilePath, resolvePath) {
  if (importPath.startsWith('/')) {
    return hasJsExtension(importPath) ? importPath : importPath + '.js';
  } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) || '/';
    const resolvedPath = resolvePath(currentDir + '/' + importPath);
    return hasJsExtension(resolvedPath) ? resolvedPath : resolvedPath + '.js';
  } else {
    const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) || '/';
    const resolvedPath = resolvePath(currentDir + '/' + importPath);
    return hasJsExtension(resolvedPath) ? resolvedPath : resolvedPath + '.js';
  }
}

export var NodeHelpers = {
  transformImportStatements,
  transformExportStatements,
  hasJsExtension,
  isBareModuleName,
  withDefaultSelf,
  createPathModule,
  createOSModule,
  createUrlModule,
  nodeResult,
  resolveImportPath
};
