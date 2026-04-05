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
  // Terminal.initialize() is scheduled after FS ready (see terminal.js setTimeout(..., 100));
  // wait until the prompt is wired so Enter runs handleCommand.
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

test.describe('jsh terminal (static)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForOsReady(page);
  });

  test('welcome banner: block banner with jsh title is visible', async ({ page }) => {
    const welcome = page.locator('#terminal-output .terminal-output.welcome');
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText('Welcome to jsh');
    await expect(welcome).toHaveAttribute('role', 'region');
    await expect(welcome).toHaveAttribute('aria-label', /Welcome to jsh/i);
    await expect(welcome.locator('.welcome-banner-art')).toHaveAttribute('aria-hidden', 'true');
  });

  test('landmarks: main shell, output region, prompt linked to input', async ({ page }) => {
    await expect(page.getByRole('main', { name: /jsh terminal/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /command output/i })).toBeVisible();
    await expect(page.locator('#terminal-input')).toHaveAttribute('aria-labelledby', 'prompt-text');
  });

  test('Theme G: pinned keyboard shortcuts strip (history, Tab, Ctrl+C)', async ({ page }) => {
    const hints = page.locator('#terminal-session-hints');
    await expect(hints).toBeVisible();
    await expect(hints).toHaveAttribute('role', 'region');
    await expect(hints).toHaveAttribute('aria-label', 'Keyboard shortcuts');
    await expect(hints).toContainText('history');
    await expect(hints).toContainText('complete');
    await expect(hints).toContainText('interrupt');
    await expect(hints.locator('kbd')).toHaveCount(5);
  });

  test('Theme G: Jump to latest button when transcript scrolled up', async ({ page }) => {
    await runCommand(page, 'seq 1 80');
    await expect(page.locator('#terminal-output')).toContainText('80');
    await page.evaluate(() => {
      const el = document.getElementById('terminal-scroll');
      if (el) el.scrollTop = 0;
    });
    const btn = page.locator('#terminal-scroll-latest');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-label', 'Jump to latest output');
    await btn.click();
    const nearBottom = await page.evaluate(() => {
      const el = document.getElementById('terminal-scroll');
      if (!el) return false;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      return gap <= 52;
    });
    expect(nearBottom).toBe(true);
    await expect(btn).toBeHidden();
  });

  test('Theme G: document title reflects cwd (standalone tab)', async ({ page }) => {
    await expect(page).toHaveTitle(/^jsh — .+@heyming-os:~$/);
    await runCommand(page, 'cd /');
    await expect(page).toHaveTitle(/^jsh — .+@heyming-os:\/$/);
  });

  test('Theme G: html/body height chain fills viewport (iframe-safe layout)', async ({ page }) => {
    const dims = await page.evaluate(() => {
      const de = document.documentElement;
      const body = document.body;
      const main = document.getElementById('terminal-container');
      return {
        innerH: window.innerHeight,
        docClientH: de.clientHeight,
        bodyClientH: body.clientHeight,
        mainBoxH: main ? main.getBoundingClientRect().height : 0
      };
    });
    expect(dims.docClientH).toBe(dims.innerH);
    expect(dims.bodyClientH).toBe(dims.innerH);
    expect(Math.abs(dims.mainBoxH - dims.innerH)).toBeLessThanOrEqual(1);
  });

  test('skip link: jumps to command input', async ({ page }) => {
    const skip = page.locator('.terminal-skip-link');
    await expect(skip).toHaveAttribute('href', '#terminal-input');
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#terminal-input')).toBeFocused();
  });

  test('placeholder: muted vs input text color (Theme G)', async ({ page }) => {
    const input = page.locator('#terminal-input');
    await expect(input).toHaveAttribute('placeholder', 'Type a command...');
    const colors = await page.evaluate(() => {
      const el = document.getElementById('terminal-input');
      if (!el) return null;
      return {
        placeholder: getComputedStyle(el, '::placeholder').color,
        text: getComputedStyle(el).color
      };
    });
    expect(colors).not.toBeNull();
    expect(colors.placeholder).not.toBe(colors.text);
  });

  test('Theme G: output region default color + no font ligatures on pipeline text', async ({
    page
  }) => {
    await runCommand(page, 'echo theme-g-default');
    // Command echo also contains the substring — wait for the stdout row (plain .terminal-output line).
    await expect(
      page
        .locator('#terminal-output .terminal-output:not(.welcome)')
        .filter({ hasText: /^theme-g-default$/ })
    ).toBeVisible();
    const styles = await page.evaluate(() => {
      const region = document.getElementById('terminal-output');
      const lines = Array.from(
        region.querySelectorAll('.terminal-output:not(.welcome):not(.stderr)')
      );
      const plain = lines.find((el) => el.textContent?.trim() === 'theme-g-default');
      return {
        regionColor: region ? getComputedStyle(region).color : '',
        regionLigatures: region ? getComputedStyle(region).fontVariantLigatures : '',
        plainColor: plain ? getComputedStyle(plain).color : ''
      };
    });
    expect(styles.regionLigatures).toBe('none');
    expect(styles.plainColor).toBe(styles.regionColor);
    expect(styles.regionColor).toMatch(/rgb\(223,\s*248,\s*228\)/);
  });

  test('Theme G: ps stdout is tabular monospace block', async ({ page }) => {
    await runCommand(page, 'ps');
    const tab = page.locator('#terminal-output .terminal-output.tabular');
    await expect(tab).toBeVisible();
    await expect(tab).toContainText('PID');
    const font = await tab.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|courier|menlo|consolas/);
  });

  test('Theme G: man stdout is manual-page block (region + monospace)', async ({ page }) => {
    await runCommand(page, 'man man');
    const man = page.locator('#terminal-output .terminal-output.man-page');
    await expect(man).toBeVisible();
    await expect(man).toHaveAttribute('role', 'region');
    await expect(man).toHaveAttribute('aria-label', 'Manual page');
    await expect(man).toContainText('MAN(1)');
    await expect(man).toContainText('NAME');
    const font = await man.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|courier|menlo|consolas/);
  });

  test('Theme G: debug stdout is diagnostic block (region + monospace)', async ({ page }) => {
    await runCommand(page, 'debug status');
    const dbg = page.locator('#terminal-output .terminal-output.debug-dump');
    await expect(dbg).toBeVisible();
    await expect(dbg).toHaveAttribute('role', 'region');
    await expect(dbg).toHaveAttribute('aria-label', 'Debug output');
    await expect(dbg).toContainText('Debug Status');
    const font = await dbg.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|courier|menlo|consolas/);
  });

  test('Theme G: hexdump stdout is hex block (region + monospace)', async ({ page }) => {
    await runCommand(page, 'echo hi > /tmp/hexdump-e2e-ui.txt');
    await runCommand(page, 'hexdump /tmp/hexdump-e2e-ui.txt');
    const hd = page.locator('#terminal-output .terminal-output.hex-dump');
    await expect(hd).toBeVisible();
    await expect(hd).toHaveAttribute('role', 'region');
    await expect(hd).toHaveAttribute('aria-label', 'Hex dump');
    await expect(hd).toContainText('Raw content:');
    const font = await hd.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|courier|menlo|consolas/);
  });

  test('Theme G: ping stdout is HTTP probe block (region + monospace)', async ({ page }) => {
    test.setTimeout(45_000);
    await runCommand(page, 'ping -c 1');
    const pl = page.locator('#terminal-output .terminal-output.ping-log');
    await expect(pl).toBeVisible({ timeout: 30_000 });
    await expect(pl).toHaveAttribute('role', 'region');
    await expect(pl).toHaveAttribute('aria-label', 'HTTP ping output');
    await expect(pl).toContainText('ping statistics');
    const font = await pl.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toMatch(/mono|courier|menlo|consolas/);
  });

  test('Theme G: prefers-contrast more strengthens exit-code + placeholder colors', async ({
    page
  }) => {
    await waitForOsReady(page);
    await runCommand(page, 'echo contrast-check');
    await expect(page.locator('.command-exit-code[data-exit="0"]').last()).toBeVisible();
    const before = await page.evaluate(() => {
      const exit = document.querySelector('.command-exit-code[data-exit="0"]');
      const input = document.getElementById('terminal-input');
      const region = document.getElementById('terminal-output');
      return {
        exit: exit ? getComputedStyle(exit).color : '',
        placeholder: input ? getComputedStyle(input, '::placeholder').color : '',
        region: region ? getComputedStyle(region).color : '',
        selectionBg: (() => {
          const line = Array.from(
            document.querySelectorAll('#terminal-output .terminal-output')
          ).find((el) => el.textContent?.trim() === 'contrast-check');
          return line ? getComputedStyle(line, '::selection').backgroundColor : '';
        })()
      };
    });
    expect(before.exit).toMatch(/rgb/);
    expect(before.region).toMatch(/rgb\(223,\s*248,\s*228\)/);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-contrast', value: 'more' }]
    });

    const after = await page.evaluate(() => ({
      matches: window.matchMedia('(prefers-contrast: more)').matches,
      exit: (() => {
        const exit = document.querySelector('.command-exit-code[data-exit="0"]');
        return exit ? getComputedStyle(exit).color : '';
      })(),
      placeholder: (() => {
        const input = document.getElementById('terminal-input');
        return input ? getComputedStyle(input, '::placeholder').color : '';
      })(),
      region: (() => {
        const region = document.getElementById('terminal-output');
        return region ? getComputedStyle(region).color : '';
      })(),
      selectionBg: (() => {
        const line = Array.from(
          document.querySelectorAll('#terminal-output .terminal-output')
        ).find((el) => el.textContent?.trim() === 'contrast-check');
        return line ? getComputedStyle(line, '::selection').backgroundColor : '';
      })()
    }));

    expect(after.matches).toBe(true);
    expect(after.exit).not.toBe(before.exit);
    expect(after.placeholder).not.toBe(before.placeholder);
    expect(after.region).not.toBe(before.region);
    expect(after.region).toMatch(/rgb\(255,\s*255,\s*255\)/);
    expect(after.selectionBg).not.toBe(before.selectionBg);
    expect(after.selectionBg).toMatch(/rgb\(255,\s*255,\s*255\)/);
  });

  test('Theme G: echoed command line shows exit code hint', async ({ page }) => {
    await runCommand(page, 'echo exit-zero-marker');
    await expect(
      page.locator('.command-echo-line .command-exit-code[data-exit="0"]').last()
    ).toBeVisible();
    await runCommand(page, 'false');
    await expect(
      page.locator('.command-echo-line .command-exit-code[data-exit="1"]').last()
    ).toBeVisible();
  });

  test('Theme G: second+ echoed commands get session separator (command-echo-first)', async ({
    page
  }) => {
    await runCommand(page, 'echo one');
    await expect(page.locator('#terminal-output .command-echo-first')).toHaveCount(1);
    await runCommand(page, 'echo two');
    const borders = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('#terminal-output .command-echo-line'));
      return lines.map((el) => getComputedStyle(el).borderTopWidth);
    });
    expect(borders.length).toBeGreaterThanOrEqual(2);
    expect(borders[0]).toBe('0px');
    expect(parseFloat(borders[1])).toBeGreaterThan(0);
  });

  test('Theme G: prompt row has dock separator (transcript vs input)', async ({ page }) => {
    const dock = await page.evaluate(() => {
      const el = document.getElementById('current-prompt-line');
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        borderTopStyle: s.borderTopStyle,
        borderTopWidth: s.borderTopWidth,
        paddingTop: s.paddingTop
      };
    });
    expect(dock).not.toBeNull();
    expect(dock.borderTopStyle).toBe('solid');
    expect(parseFloat(dock.borderTopWidth)).toBeGreaterThan(0);
    expect(parseFloat(dock.paddingTop)).toBeGreaterThan(0);
  });

  test('shell list: && runs second command when first succeeds', async ({ page }) => {
    await runCommand(page, 'pwd && echo ok');
    await expect(page.locator('#terminal-output')).toContainText('ok');
  });

  test('shell list: || runs second command when first fails', async ({ page }) => {
    await runCommand(page, 'ls /__no_such_path_jsh_e2e__ || echo rescued');
    await expect(page.locator('#terminal-output')).toContainText('rescued');
  });

  test('shell list: ; runs both commands', async ({ page }) => {
    await runCommand(page, 'echo alpha; echo beta');
    const out = page.locator('#terminal-output');
    await expect(out).toContainText('alpha');
    await expect(out).toContainText('beta');
  });

  test('tee --help matches GNU-style help line', async ({ page }) => {
    await runCommand(page, 'tee --help');
    await expect(page.locator('#terminal-output')).toContainText(
      'Copy standard input to each FILE, and also to standard output.'
    );
  });

  test('tee -z reports GNU-style invalid option on stderr stream', async ({ page }) => {
    await runCommand(page, 'tee -z');
    await expect(page.locator('#terminal-output')).toContainText("invalid option -- 'z'");
    await expect(page.locator('#terminal-output')).toContainText(
      "Try 'tee --help' for more information."
    );
    const stderrRows = page.locator('#terminal-output .terminal-output.stderr');
    await expect(stderrRows.first()).toBeVisible();
    await expect(stderrRows.nth(1)).toBeVisible();
  });

  test('redirect to quoted empty string is a syntax error', async ({ page }) => {
    await runCommand(page, 'echo z > ""');
    // Parser rejects `>` before normalizeRedirectFilename sees `""` (see terminal.js parseSegment).
    await expect(page.locator('#terminal-output')).toContainText(
      'Syntax error: expected filename after >'
    );
  });

  test('pipeline: echo | tee writes file and prints', async ({ page }) => {
    const f = `/tmp/e2e-tee-${Date.now()}.txt`;
    await runCommand(page, `echo hello-e2e | tee ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('hello-e2e');
    await runCommand(page, `cat ${f}`);
    await expect(page.locator('#terminal-output')).toContainText('hello-e2e');
  });

  test('less modal: stdin pager chrome, q closes', async ({ page }) => {
    await runCommand(page, 'seq 1 25 | less');
    const modal = page.locator('.less-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#less-filename-label')).toContainText('(stdin)');
    await expect(modal.locator('.less-header')).toBeVisible();
    await expect(modal.locator('.less-footer kbd')).toHaveCount(3);
    await modal.press('q');
    await expect(page.locator('.less-modal')).toHaveCount(0);
  });

  test('top modal: header, keyboard footer, q closes', async ({ page }) => {
    await runCommand(page, 'top');
    const modal = page.locator('.top-modal');
    await expect(modal).toBeVisible();
    const dialog = modal.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-describedby', 'top-modal-subtitle');
    await expect(dialog).toBeFocused();
    await expect(modal.locator('.top-modal-title')).toContainText('process monitor');
    await expect(modal.getByRole('region', { name: /simulated process list/i })).toBeVisible();
    await expect(modal.locator('.top-modal-refresh-hint')).toContainText(
      'Auto-refresh every 3 seconds'
    );
    await expect(modal.locator('.top-modal-footer')).toContainText('quit');
    await expect(modal.locator('.top-modal-footer kbd').first()).toBeVisible();
    await modal.press('q');
    await expect(page.locator('.top-modal')).toHaveCount(0);
  });

  test('Theme G: command output region uses text cursor (selection affordance)', async ({
    page
  }) => {
    const cursor = await page.evaluate(() => {
      const el = document.getElementById('terminal-output');
      return el ? getComputedStyle(el).cursor : '';
    });
    expect(cursor).toBe('text');
  });

  test('Theme G: transcript and prompt ::selection uses contrasting colors', async ({ page }) => {
    await runCommand(page, 'echo selection-style');
    await expect(
      page.locator('#terminal-output .terminal-output').filter({ hasText: /^selection-style$/ })
    ).toBeVisible();
    const styles = await page.evaluate(() => {
      const line = Array.from(document.querySelectorAll('#terminal-output .terminal-output')).find(
        (el) => el.textContent?.trim() === 'selection-style'
      );
      const inp = document.getElementById('terminal-input');
      if (!line || !inp) return null;
      const outSel = getComputedStyle(line, '::selection');
      const inpSel = getComputedStyle(inp, '::selection');
      return {
        outBg: outSel.backgroundColor,
        outFg: outSel.color,
        inpBg: inpSel.backgroundColor,
        inpFg: inpSel.color
      };
    });
    expect(styles).not.toBeNull();
    expect(styles.outBg).toMatch(/rgba?\(/);
    expect(styles.outFg).toMatch(/rgb\(5,\s*18,\s*8\)/);
    expect(styles.inpBg).toBe(styles.outBg);
    expect(styles.inpFg).toBe(styles.outFg);
  });

  test('blocking command: running chrome on terminal container + aria-busy on scroll region', async ({
    page
  }) => {
    const input = page.locator('#terminal-input');
    await input.fill('sleep 2');
    await input.press('Enter');
    await expect(page.locator('#terminal-container')).toHaveClass(/terminal-command-running/);
    await expect(page.locator('#terminal-scroll')).toHaveAttribute('aria-busy', 'true');
    // ::after hint is not in textContent; assert computed style while still running
    const afterContent = await page.evaluate(() => {
      const line = document.querySelector('#current-prompt-line');
      if (!line) return '';
      return getComputedStyle(line, '::after').content;
    });
    expect(afterContent).toMatch(/Running/);
    await expect(page.locator('#terminal-container')).not.toHaveClass(/terminal-command-running/);
    await expect(page.locator('#terminal-scroll')).not.toHaveAttribute('aria-busy');
  });

  test('Theme G: narrow viewport wraps running hint under prompt line', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 700 });
    const input = page.locator('#terminal-input');
    await input.fill('sleep 2');
    await input.press('Enter');
    await expect(page.locator('#terminal-container')).toHaveClass(/terminal-command-running/);
    const flexWrap = await page.evaluate(() => {
      const line = document.getElementById('current-prompt-line');
      return line ? getComputedStyle(line).flexWrap : '';
    });
    expect(flexWrap).toBe('wrap');
    await expect(page.locator('#terminal-container')).not.toHaveClass(/terminal-command-running/);
  });

  test('Theme G: share dock fixed position uses safe-area-aware offsets', async ({ page }) => {
    const dock = await page.evaluate(() => {
      const el = document.getElementById('terminal-share-dock');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { position: s.position, right: s.right, bottom: s.bottom, display: s.display };
    });
    expect(dock).not.toBeNull();
    expect(dock.display).not.toBe('none');
    expect(dock.position).toBe('fixed');
    expect(dock.right).toMatch(/px$/);
    expect(dock.bottom).toMatch(/px$/);
  });
});
