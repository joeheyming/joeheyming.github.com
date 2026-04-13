// npm command - Install and manage npm packages via esm.sh CDN
(function () {
  'use strict';

  var CDN_BASE = NpmHelpers.CDN_BASE;
  var GLOBAL_MODULES = NpmHelpers.GLOBAL_MODULES;
  var ensureRegistry = NpmHelpers.ensureNpmRegistry;
  var parsePackageSpec = NpmHelpers.parsePackageSpec;
  var stripLeadingSlashes = NpmHelpers.stripLeadingSlashes;
  var fetchPackageJson = NpmHelpers.fetchPackageJson;
  var ensureDir = NpmHelpers.ensureDir;
  var fetchPackageFiles = NpmHelpers.fetchPackageFiles;

  function classifyImportError(err) {
    const msg = err.message || '';
    if (
      err instanceof SyntaxError ||
      msg.includes('regular expression') ||
      msg.includes('Unexpected token')
    ) {
      return (
        'This package depends on Node.js built-in modules that cannot run in the browser.\n' +
        'Only packages with pure JavaScript / browser-compatible code work here.'
      );
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('404')) {
      return 'Could not fetch the package. Check that the package name is correct and exists on npm.';
    }
    return msg;
  }

  async function importPackage(name, version) {
    const versionSuffix = version && version !== 'latest' ? '@' + version : '';
    const url = CDN_BASE + '/' + name + versionSuffix;
    const mod = await import(url);
    return { module: mod, url };
  }

  async function writeGlobalPackageDir(db, name, version, url, pkgMeta) {
    if (!db) return;
    try {
      await ensureDir(db, GLOBAL_MODULES);
      const pkgDir = GLOBAL_MODULES + '/' + name;
      await ensureDir(db, pkgDir);
      const content = pkgMeta
        ? JSON.stringify(pkgMeta, null, 2) + '\n'
        : JSON.stringify(
            { name, version: version === 'latest' ? '*' : version, _source: url },
            null,
            2
          ) + '\n';
      const pkgPath = pkgDir + '/package.json';
      await db.createFile(pkgPath, content, true);
    } catch (_) {
      // best-effort
    }
  }

  async function removeGlobalPackageDir(db, name) {
    if (!db) return;
    try {
      const pkgDir = GLOBAL_MODULES + '/' + name;
      const item = await db.getItem(pkgDir);
      if (item) await db.deleteItem(pkgDir, true);
    } catch (_) {
      // best-effort
    }
  }

  async function listGlobalPackages(db) {
    if (!db) return [];
    try {
      const dir = await db.getItem(GLOBAL_MODULES);
      if (!dir || dir.type !== 'directory') return [];
      const children = await db.listDirectory(GLOBAL_MODULES);
      return children.filter((c) => c.type === 'directory').map((c) => c.path.split('/').pop());
    } catch (_) {
      return [];
    }
  }

  async function updatePackageJson(db, terminal, installed) {
    const pkgPath = terminal.resolvePath('package.json');
    let pkg = { name: 'terminal-project', version: '1.0.0', dependencies: {} };

    try {
      const existing = await terminal.getFileSystemItem(pkgPath);
      if (existing && existing.type === 'file' && existing.content) {
        pkg = JSON.parse(existing.content);
        if (!pkg.dependencies) pkg.dependencies = {};
      }
    } catch (_) {
      // start fresh
    }

    for (const { name, version } of installed) {
      pkg.dependencies[name] = version === 'latest' ? '*' : version;
    }

    if (db) {
      await db.createFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', true);
    }
  }

  async function removeFromPackageJson(db, terminal, names) {
    const pkgPath = terminal.resolvePath('package.json');
    try {
      const existing = await terminal.getFileSystemItem(pkgPath);
      if (existing && existing.type === 'file' && existing.content) {
        const pkg = JSON.parse(existing.content);
        if (pkg.dependencies) {
          for (const n of names) delete pkg.dependencies[n];
        }
        if (db) {
          await db.createFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', true);
        }
      }
    } catch (_) {
      // nothing to remove from
    }
  }

  function stripFlags(args) {
    return args.filter(
      (a) => a !== '-g' && a !== '--global' && a !== '--save' && a !== '--verbose'
    );
  }

  function hasVerboseFlag(args) {
    return args.includes('--verbose');
  }

  async function npmCommand(terminal, args) {
    const registry = ensureRegistry();
    const db = terminal.fileSystemDB;

    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
      return {
        stdout: [
          'npm - Node Package Manager (esm.sh edition)',
          '',
          'Usage:',
          '  npm install [-g] <pkg>[@version] [...]   Install packages',
          '  npm uninstall <pkg> [...]                 Remove installed packages',
          '  npm list                                  List installed packages',
          '  npm help                                  Show this help',
          '',
          'Options:',
          '  --verbose    Show progress during install and fetch',
          '',
          'Environment:',
          '  NPM_VERBOSE=1   Same as --verbose',
          '',
          'Packages are loaded from https://esm.sh as ES modules.',
          'Installed packages can be used with npx or require() in node scripts.',
          'Global packages are stored in ' + GLOBAL_MODULES + '/',
          ''
        ].join('\n'),
        stderr: '',
        exitCode: 0
      };
    }

    const subcommand = args[0];

    if (subcommand === 'install' || subcommand === 'i' || subcommand === 'add') {
      const rawArgs = args.slice(1);
      const specs = stripFlags(rawArgs);
      const isVerbose = hasVerboseFlag(rawArgs) || terminal.env.NPM_VERBOSE === '1';
      const log = isVerbose ? (msg) => terminal.writeOutput(msg + '\n') : () => {};

      if (specs.length === 0) {
        return {
          stdout: '',
          stderr: 'npm install: please specify at least one package\n',
          exitCode: 1
        };
      }

      const results = [];
      const errors = [];

      for (const spec of specs) {
        const { name, version } = parsePackageSpec(spec);
        try {
          log('Fetching ' + name + '...');
          const { module: mod, url } = await importPackage(name, version);
          let pkgMeta = null;
          try {
            pkgMeta = await fetchPackageJson(name, version);
          } catch (_) {
            // metadata is optional; module already loaded
          }
          registry.modules.set(name, { module: mod, version, url, packageJson: pkgMeta });
          await writeGlobalPackageDir(db, name, version, url, pkgMeta);

          if (pkgMeta && db) {
            const pkgDir = GLOBAL_MODULES + '/' + name;
            const mainEntry = pkgMeta.main || 'index.js';
            log('Downloading source files...');
            const visited = new Set();
            await fetchPackageFiles(
              db,
              name,
              pkgMeta.version || version,
              mainEntry,
              pkgDir,
              visited,
              log
            );

            if (pkgMeta.bin) {
              const bins = typeof pkgMeta.bin === 'string' ? { [name]: pkgMeta.bin } : pkgMeta.bin;
              for (const binFile of Object.values(bins)) {
                if (
                  !visited.has(pkgDir + '/' + stripLeadingSlashes(binFile)) &&
                  !visited.has(pkgDir + '/' + stripLeadingSlashes(binFile) + '.js')
                ) {
                  await fetchPackageFiles(
                    db,
                    name,
                    pkgMeta.version || version,
                    binFile,
                    pkgDir,
                    visited,
                    log
                  );
                }
              }
            }
          }

          results.push({ name, version: pkgMeta ? pkgMeta.version : version });
        } catch (err) {
          errors.push('npm ERR! ' + name + ': ' + classifyImportError(err));
        }
      }

      if (results.length > 0) {
        await updatePackageJson(db, terminal, results);
      }

      const lines = [];
      for (const r of results) {
        lines.push('+ ' + r.name + (r.version !== 'latest' ? '@' + r.version : ''));
      }
      if (results.length > 0) {
        lines.push('');
        lines.push(
          'added ' +
            results.length +
            ' package' +
            (results.length !== 1 ? 's' : '') +
            ' to ' +
            GLOBAL_MODULES +
            '/'
        );
        lines.push('');
      }

      const stdout = lines.join('\n') + (lines.length > 0 ? '\n' : '');
      const stderr = errors.length > 0 ? errors.join('\n') + '\n' : '';
      return { stdout, stderr, exitCode: errors.length > 0 ? 1 : 0 };
    }

    if (subcommand === 'uninstall' || subcommand === 'remove' || subcommand === 'rm') {
      const names = stripFlags(args.slice(1));
      if (names.length === 0) {
        return {
          stdout: '',
          stderr: 'npm uninstall: please specify at least one package\n',
          exitCode: 1
        };
      }

      const removed = [];
      const notFound = [];

      for (const name of names) {
        if (registry.modules.has(name)) {
          registry.modules.delete(name);
          await removeGlobalPackageDir(db, name);
          removed.push(name);
        } else {
          notFound.push(name);
        }
      }

      if (removed.length > 0) {
        await removeFromPackageJson(db, terminal, removed);
      }

      const lines = [];
      for (const n of removed) lines.push('- ' + n);
      if (removed.length > 0) {
        lines.push('');
        lines.push('removed ' + removed.length + ' package' + (removed.length !== 1 ? 's' : ''));
      }
      for (const n of notFound) lines.push('npm WARN not installed: ' + n);

      return {
        stdout: lines.join('\n') + '\n',
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'list' || subcommand === 'ls') {
      const memNames = Array.from(registry.modules.keys());
      const fsNames = await listGlobalPackages(db);
      const allNames = [...new Set([...memNames, ...fsNames])].sort();

      if (allNames.length === 0) {
        return { stdout: '(no packages installed)\n', stderr: '', exitCode: 0 };
      }

      const lines = [GLOBAL_MODULES + '/'];
      for (const name of allNames) {
        const info = registry.modules.get(name);
        const ver = info && info.version !== 'latest' ? '@' + info.version : '';
        const loaded = info ? '' : ' (not loaded)';
        lines.push('  ' + name + ver + loaded);
      }
      return {
        stdout: lines.join('\n') + '\n',
        stderr: '',
        exitCode: 0
      };
    }

    return {
      stdout: '',
      stderr: 'npm: unknown command "' + subcommand + '". Run npm help for usage.\n',
      exitCode: 1
    };
  }

  ensureRegistry();

  registerCommand('npm', npmCommand, 'Install and manage npm packages via esm.sh CDN', 'System');
})();
