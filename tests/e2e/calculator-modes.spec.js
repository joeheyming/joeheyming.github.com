// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Calculator modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/calculator/');
    await page.evaluate(() => localStorage.setItem('calculator-mode', 'standard'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#calc-app', { timeout: 10_000 });
  });

  test('standard mode shows keypad only', async ({ page }) => {
    await expect(page.locator('.calc-mode-tab[data-mode="standard"]')).toHaveClass(/active/);
    await expect(page.locator('#calc-panel-standard')).toBeVisible();
    await expect(page.locator('#calc-panel-graph')).toBeHidden();
    await expect(page.locator('#calc-display')).toBeVisible();
    await expect(page.locator('#graph-canvas')).toBeHidden();
    await expect(page.locator('#graph-expr-f')).toBeHidden();
  });

  test('graph mode shows plot UI only', async ({ page }) => {
    await page.locator('.calc-mode-tab[data-mode="graph"]').click();
    await expect(page.locator('.calc-mode-tab[data-mode="graph"]')).toHaveClass(/active/);
    await expect(page.locator('#calc-panel-graph')).toBeVisible();
    await expect(page.locator('#calc-panel-standard')).toBeHidden();
    await expect(page.locator('#graph-canvas')).toBeVisible();
    await expect(page.locator('#calc-display')).toBeHidden();
  });

  test('standard keyboard input calculates', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('7');
    await page.keyboard.press('+');
    await page.keyboard.press('3');
    await page.keyboard.press('Enter');
    await expect(page.locator('#calc-display')).toHaveText('10');
  });

  test('graph hover shows f(x) and g(x) on the plot', async ({ page }) => {
    await page.locator('.calc-mode-tab[data-mode="graph"]').click();
    const canvas = page.locator('#graph-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.locator('#graph-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/x\s*=/);
    await expect(tooltip).toContainText(/f\(x\)\s*=/);
  });

  test('expression clear button empties the input', async ({ page }) => {
    await page.locator('.calc-mode-tab[data-mode="graph"]').click();
    const input = page.locator('#graph-expr-f');
    await input.fill('x^2');
    await page.locator('.graph-expr-clear[data-for="graph-expr-f"]').click();
    await expect(input).toHaveValue('');
  });
});
