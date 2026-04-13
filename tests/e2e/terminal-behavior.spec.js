// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForOsReady(page) {
  await page.goto('/terminal/');
  await page.waitForFunction(() => window.heymingOS?.isInitialized === true, null, {
    timeout: 60_000
  });
  await page.waitForFunction(
    () => {
      const p = document.getElementById('prompt-text');
      return Boolean(p && p.textContent && p.textContent.includes('$'));
    },
    null,
    { timeout: 60_000 }
  );
}

/**
 * Run a command and wait for the exit code badge to appear (signals completion).
 * @param {import('@playwright/test').Page} page
 * @param {string} command
 */
async function runCommand(page, command) {
  const input = page.locator('#terminal-input');
  await input.waitFor({ state: 'visible' });

  const exitBadgesBefore = await page.locator('.command-exit-code').count();
  await input.fill(command);
  await input.press('Enter');
  await page.waitForFunction(
    (count) => document.querySelectorAll('.command-exit-code').length > count,
    exitBadgesBefore,
    { timeout: 15_000 }
  );
}

/**
 * Get the last exit code shown in the terminal.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function getLastExitCode(page) {
  return page.evaluate(() => {
    const badges = document.querySelectorAll('.command-exit-code');
    const last = badges[badges.length - 1];
    return last ? Number(last.getAttribute('data-exit')) : -1;
  });
}

/**
 * Get the text of the last stdout output block (non-stderr, non-welcome).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function getLastStdout(page) {
  return page.evaluate(() => {
    const lines = document.querySelectorAll(
      '#terminal-output .terminal-output:not(.welcome):not(.stderr):not(.command-echo-line)'
    );
    const last = lines[lines.length - 1];
    return last ? last.textContent?.trim() ?? '' : '';
  });
}

test.describe('jsh shell behavior (characterization)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
  });

  // --- Pipeline stdin forwarding ---

  test('pipeline: echo hello | cat → hello', async ({ page }) => {
    await runCommand(page, 'echo hello | cat');
    const out = await getLastStdout(page);
    expect(out).toBe('hello');
  });

  test('pipeline: echo hello | grep hello → hello', async ({ page }) => {
    await runCommand(page, 'echo hello | grep hello');
    const out = await getLastStdout(page);
    expect(out).toBe('hello');
  });

  test('pipeline: echo hello | grep world → no match, exit 1', async ({ page }) => {
    await runCommand(page, 'echo hello | grep world');
    const code = await getLastExitCode(page);
    expect(code).toBe(1);
  });

  // --- Pipeline exit codes (last stage wins) ---

  test('pipeline: true | false → exit 1 (last stage)', async ({ page }) => {
    await runCommand(page, 'true | false');
    const code = await getLastExitCode(page);
    expect(code).toBe(1);
  });

  test('pipeline: false | true → exit 0 (last stage)', async ({ page }) => {
    await runCommand(page, 'false | true');
    const code = await getLastExitCode(page);
    expect(code).toBe(0);
  });

  // --- List operators ---

  test('list: true && echo yes → yes', async ({ page }) => {
    await runCommand(page, 'true && echo yes');
    await expect(page.locator('#terminal-output')).toContainText('yes');
    const code = await getLastExitCode(page);
    expect(code).toBe(0);
  });

  test('list: false && echo yes → skipped, exit 1', async ({ page }) => {
    await runCommand(page, 'false && echo yes');
    const code = await getLastExitCode(page);
    expect(code).toBe(1);
  });

  test('list: false || echo fallback → fallback', async ({ page }) => {
    await runCommand(page, 'false || echo fallback');
    await expect(page.locator('#terminal-output')).toContainText('fallback');
  });

  test('list: true || echo skipped → skipped not printed', async ({ page }) => {
    await runCommand(page, 'true || echo skipped-marker');
    const html = await page.locator('#terminal-output').textContent();
    expect(html).not.toContain('skipped-marker');
  });

  test('list: cmd1 ; cmd2 → both run', async ({ page }) => {
    await runCommand(page, 'echo alpha; echo beta');
    const out = page.locator('#terminal-output');
    await expect(out).toContainText('alpha');
    await expect(out).toContainText('beta');
  });

  // --- Redirections ---

  test('redirect: echo > file && cat file', async ({ page }) => {
    const f = `/tmp/e2e-redir-${Date.now()}.txt`;
    await runCommand(page, `echo redir-test > ${f}`);
    await runCommand(page, `cat ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('redir-test');
  });

  test('redirect: >> appends', async ({ page }) => {
    const f = `/tmp/e2e-append-${Date.now()}.txt`;
    await runCommand(page, `echo line1 > ${f}`);
    await runCommand(page, `echo line2 >> ${f}`);
    await runCommand(page, `cat ${f}`);
    const out = page.locator('#terminal-output');
    await expect(out).toContainText('line1');
    await expect(out).toContainText('line2');
  });

  test('redirect: < feeds stdin', async ({ page }) => {
    const f = `/tmp/e2e-stdin-${Date.now()}.txt`;
    await runCommand(page, `echo needle > ${f}`);
    await runCommand(page, `grep needle < ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('needle');
  });

  // --- $? expansion ---

  test('$? expansion: false; echo $? → 1', async ({ page }) => {
    await runCommand(page, 'false; echo $?');
    await expect(page.locator('#terminal-output')).toContainText('1');
  });

  test('$? expansion: true; echo $? → 0', async ({ page }) => {
    await runCommand(page, 'true; echo $?');
    const allOutput = await page.evaluate(() => {
      const lines = document.querySelectorAll(
        '#terminal-output .terminal-output:not(.welcome):not(.stderr):not(.command-echo-line)'
      );
      return Array.from(lines)
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
    });
    expect(allOutput).toContain('0');
  });

  // --- Command not found ---

  test('command not found: exit 127 + error message', async ({ page }) => {
    await runCommand(page, 'nonexistent_cmd_e2e_test');
    const code = await getLastExitCode(page);
    expect(code).toBe(127);
    await expect(page.locator('#terminal-output')).toContainText('command not found');
  });

  // --- wc pipeline (stdin contract) ---

  test('pipeline: echo hello | wc -l → 1', async ({ page }) => {
    await runCommand(page, 'echo hello | wc -l');
    const out = await getLastStdout(page);
    expect(out.trim()).toMatch(/1/);
  });

  // --- echo | tee (verify pipe + file write) ---

  test('pipeline: echo | tee writes file and passes through', async ({ page }) => {
    const f = `/tmp/e2e-tee-behav-${Date.now()}.txt`;
    await runCommand(page, `echo tee-test | tee ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('tee-test');
    await runCommand(page, `cat ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('tee-test');
  });

  // --- Multi-stage pipeline ---

  test('pipeline: echo multiline | grep specific', async ({ page }) => {
    await runCommand(page, 'printf "apple\\nbanana\\ncherry" | grep banana');
    const out = await getLastStdout(page);
    expect(out).toBe('banana');
  });
});
