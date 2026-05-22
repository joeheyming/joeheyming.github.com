// @ts-check
// End-to-end spec for the Code IDE AI tool surface.
//
// This loads /code-ide/ in standalone mode (no HeymingOS host),
// waits for the IDE to boot, and then drives the chat-side
// runTool() against a real toolCtx wired to the IDE's local fs.
// We don't need WebLLM running to exercise the fail modes we care
// about: path resolution, placeholder rejection, dry-run preview,
// and actual file creation showing up in the workspace tree.
//
// Note: this spec deliberately bypasses the AI panel UI — that's
// covered by the unit tests in tests/chat-recovery.test.mjs and
// tests/chat-tools-codeide.test.mjs. What this spec proves is that
// the same code paths still produce a real file in the real
// in-browser fs when run inside a real page.

const { test, expect } = require('@playwright/test');

const CODE_IDE_URL = '/code-ide/';

async function waitForIdeReady(page) {
  // Surface page errors so a boot failure shows up in the test
  // output instead of a silent waitForFunction timeout.
  page.on('pageerror', (err) => {
    console.error('[page error]', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console error]', msg.text());
  });
  await page.waitForFunction(
    () => !!window.__codeIDE && !!window.__codeIDE.fs && typeof window.__codeIDE.fs.root === 'string',
    null,
    { timeout: 30_000 }
  );
}

/**
 * Build the same toolCtx the AI panel uses, plus a tiny test
 * helper that exposes runTool() on window so we can invoke it
 * from the Playwright side without serializing the ctx.
 */
async function installRunToolBridge(page) {
  await page.evaluate(async () => {
    const cacheBust = Date.now();
    const [{ runTool }, { createIdeToolCtx }] = await Promise.all([
      import(`/chat/tools.js?cb=${cacheBust}`),
      import(`/code-ide/ai-context.js?cb=${cacheBust}`)
    ]);
    const ide = window.__codeIDE;
    const ctx = createIdeToolCtx({
      ide,
      isEmbedded: false,
      getActiveFile: () => null
    });
    window.__testRunTool = (name, args) => runTool(name, args, ctx);
    window.__testCtx = ctx;
  });
}

test.describe('Code IDE AI tool surface (standalone)', () => {
  test('boots and exposes a workspace root', async ({ page }) => {
    await page.goto(CODE_IDE_URL);
    await waitForIdeReady(page);
    const root = await page.evaluate(() => window.__codeIDE.fs.root);
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
  });

  test('createFile (dryRun) returns a preview without writing', async ({ page }) => {
    await page.goto(CODE_IDE_URL);
    await waitForIdeReady(page);
    await installRunToolBridge(page);

    const fname = `e2e-dryrun-${Date.now()}.cpp`;

    const exists = async (p) =>
      page.evaluate(async (path) => {
        const fs = await window.__testCtx.fs();
        const item = await fs.getItem(path);
        return !!item;
      }, p);

    const raw = await page.evaluate(
      ({ fname }) =>
        window.__testRunTool('createFile', {
          path: fname,
          content:
            '#include <iostream>\nint main(){ std::cout << "hello, world\\n"; return 0; }\n'
        }),
      { fname }
    );
    const res = JSON.parse(raw);
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.path).toMatch(new RegExp(`${fname}$`));
    expect(typeof res.preview).toBe('string');
    expect(res.preview).toContain('hello, world');

    expect(await exists(res.path)).toBe(false);
  });

  test('createFile (dryRun=false) actually creates the file at the workspace root', async ({
    page
  }) => {
    await page.goto(CODE_IDE_URL);
    await waitForIdeReady(page);
    await installRunToolBridge(page);

    // Use a unique-ish path so re-runs don't trip "already exists".
    const fname = `e2e-hello-${Date.now()}.txt`;

    const raw = await page.evaluate(
      ({ fname }) =>
        window.__testRunTool('createFile', {
          path: fname,
          content: 'hello from e2e\n',
          dryRun: false
        }),
      { fname }
    );
    const res = JSON.parse(raw);
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(res.path.endsWith(`/${fname}`)).toBe(true);

    const found = await page.evaluate(async (p) => {
      const fs = await window.__testCtx.fs();
      const item = await fs.getItem(p);
      return item ? { path: item.path, content: item.content } : null;
    }, res.path);
    expect(found).not.toBeNull();
    expect(found.content).toBe('hello from e2e\n');
  });

  test('createFile refuses placeholder paths', async ({ page }) => {
    await page.goto(CODE_IDE_URL);
    await waitForIdeReady(page);
    await installRunToolBridge(page);

    const raw = await page.evaluate(() =>
      window.__testRunTool('createFile', {
        path: '/path/to/yourfile.cpp',
        content: 'int main(){}'
      })
    );
    const res = JSON.parse(raw);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/placeholder/);
  });

  test('createFile resolves bare paths against the workspace root', async ({ page }) => {
    await page.goto(CODE_IDE_URL);
    await waitForIdeReady(page);
    await installRunToolBridge(page);

    const root = await page.evaluate(() => window.__codeIDE.fs.root);
    const fname = `e2e-resolve-${Date.now()}.md`;
    const raw = await page.evaluate(
      ({ fname }) =>
        window.__testRunTool('createFile', {
          path: fname,
          content: '# hello\n',
          dryRun: false
        }),
      { fname }
    );
    const res = JSON.parse(raw);
    expect(res.ok).toBe(true);
    const expectedPrefix = root === '/' ? '/' : `${root.replace(/\/$/, '')}/`;
    expect(res.path).toBe(`${expectedPrefix}${fname}`);
  });
});
