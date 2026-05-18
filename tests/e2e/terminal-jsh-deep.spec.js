// @ts-check
// Deeper jsh regression suites: command substitution, background jobs,
// permission enforcement (feature-flagged), and find -exec.
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
 * @param {import('@playwright/test').Page} page
 * @param {string} command
 */
async function runCommand(page, command) {
  const input = page.locator('#terminal-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(command);
  await input.press('Enter');
}

/**
 * Wait for a stdout line that exactly matches `text` to land in the
 * transcript. We exclude the welcome banner and stderr rows.
 * @param {import('@playwright/test').Page} page
 * @param {string|RegExp} text
 */
async function expectStdout(page, text) {
  const matcher = typeof text === 'string' ? new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : text;
  await expect(
    page
      .locator('#terminal-output .terminal-output:not(.welcome):not(.stderr)')
      .filter({ hasText: matcher })
      .first()
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('jsh deep: command substitution', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
  });

  test('$(echo hi) substitutes the inner stdout', async ({ page }) => {
    await runCommand(page, 'echo before-$(echo hi)-after');
    await expectStdout(page, 'before-hi-after');
  });

  test('backticks substitute the inner stdout', async ({ page }) => {
    await runCommand(page, 'echo `echo backtick-ok`');
    await expectStdout(page, 'backtick-ok');
  });

  test('inner $? does not leak to outer pipeline', async ({ page }) => {
    await runCommand(page, 'true');
    await runCommand(page, 'X=$(false); echo $?');
    // The list as executed reports the trailing echo's exit (0), not the
    // inner `false` exit. Both stage stdout values are valid: 0 (post-true
    // baseline) or 1 (post-false leak we want to avoid). We assert 0.
    await expectStdout(page, '0');
  });
});

test.describe('jsh deep: background jobs', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
  });

  test('trailing & registers a job that `jobs` lists', async ({ page }) => {
    await runCommand(page, 'sleep 5 &');
    await runCommand(page, 'jobs');
    await expect(
      page
        .locator('#terminal-output .terminal-output:not(.welcome):not(.stderr)')
        .filter({ hasText: /\[\d+\].*sleep/ })
        .first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('kill %1 terminates the most-recent background job', async ({ page }) => {
    await runCommand(page, 'sleep 30 &');
    await runCommand(page, 'kill %1');
    await runCommand(page, 'jobs');
    // After kill the job should be Done/empty — `jobs` either prints
    // nothing or a Done line for it. Ensure no "Running" sleep entry.
    const stillRunning = page
      .locator('#terminal-output .terminal-output:not(.welcome):not(.stderr)')
      .filter({ hasText: /Running.*sleep 30/ });
    await expect(stillRunning).toHaveCount(0);
  });
});

test.describe('jsh deep: find -exec', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
  });

  test('-exec runs the inner pipeline per match', async ({ page }) => {
    await runCommand(page, 'mkdir -p /tmp/findxe');
    await runCommand(page, 'echo aaa > /tmp/findxe/a.txt');
    await runCommand(page, 'echo bbbb > /tmp/findxe/b.txt');
    await runCommand(page, 'find /tmp/findxe -type f -name "*.txt" -exec wc -c {} \\;');
    // wc -c of "aaa\n" = 4, "bbbb\n" = 5. Match either line.
    await expectStdout(page, /\b4\b.*a\.txt|a\.txt.*\b4\b/);
    await expectStdout(page, /\b5\b.*b\.txt|b\.txt.*\b5\b/);
  });

  test('-delete actually removes matched files', async ({ page }) => {
    await runCommand(page, 'mkdir -p /tmp/finddel');
    await runCommand(page, 'echo x > /tmp/finddel/x.tmp');
    await runCommand(page, 'echo y > /tmp/finddel/y.tmp');
    await runCommand(page, 'find /tmp/finddel -type f -name "*.tmp" -delete');
    await runCommand(page, 'ls /tmp/finddel | wc -l');
    // After deletion the directory should be empty (wc -l == 0).
    await expectStdout(page, '0');
  });
});

test.describe('jsh deep: permission enforcement (feature-flagged)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
    // Flip the global flag on for the duration of the test only.
    await page.evaluate(() => {
      const cfg = (window.heymingOS && window.heymingOS.config) || {};
      cfg.enforceFsPermissions = true;
      if (window.heymingOS) window.heymingOS.config = cfg;
    });
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const cfg = (window.heymingOS && window.heymingOS.config) || {};
      cfg.enforceFsPermissions = false;
      if (window.heymingOS) window.heymingOS.config = cfg;
    });
  });

  test('chmod 000 then cat reports permission denied and exits non-zero', async ({ page }) => {
    await runCommand(page, 'echo secret > /tmp/perm-e2e.txt');
    await runCommand(page, 'chmod 000 /tmp/perm-e2e.txt');
    await runCommand(page, 'cat /tmp/perm-e2e.txt; echo exit=$?');
    // Either the cat stderr or the explicit exit code line is enough.
    const denied = page
      .locator('#terminal-output .terminal-output')
      .filter({ hasText: /Permission denied|EACCES/ });
    const exitLine = page
      .locator('#terminal-output .terminal-output:not(.welcome):not(.stderr)')
      .filter({ hasText: /^exit=[1-9]\d*$/ });
    // At least one of them should be present.
    await expect(async () => {
      const d = await denied.count();
      const e = await exitLine.count();
      expect(d + e).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 });
  });
});
