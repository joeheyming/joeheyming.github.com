'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../lib/node-helpers');

// ---------------------------------------------------------------------------
// transformImportStatements
// ---------------------------------------------------------------------------

test('transformImportStatements: strips __filename declarations', () => {
  const input = "const __filename = fileURLToPath(import.meta.url);\nconsole.log('hi');";
  const out = transformImportStatements(input);
  assert.ok(!out.includes('const __filename'));
  assert.ok(out.includes("console.log('hi')"));
});

test('transformImportStatements: strips __dirname declarations', () => {
  const input = 'const __dirname = dirname(__filename);\nconst x = 1;';
  const out = transformImportStatements(input);
  assert.ok(!out.includes('const __dirname'));
  assert.ok(out.includes('const x = 1'));
});

test('transformImportStatements: strips let/var __filename/__dirname', () => {
  const input = 'let __filename = "a";\nvar __dirname = "b";';
  const out = transformImportStatements(input);
  assert.ok(!out.includes('let __filename'));
  assert.ok(!out.includes('var __dirname'));
});

test('transformImportStatements: strips fileURLToPath import from url', () => {
  const input = "import {fileURLToPath} from 'url';\nconsole.log(1);";
  const out = transformImportStatements(input);
  assert.ok(!out.includes('fileURLToPath'));
  assert.ok(out.includes('console.log(1)'));
});

test('transformImportStatements: replaces import.meta.url with __filename', () => {
  const input = 'const u = import.meta.url;';
  const out = transformImportStatements(input);
  assert.equal(out.trim(), 'const u = __filename;');
});

test('transformImportStatements: transforms default import', () => {
  const input = "import fs from 'fs';";
  const out = transformImportStatements(input);
  assert.equal(out.trim(), "const fs = require('fs').default;");
});

test('transformImportStatements: transforms named imports', () => {
  const input = "import { readFile, writeFile } from 'fs';";
  const out = transformImportStatements(input);
  assert.equal(out.trim(), "const { readFile, writeFile } = require('fs');");
});

test('transformImportStatements: transforms named imports with as aliases', () => {
  const input = "import { f as figlet, g as getFontName } from './figlet.js';";
  const out = transformImportStatements(input);
  assert.equal(out.trim(), "const { f: figlet, g: getFontName } = require('./figlet.js');");
});

test('transformImportStatements: transforms namespace import', () => {
  const input = "import * as path from 'path';";
  const out = transformImportStatements(input);
  assert.equal(out.trim(), "const path = require('path');");
});

test('transformImportStatements: adds await before program.parse()', () => {
  const input = '  program.parse(process.argv);';
  const out = transformImportStatements(input);
  assert.equal(out.trim(), 'await program.parse(process.argv);');
});

test('transformImportStatements: strips single-line process.on()', () => {
  const input = "process.on('exit', () => {});\nconsole.log('kept');";
  const out = transformImportStatements(input);
  assert.ok(!out.includes('process.on'));
  assert.ok(out.includes("console.log('kept')"));
});

test('transformImportStatements: strips multi-line process.on()', () => {
  const input = [
    "process.on('uncaughtException', function(err) {",
    '  console.error(err);',
    '});',
    'const x = 1;'
  ].join('\n');
  const out = transformImportStatements(input);
  assert.ok(!out.includes('process.on'));
  assert.ok(!out.includes('console.error'));
  assert.ok(out.includes('const x = 1'));
});

test('transformImportStatements: combined transforms', () => {
  const input = [
    "import {fileURLToPath} from 'url';",
    'const __filename = fileURLToPath(import.meta.url);',
    "const __dirname = '/some/dir';",
    "import fs from 'fs';",
    "import { join } from 'path';",
    "import * as os from 'os';",
    "process.on('exit', () => {});",
    'const greeting = "hello";'
  ].join('\n');
  const out = transformImportStatements(input);
  assert.ok(!out.includes('const __filename'));
  assert.ok(!out.includes('const __dirname'));
  assert.ok(!out.includes('process.on'));
  assert.ok(out.includes("const fs = require('fs').default;"));
  assert.ok(out.includes("const { join } = require('path');"));
  assert.ok(out.includes("const os = require('os');"));
  assert.ok(out.includes('const greeting = "hello"'));
});

// ---------------------------------------------------------------------------
// transformExportStatements
// ---------------------------------------------------------------------------

test('transformExportStatements: export default', () => {
  const out = transformExportStatements('export default myFunction;');
  assert.ok(out.includes('module.exports = myFunction'));
  assert.ok(!out.includes('export default'));
});

test('transformExportStatements: export named', () => {
  const input = 'export { foo, bar };';
  const out = transformExportStatements(input);
  assert.equal(out.trim(), 'module.exports = { foo, bar };');
});

test('transformExportStatements: export with as alias', () => {
  const input = 'export { figlet as f, getFontName as g };';
  const out = transformExportStatements(input);
  assert.equal(out.trim(), 'module.exports = { f: figlet, g: getFontName };');
});

test('transformExportStatements: export function', () => {
  const input = 'export function myHelper(x) { return x; }';
  const out = transformExportStatements(input);
  assert.equal(out.trim(), 'exports.myHelper = function myHelper(x) { return x; }');
});

test('transformExportStatements: export const', () => {
  const out = transformExportStatements('export const VERSION = "1.0.0";');
  assert.ok(out.includes('exports.VERSION = "1.0.0"'));
  assert.ok(!out.includes('export const'));
});

// ---------------------------------------------------------------------------
// hasJsExtension
// ---------------------------------------------------------------------------

test('hasJsExtension: .js', () => assert.equal(hasJsExtension('foo.js'), true));
test('hasJsExtension: .mjs', () => assert.equal(hasJsExtension('bar.mjs'), true));
test('hasJsExtension: .cjs', () => assert.equal(hasJsExtension('baz.cjs'), true));
test('hasJsExtension: .json', () => assert.equal(hasJsExtension('data.json'), true));
test('hasJsExtension: no extension', () => assert.equal(hasJsExtension('lodash'), false));
test('hasJsExtension: .txt', () => assert.equal(hasJsExtension('readme.txt'), false));
test('hasJsExtension: .cow', () => assert.equal(hasJsExtension('default.cow'), false));
test('hasJsExtension: path with .js', () =>
  assert.equal(hasJsExtension('/usr/lib/node_modules/foo/index.js'), true));

// ---------------------------------------------------------------------------
// isBareModuleName
// ---------------------------------------------------------------------------

test('isBareModuleName: bare name', () => assert.equal(isBareModuleName('lodash'), true));
test('isBareModuleName: scoped package', () => assert.equal(isBareModuleName('@babel/core'), true));
test('isBareModuleName: relative ./', () => assert.equal(isBareModuleName('./lib/foo'), false));
test('isBareModuleName: relative ../', () => assert.equal(isBareModuleName('../util'), false));
test('isBareModuleName: absolute /', () =>
  assert.equal(isBareModuleName('/usr/lib/node_modules/x'), false));

// ---------------------------------------------------------------------------
// withDefaultSelf
// ---------------------------------------------------------------------------

test('withDefaultSelf: adds .default pointing to self', () => {
  const mod = { foo: 1, bar: 2 };
  const result = withDefaultSelf(mod);
  assert.equal(result.default, mod);
  assert.equal(result, mod);
});

test('withDefaultSelf: does not overwrite existing .default', () => {
  const mod = { foo: 1, default: 'already' };
  withDefaultSelf(mod);
  assert.equal(mod.default, 'already');
});

test('withDefaultSelf: returns null/undefined as-is', () => {
  assert.equal(withDefaultSelf(null), null);
  assert.equal(withDefaultSelf(undefined), undefined);
});

test('withDefaultSelf: non-object passes through', () => {
  assert.equal(withDefaultSelf(42), 42);
  assert.equal(withDefaultSelf('str'), 'str');
});

// ---------------------------------------------------------------------------
// createPathModule
// ---------------------------------------------------------------------------

test('path.join: simple', () => {
  const path = createPathModule();
  assert.equal(path.join('/usr', 'lib', 'node_modules'), '/usr/lib/node_modules');
});

test('path.join: with .. and .', () => {
  const path = createPathModule();
  assert.equal(path.join('/usr/lib', '..', 'bin'), '/usr/bin');
  assert.equal(path.join('/usr/lib', '.', 'file.js'), '/usr/lib/file.js');
});

test('path.normalize: removes double slashes and dots', () => {
  const path = createPathModule();
  assert.equal(path.normalize('/usr//lib/./node_modules'), '/usr/lib/node_modules');
  assert.equal(path.normalize('/usr/lib/../bin'), '/usr/bin');
});

test('path.normalize: relative path', () => {
  const path = createPathModule();
  assert.equal(path.normalize('a/b/../c'), 'a/c');
  assert.equal(path.normalize(''), '.');
});

test('path.dirname', () => {
  const path = createPathModule();
  assert.equal(path.dirname('/usr/lib/file.js'), '/usr/lib');
  assert.equal(path.dirname('/file.js'), '/');
  assert.equal(path.dirname('file.js'), '.');
});

test('path.basename', () => {
  const path = createPathModule();
  assert.equal(path.basename('/usr/lib/file.js'), 'file.js');
  assert.equal(path.basename('/usr/lib/file.js', '.js'), 'file');
});

test('path.extname', () => {
  const path = createPathModule();
  assert.equal(path.extname('index.js'), '.js');
  assert.equal(path.extname('index.mjs'), '.mjs');
  assert.equal(path.extname('Makefile'), '');
  assert.equal(path.extname('.hidden'), '');
});

test('path.resolve: absolute wins', () => {
  const path = createPathModule();
  assert.equal(path.resolve('/usr', 'lib'), '/usr/lib');
  assert.equal(path.resolve('/usr', '/etc', 'file'), '/etc/file');
});

test('path.isAbsolute', () => {
  const path = createPathModule();
  assert.equal(path.isAbsolute('/usr'), true);
  assert.equal(path.isAbsolute('usr'), false);
  assert.equal(path.isAbsolute('./usr'), false);
});

test('path.relative', () => {
  const path = createPathModule();
  assert.equal(path.relative('/usr/lib', '/usr/lib/node_modules'), 'node_modules');
  assert.equal(path.relative('/usr/lib', '/usr/bin'), '../bin');
  assert.equal(path.relative('/a/b/c', '/a/b/c'), '.');
});

test('path.parse', () => {
  const path = createPathModule();
  const parsed = path.parse('/usr/lib/file.js');
  assert.equal(parsed.root, '/');
  assert.equal(parsed.dir, '/usr/lib');
  assert.equal(parsed.base, 'file.js');
  assert.equal(parsed.ext, '.js');
  assert.equal(parsed.name, 'file');
});

test('path.format', () => {
  const path = createPathModule();
  const formatted = path.format({ dir: '/usr/lib', base: 'file.js' });
  assert.equal(formatted, '/usr/lib/file.js');
});

test('path.sep and delimiter', () => {
  const path = createPathModule();
  assert.equal(path.sep, '/');
  assert.equal(path.delimiter, ':');
});

// ---------------------------------------------------------------------------
// createOSModule
// ---------------------------------------------------------------------------

test('os module: basic properties', () => {
  const os = createOSModule();
  assert.equal(os.EOL, '\n');
  assert.equal(os.platform(), 'browser');
  assert.equal(os.type(), 'Browser');
  assert.equal(os.homedir(), '/home/user');
  assert.equal(os.tmpdir(), '/tmp');
  assert.equal(os.hostname(), 'localhost');
  assert.equal(os.arch(), 'wasm');
});

// ---------------------------------------------------------------------------
// createUrlModule
// ---------------------------------------------------------------------------

test('url.fileURLToPath: strips file:// prefix', () => {
  const url = createUrlModule();
  assert.equal(url.fileURLToPath('file:///usr/lib/foo.js'), '/usr/lib/foo.js');
});

test('url.fileURLToPath: non-file URL returned as-is', () => {
  const url = createUrlModule();
  assert.equal(url.fileURLToPath('/usr/lib/foo.js'), '/usr/lib/foo.js');
  assert.equal(url.fileURLToPath('https://example.com'), 'https://example.com');
});

test('url.pathToFileURL: prepends file://', () => {
  const url = createUrlModule();
  assert.equal(url.pathToFileURL('/usr/lib/foo.js'), 'file:///usr/lib/foo.js');
});

// ---------------------------------------------------------------------------
// nodeResult
// ---------------------------------------------------------------------------

test('nodeResult: defaults', () => {
  const r = nodeResult();
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(r.exitCode, 0);
});

test('nodeResult: with values', () => {
  const r = nodeResult('hello', 'oops', 1);
  assert.equal(r.stdout, 'hello');
  assert.equal(r.stderr, 'oops');
  assert.equal(r.exitCode, 1);
});

test('nodeResult: coerces non-string stdout/stderr to string', () => {
  const r = nodeResult(42, null, 0);
  assert.equal(r.stdout, '42');
  assert.equal(r.stderr, '');
});

test('nodeResult: null exitCode defaults to 0', () => {
  const r = nodeResult('', '', null);
  assert.equal(r.exitCode, 0);
});

// ---------------------------------------------------------------------------
// resolveImportPath
// ---------------------------------------------------------------------------

test('resolveImportPath: absolute path with extension', () => {
  const result = resolveImportPath('/usr/lib/foo.js', '/whatever.js', (p) => p);
  assert.equal(result, '/usr/lib/foo.js');
});

test('resolveImportPath: absolute path without extension appends .js', () => {
  const result = resolveImportPath('/usr/lib/foo', '/whatever.js', (p) => p);
  assert.equal(result, '/usr/lib/foo.js');
});

test('resolveImportPath: relative ./ path', () => {
  const mockResolve = (p) => p.replace(/\/\.\//g, '/');
  const result = resolveImportPath('./lib/bar.js', '/pkg/index.js', mockResolve);
  assert.equal(result, '/pkg/lib/bar.js');
});

test('resolveImportPath: relative ../ path', () => {
  const mockResolve = (p) => {
    const parts = p.split('/').filter(Boolean);
    const resolved = [];
    for (const part of parts) {
      if (part === '..') resolved.pop();
      else if (part !== '.') resolved.push(part);
    }
    return '/' + resolved.join('/');
  };
  const result = resolveImportPath('../utils.js', '/pkg/lib/index.js', mockResolve);
  assert.equal(result, '/pkg/utils.js');
});

test('resolveImportPath: relative path without extension appends .js', () => {
  const mockResolve = (p) => p.replace(/\/\.\//g, '/');
  const result = resolveImportPath('./lib/bar', '/pkg/index.js', mockResolve);
  assert.equal(result, '/pkg/lib/bar.js');
});

test('resolveImportPath: bare module name resolves relative to current dir', () => {
  const mockResolve = (p) => p.replace(/\/\.\//g, '/');
  const result = resolveImportPath('util', '/pkg/index.js', mockResolve);
  assert.equal(result, '/pkg/util.js');
});
