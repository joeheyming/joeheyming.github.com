// Node.js command - Execute JavaScript files using Node-like runtime
(function () {
  'use strict';

  // Module cache to prevent circular imports and improve performance
  const moduleCache = new Map();

  // Create a Node.js-like fs module that works with the terminal's filesystem
  function createFSModule(terminal) {
    return {
      readFileSync: (filePath, encoding = 'utf8') => {
        // Since this is supposed to be synchronous but our filesystem is async,
        // we'll need to throw an error for now
        throw new Error(
          'readFileSync requires async filesystem access. Use the terminal filesystem commands instead.'
        );
      },

      writeFileSync: (filePath, data, encoding = 'utf8') => {
        throw new Error('writeFileSync not yet implemented in web terminal');
      },

      existsSync: (filePath) => {
        throw new Error(
          'existsSync requires async filesystem access. Use the terminal filesystem commands instead.'
        );
      }
    };
  }

  // Transform ES6 import statements to use require-like syntax
  function transformImportStatements(content) {
    // Transform: import defaultExport from 'module'
    // To: const defaultExport = require('module').default
    content = content.replace(
      /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      "const $1 = require('$2').default;"
    );

    // Transform: import { named1, named2 } from 'module'
    // To: const { named1, named2 } = require('module')
    content = content.replace(
      /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      "const {$1} = require('$2');"
    );

    // Transform: import * as namespace from 'module'
    // To: const namespace = require('module')
    content = content.replace(
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      "const $1 = require('$2');"
    );

    return content;
  }

  // Transform ES6 export statements to CommonJS
  function transformExportStatements(content) {
    // Transform: export default something
    // To: module.exports = something
    content = content.replace(/export\s+default\s+(.+);?$/gm, 'module.exports = $1;');

    // Transform: export { named1, named2 }
    // To: module.exports = { named1, named2 }
    content = content.replace(/export\s+\{([^}]+)\};?$/gm, 'module.exports = {$1};');

    // Transform: export function funcName() {}
    // To: exports.funcName = function funcName() {}
    content = content.replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function $1');

    // Transform: export const varName = value
    // To: exports.varName = value
    content = content.replace(/export\s+const\s+(\w+)\s*=\s*(.+);?$/gm, 'exports.$1 = $2;');

    return content;
  }

  // Helper function to resolve import paths
  function resolveImportPath(importPath, currentFilePath, terminal) {
    if (importPath.startsWith('/')) {
      // Absolute path
      return importPath.endsWith('.js') ? importPath : importPath + '.js';
    } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Relative path
      const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) || '/';
      const resolvedPath = terminal.resolvePath(currentDir + '/' + importPath);
      return resolvedPath.endsWith('.js') ? resolvedPath : resolvedPath + '.js';
    } else {
      // Module name (treat as relative for now)
      const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) || '/';
      const resolvedPath = terminal.resolvePath(currentDir + '/' + importPath);
      return resolvedPath.endsWith('.js') ? resolvedPath : resolvedPath + '.js';
    }
  }

  // Function to execute a module synchronously and return its exports
  async function executeModuleSync(filePath, terminal, parentPath = null) {
    // Check cache first
    if (moduleCache.has(filePath)) {
      return moduleCache.get(filePath);
    }

    // Check if file exists
    const fileItem = await terminal.getFileSystemItem(filePath);
    if (!fileItem) {
      throw new Error(`Module not found: ${filePath}`);
    }

    if (fileItem.type !== 'file') {
      throw new Error(`Cannot import directory: ${filePath}`);
    }

    if (!filePath.endsWith('.js')) {
      throw new Error(`Can only import JavaScript files: ${filePath}`);
    }

    let content = fileItem.content;
    if (!content) {
      throw new Error(`Module is empty: ${filePath}`);
    }

    // Transform ES6 import statements to use require
    content = transformImportStatements(content);

    // Transform export statements
    content = transformExportStatements(content);

    // Module loading debug removed

    // Create module context
    const moduleExports = {};
    const moduleObject = { exports: moduleExports };

    // Create require function for this module
    const requireFunction = (importPath) => {
      const resolvedPath = resolveImportPath(importPath, filePath, terminal);

      // Check cache first
      if (moduleCache.has(resolvedPath)) {
        return moduleCache.get(resolvedPath);
      }

      throw new Error(`Module '${importPath}' not found or not preloaded`);
    };

    // Enhanced require function that handles built-in modules
    const enhancedRequire = (moduleName) => {
      if (moduleName === 'fs') {
        return createFSModule(terminal);
      }
      return requireFunction(moduleName);
    };

    // Add to cache before execution to handle circular dependencies
    moduleCache.set(filePath, moduleExports);

    try {
      // Create execution context
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
        process: {
          argv: ['node', filePath],
          env: terminal.env || {},
          cwd: () => terminal.currentDirectory || '/',
          exit: (code = 0) => {
            throw new Error(`Process exited with code ${code}`);
          }
        }
      };

      // Execute the module using eval in the context
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);
      const func = new Function(...contextKeys, content);
      func.apply(null, contextValues);

      // Update cache with final exports
      let finalExports =
        moduleObject.exports === moduleExports ? moduleExports : moduleObject.exports;

      // Handle default exports properly for ES6 imports
      if (finalExports !== moduleExports) {
        // module.exports was reassigned - this is a default export
        if (typeof finalExports === 'function') {
          // For functions, create a wrapper object with default property
          const wrapper = { default: finalExports };
          finalExports = wrapper;
        } else if (typeof finalExports !== 'object' || finalExports === null) {
          // For primitive values, wrap in an object
          finalExports = { default: finalExports };
        } else {
          // For objects, add default property pointing to the object itself
          finalExports.default = finalExports;
        }
      }

      moduleCache.set(filePath, finalExports);
      return finalExports;
    } catch (error) {
      // Remove from cache on error
      moduleCache.delete(filePath);
      throw error;
    }
  }

  // Function to preload all modules by analyzing require calls
  async function preloadModules(content, currentFilePath, terminal, visited = new Set()) {
    if (visited.has(currentFilePath)) {
      return; // Avoid infinite recursion
    }
    visited.add(currentFilePath);

    // Find all require calls in the content
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;

    while ((match = requireRegex.exec(content)) !== null) {
      const importPath = match[1];

      // Skip built-in modules
      if (importPath === 'fs') {
        continue;
      }

      const resolvedPath = resolveImportPath(importPath, currentFilePath, terminal);

      // Skip if already cached
      if (moduleCache.has(resolvedPath)) {
        continue;
      }

      try {
        // Load the module
        await executeModuleSync(resolvedPath, terminal, currentFilePath);
      } catch (error) {
        // Don't throw here, let the actual require() call handle the error
        console.warn('Failed to preload module:', resolvedPath, error.message);
      }
    }
  }

  /** @returns {{ stdout: string, stderr: string, exitCode: number }} */
  function nodeResult(stdout, stderr, exitCode) {
    return {
      stdout: stdout != null ? String(stdout) : '',
      stderr: stderr != null ? String(stderr) : '',
      exitCode: exitCode !== undefined && exitCode !== null ? exitCode : 0
    };
  }

  async function nodeCommand(terminal, args) {
    if (args.length === 0) {
      return nodeResult('', 'Usage: node <filename.js> [arguments...]', 1);
    }

    const filename = args[0];
    const nodeArgs = args.slice(1);

    // Resolve the file path
    const filePath = terminal.resolvePath(filename);

    let output = '';
    let errorOutput = '';

    try {
      // Check if file exists
      const fileItem = await terminal.getFileSystemItem(filePath);
      if (!fileItem) {
        return nodeResult('', `node: can't open file '${filename}': No such file or directory`, 1);
      }

      if (fileItem.type !== 'file') {
        return nodeResult('', `node: '${filename}' is a directory`, 1);
      }

      if (!filePath.endsWith('.js')) {
        return nodeResult('', `node: '${filename}' is not a JavaScript file`, 1);
      }

      let content = fileItem.content;
      if (!content) {
        return nodeResult('', `node: '${filename}' is empty`, 1);
      }

      // Transform ES6 import statements to use require
      content = transformImportStatements(content);

      // Transform export statements
      content = transformExportStatements(content);

      // Debug output removed

      // Capture console output
      output = '';
      errorOutput = '';

      // Override console to capture output
      const originalConsole = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      console.log = (...args) => {
        output += args.join(' ') + '\n';
        originalConsole(...args); // Also log to browser console for debugging
      };

      console.error = (...args) => {
        errorOutput += args.join(' ') + '\n';
        originalError(...args);
      };

      console.warn = (...args) => {
        errorOutput += args.join(' ') + '\n';
        originalWarn(...args);
      };

      try {
        // Preload all required modules by analyzing the transformed code
        await preloadModules(content, filePath, terminal);

        // Create require function for the main script
        const requireFunction = (importPath) => {
          const resolvedPath = resolveImportPath(importPath, filePath, terminal);

          // Since require must be synchronous, we need to throw if module isn't cached
          if (!moduleCache.has(resolvedPath)) {
            throw new Error(
              `Module '${importPath}' not preloaded. This is a limitation of the web environment.`
            );
          }

          return moduleCache.get(resolvedPath);
        };

        // Enhanced require function that handles built-in modules
        const enhancedRequire = (moduleName) => {
          if (moduleName === 'fs') {
            return createFSModule(terminal);
          }
          return requireFunction(moduleName);
        };

        // Create execution context for main script
        const context = {
          require: enhancedRequire,
          __filename: filePath,
          __dirname: filePath.substring(0, filePath.lastIndexOf('/')) || '/',
          console: {
            log: console.log,
            error: console.error,
            warn: console.warn
          },
          process: {
            argv: ['node', filePath, ...nodeArgs],
            env: terminal.env || {},
            cwd: () => terminal.currentDirectory || '/',
            exit: (code = 0) => {
              throw new Error(`Process exited with code ${code}`);
            }
          }
        };

        // Execute the main script
        const contextKeys = Object.keys(context);
        const contextValues = Object.values(context);
        const func = new Function(...contextKeys, content);
        func.apply(null, contextValues);
      } finally {
        // Restore original console
        console.log = originalConsole;
        console.error = originalError;
        console.warn = originalWarn;
      }

      return nodeResult(output, errorOutput, 0);
    } catch (error) {
      const exitMatch = /^Process exited with code (.+)$/.exec(error.message);
      if (exitMatch) {
        const n = Math.trunc(Number(exitMatch[1]));
        const code = Number.isFinite(n) ? ((n % 256) + 256) % 256 : 0;
        // output / errorOutput are still set from the inner try before process.exit threw
        return nodeResult(output, errorOutput, code);
      }
      return nodeResult('', `node: ${error.message}`, 1);
    }
  }

  // Register the command
  registerCommand(
    'node',
    nodeCommand,
    'Execute JavaScript files using Node-like runtime',
    'System'
  );
})();
