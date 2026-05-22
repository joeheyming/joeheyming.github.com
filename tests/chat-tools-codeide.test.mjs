// Unit tests for the Code IDE side of chat/tools.js. These pin the
// behavior the AI assistant depends on when it's hosted inside the
// IDE: workspace-rooted path resolution, placeholder-path rejection,
// and the createFile / applyEdit tool execution path against an
// in-memory mock filesystem.
//
// The point is to lock down the contract between the model and the
// IDE so it doesn't regress the next time the prompt or recovery
// logic changes — this file's failure modes were all observed in
// production logs (see chat-recovery.test.mjs for the model-output
// parsing side).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, runTool, resolvePath, placeholderRejection } from '../chat/tools.js';

function makeFs(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async getItem(path) {
      return store.get(path) || null;
    },
    async createFile(path, content) {
      if (store.has(path)) throw new Error(`exists: ${path}`);
      store.set(path, { type: 'file', path, content });
    },
    async writeFile(path, content) {
      store.set(path, { type: 'file', path, content });
    },
    async listFiles() {
      return Array.from(store.values());
    },
    _store: store
  };
}

function makeCtx({ workspaceRoot = '/', fs = makeFs(), embedded = false } = {}) {
  const notes = [];
  return {
    ctx: {
      embed: { isEmbedded: embedded },
      workspaceRoot: () => workspaceRoot,
      async fs() {
        return fs;
      },
      notify(msg, kind) {
        notes.push({ msg, kind });
      }
    },
    notes,
    fs
  };
}

describe('resolvePath (host-aware)', () => {
  it('respects opts.base for relative paths', () => {
    assert.equal(resolvePath('hello.cpp', { base: '/' }), '/hello.cpp');
    assert.equal(resolvePath('src/foo.py', { base: '/' }), '/src/foo.py');
  });

  it('respects opts.base when base is a real workspace folder', () => {
    assert.equal(
      resolvePath('hello.sh', { base: '/home/joe/Documents' }),
      '/home/joe/Documents/hello.sh'
    );
    assert.equal(
      resolvePath('bin/hello.sh', { base: '/home/joe/Documents' }),
      '/home/joe/Documents/bin/hello.sh'
    );
  });

  it('keeps absolute paths untouched', () => {
    assert.equal(resolvePath('/x/y.cpp', { base: '/wrong/base' }), '/x/y.cpp');
  });

  it('collapses duplicate slashes and trailing slashes', () => {
    assert.equal(resolvePath('//a///b//c/', { base: '/' }), '/a/b/c');
  });
});

describe('placeholderRejection', () => {
  for (const bad of [
    '/path/to/yourfile.cpp',
    '/path/to/file.py',
    '/your/file.py',
    '/yourfile.cpp',
    '/your-project/main.rs',
    '/example/foo.js',
    '/placeholder.txt',
    '/dir/<filename>.txt',
    '/dir/.../file.txt'
  ]) {
    it(`rejects ${bad}`, () => {
      const msg = placeholderRejection(bad);
      assert.ok(typeof msg === 'string', `expected rejection string for ${bad}`);
      assert.match(msg, /placeholder/);
    });
  }

  for (const good of [
    '/hello.cpp',
    '/home/joe/Documents/bin/hello.sh',
    '/src/main.py',
    '/notes/today.md'
  ]) {
    it(`accepts ${good}`, () => {
      assert.equal(placeholderRejection(good), null);
    });
  }

  it('suggests a concrete path inside the workspace when given a workspaceRoot', () => {
    const msg = placeholderRejection('/path/to/hello.sh', '/');
    assert.ok(msg);
    assert.match(msg, /Did you mean "\/hello\.sh"/);
    assert.match(msg, /workspace/);
  });

  it('suggests against a non-root workspace (OS-embedded)', () => {
    const msg = placeholderRejection('/path/to/main.py', '/home/joe/Documents');
    assert.ok(msg);
    assert.match(msg, /Did you mean "\/home\/joe\/Documents\/main\.py"/);
  });

  it('suggests for /your-project/<file> placeholders', () => {
    const msg = placeholderRejection('/your-project/script.js', '/');
    assert.ok(msg);
    assert.match(msg, /Did you mean "\/script\.js"/);
  });

  it('falls back to no-suggestion when the basename is itself a placeholder', () => {
    const msg = placeholderRejection('/path/to/<filename>', '/');
    assert.ok(msg);
    assert.doesNotMatch(msg, /Did you mean/);
  });

  it('still works without a workspaceRoot (back-compat)', () => {
    const msg = placeholderRejection('/path/to/foo.cpp');
    assert.ok(msg);
    assert.match(msg, /placeholder/);
  });
});

describe('createFile execute()', () => {
  let env;
  beforeEach(() => {
    env = makeCtx({ workspaceRoot: '/' });
  });

  it('refuses placeholder paths before touching fs', async () => {
    const res = JSON.parse(
      await runTool(
        'createFile',
        { path: '/path/to/yourfile.cpp', content: 'int main(){}' },
        env.ctx
      )
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /placeholder/);
    assert.equal(env.fs._store.size, 0);
  });

  it('refuses without content', async () => {
    const res = JSON.parse(await runTool('createFile', { path: '/hello.cpp' }, env.ctx));
    assert.equal(res.ok, false);
    assert.match(res.error, /content/);
  });

  it('returns a dry-run preview by default (no write)', async () => {
    const res = JSON.parse(
      await runTool('createFile', { path: 'hello.cpp', content: 'int main(){}' }, env.ctx)
    );
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.path, '/hello.cpp');
    assert.equal(res.preview, 'int main(){}');
    assert.equal(env.fs._store.size, 0, 'dryRun must not write');
  });

  it('writes when dryRun is false and resolves to workspace root', async () => {
    const res = JSON.parse(
      await runTool(
        'createFile',
        { path: 'src/hello.py', content: 'print("hi")', dryRun: false },
        env.ctx
      )
    );
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, false);
    assert.equal(res.path, '/src/hello.py');
    assert.equal(env.fs._store.get('/src/hello.py').content, 'print("hi")');
    assert.deepEqual(env.notes[0], { msg: 'Created hello.py.', kind: 'success' });
  });

  it('resolves into a non-/ workspace root in OS-embedded mode', async () => {
    const e = makeCtx({ workspaceRoot: '/home/joe/Documents' });
    const res = JSON.parse(
      await runTool(
        'createFile',
        { path: 'bin/hello.sh', content: '#!/bin/bash\necho hi\n', dryRun: false },
        e.ctx
      )
    );
    assert.equal(res.ok, true);
    assert.equal(res.path, '/home/joe/Documents/bin/hello.sh');
  });

  it('refuses when file already exists', async () => {
    const fs = makeFs({ '/already.txt': { type: 'file', path: '/already.txt', content: 'old' } });
    const e = makeCtx({ workspaceRoot: '/', fs });
    const res = JSON.parse(
      await runTool('createFile', { path: 'already.txt', content: 'new' }, e.ctx)
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /already exists/);
  });
});

describe('TOOLS schema sanity', () => {
  it('exposes createFile and applyEdit with required path + content', () => {
    const create = TOOLS.createFile.definition.function;
    assert.deepEqual(create.parameters.required, ['path', 'content']);
    const edit = TOOLS.applyEdit.definition.function;
    assert.ok(Array.isArray(edit.parameters.required) && edit.parameters.required.includes('path'));
  });
});
