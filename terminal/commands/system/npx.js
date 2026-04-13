// npx command - Fetch and run npm package bin scripts via unpkg + esm.sh

import { commandRegistry } from '../../commands.js';
import { NpmHelpers } from '../../lib/npm-helpers.js';

var CDN_BASE = NpmHelpers.CDN_BASE;
var GLOBAL_MODULES = NpmHelpers.GLOBAL_MODULES;
var ensureRegistry = NpmHelpers.ensureNpmRegistry;
var stripLeadingSlashes = NpmHelpers.stripLeadingSlashes;
var hasJsExtension = NpmHelpers.hasJsExtension;
var fetchPackageJson = NpmHelpers.fetchPackageJson;
var fetchPackageFiles = NpmHelpers.fetchPackageFiles;

async function installEsmModule(name, version, log) {
  var registry = ensureRegistry();
  if (registry.modules.has(name)) return registry.modules.get(name);
  if (log) log('  installing ' + name + '...');
  var versionSuffix = version ? '@' + version : '';
  var url = CDN_BASE + '/' + name + versionSuffix;
  try {
    var mod = await import(url);
    var entry = { module: mod, version: version || 'latest', url, packageJson: null };
    registry.modules.set(name, entry);
    return entry;
  } catch (_) {
    return null;
  }
}

function parseNpxArgs(args) {
  var packageVersion = null;
  var packageName = null;
  var verbose = false;
  var filteredArgs = [];
  var i = 0;

  while (i < args.length) {
    if (args[i] === '--verbose') {
      verbose = true;
      i++;
      continue;
    }
    if (args[i] === '-p' || args[i] === '--package') {
      if (i + 1 < args.length) {
        var spec = args[i + 1];
        var atIdx = spec.lastIndexOf('@');
        if (atIdx > 0) {
          packageName = spec.slice(0, atIdx);
          packageVersion = spec.slice(atIdx + 1);
        } else {
          packageName = spec;
        }
        i += 2;
        continue;
      }
    }
    filteredArgs.push(args[i]);
    i++;
  }

  if (!packageName && filteredArgs.length > 0) {
    var spec2 = filteredArgs[0];
    var atIdx2 = spec2.lastIndexOf('@');
    if (atIdx2 > 0) {
      packageName = spec2.slice(0, atIdx2);
      packageVersion = spec2.slice(atIdx2 + 1);
    } else {
      packageName = spec2;
    }
  }

  var commandArgs = filteredArgs.slice(1);
  return { packageName, packageVersion, commandArgs, verbose };
}

async function npxCommand(terminal, args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return {
      stdout: [
        'npx - Run npm package binaries',
        '',
        'Usage:',
        '  npx <package>[@version] [args...]    Run a package',
        '  npx -p <package> <command> [args...]  Specify package explicitly',
        '',
        'Options:',
        '  --verbose    Show progress during install and fetch',
        '',
        'Environment:',
        '  NPX_VERBOSE=1   Same as --verbose',
        '',
        'Fetches the package from npm (via unpkg.com), installs its dependencies',
        'from esm.sh, and runs the bin script through the node runtime.',
        ''
      ].join('\n'),
      stderr: '',
      exitCode: 0
    };
  }

  var { packageName, packageVersion, commandArgs, verbose } = parseNpxArgs(args);

  if (!packageName) {
    return { stdout: '', stderr: 'npx: missing package name\n', exitCode: 1 };
  }

  var registry = ensureRegistry();
  var db = terminal.fileSystemDB;
  var isVerbose = verbose || terminal.env.NPX_VERBOSE === '1';
  var log = isVerbose ? (msg) => terminal.writeOutput(msg + '\n') : () => {};

  log('npx: resolving ' + packageName + '...');

  var pkgMeta;
  try {
    var cached = registry.modules.get(packageName);
    if (cached && cached.packageJson) {
      pkgMeta = cached.packageJson;
    } else {
      pkgMeta = await fetchPackageJson(packageName, packageVersion);
    }
  } catch (err) {
    return {
      stdout: '',
      stderr:
        'npx: could not fetch package metadata for "' +
        packageName +
        '"\n' +
        (err.message || '') +
        '\n',
      exitCode: 1
    };
  }

  var binField = pkgMeta.bin;
  if (!binField) {
    return {
      stdout: '',
      stderr: 'npx: package "' + packageName + '" has no bin entry in its package.json\n',
      exitCode: 1
    };
  }

  var binPath;
  if (typeof binField === 'string') {
    binPath = binField;
  } else if (typeof binField === 'object') {
    binPath = binField[packageName] || Object.values(binField)[0];
  }
  if (!binPath) {
    return {
      stdout: '',
      stderr: 'npx: could not determine bin entry for "' + packageName + '"\n',
      exitCode: 1
    };
  }

  var pkgVersion = pkgMeta.version || packageVersion || 'latest';
  var pkgDir = GLOBAL_MODULES + '/' + packageName;

  var deps = pkgMeta.dependencies || {};
  var depNames = Object.keys(deps);
  if (depNames.length > 0) {
    log('npx: installing ' + depNames.length + ' dependencies...');
  }
  for (var depName of depNames) {
    var depVersion = deps[depName].replace(/^[\^~>=<]+/, '');
    await installEsmModule(depName, depVersion, log);
  }

  log('npx: fetching ' + packageName + '@' + pkgVersion + ' files...');
  try {
    await fetchPackageFiles(db, packageName, pkgVersion, binPath, pkgDir, null, log);
  } catch (err) {
    return {
      stdout: '',
      stderr:
        'npx: failed to fetch bin script for "' + packageName + '": ' + (err.message || '') + '\n',
      exitCode: 1
    };
  }

  var normalizedBin = stripLeadingSlashes(binPath);
  var binVfsPath = pkgDir + '/' + normalizedBin;
  if (!hasJsExtension(binVfsPath)) binVfsPath += '.js';

  log('npx: running ' + packageName + '...');

  var nodeHandler = await commandRegistry.get('node');
  if (!nodeHandler) {
    return {
      stdout: '',
      stderr: 'npx: node command not available\n',
      exitCode: 1
    };
  }

  return nodeHandler(terminal, [binVfsPath, ...commandArgs]);
}

ensureRegistry();

export default {
  name: 'npx',
  handler: npxCommand,
  description: 'Run npm package binaries',
  category: 'System'
};
