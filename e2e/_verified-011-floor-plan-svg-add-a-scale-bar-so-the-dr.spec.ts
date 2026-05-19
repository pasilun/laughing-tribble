import { test, expect } from '@playwright/test';

test.describe('Feature: Add Scale Bar to Floor Plan SVG', () => {
  test('Scenario 1: Scale bar absent before any building is described', async ({ page }) => {
    await page.goto('/design');

    const floorPlanSvg = page.locator('[data-testid="floor-plan-svg"]');
    await expect(floorPlanSvg).not.toBeAttached();

    const placeholder = page.getByText('Beskriv dimensioner för att se ritning');
    await expect(placeholder).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test('Scenario 2: Scale bar appears after building is described', async ({ page }) => {
    await page.goto('/design');

    await page.locator('[placeholder="Beskriv vad du vill bygga..."]').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    );
    await page.locator('button:has-text("Skicka")').click();

    await page.waitForSelector('[data-testid="floor-plan-svg"]', { timeout: 15000 });

    const scaleBarLabel = page.getByTestId('scale-bar-label');
    await expect(scaleBarLabel).toBeAttached();
    const labelText = await scaleBarLabel.textContent();
    expect(labelText).toBe('2 m');

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test('Scenario 3: Scale bar SVG element is present and proportional', async ({ page }) => {
    await page.goto('/design');

    await page.locator('[placeholder="Beskriv vad du vill bygga..."]').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    );
    await page.locator('button:has-text("Skicka")').click();

    await page.waitForSelector('[data-testid="floor-plan-svg"]', { timeout: 15000 });

    const scaleBar = page.getByTestId('scale-bar');
    await expect(scaleBar).toBeAttached();

    const result = await page.evaluate(() => {
      const bar = document.querySelector("[data-testid=scale-bar]");
      const rect = document.querySelector("[data-testid=floor-plan-rect]");
      if (!bar || !rect) return null;
      const bw = bar.getBoundingClientRect().width;
      const rw = rect.getBoundingClientRect().width;
      return bw / rw;
    });

    expect(result).not.toBeNull();
    const expectedRatio = 2 / 4.5;
    expect(result).toBeCloseTo(expectedRatio, 1);

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test('Scenario 4: Dimension labels include the "m" unit suffix', async ({ page }) => {
    await page.goto('/design');

    await page.locator('[placeholder="Beskriv vad du vill bygga..."]').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    );
    await page.locator('button:has-text("Skicka")').click();

    await page.waitForSelector('[data-testid="floor-plan-svg"]', { timeout: 15000 });

    const dimLabelLength = page.getByTestId('dim-label-length');
    await expect(dimLabelLength).toBeAttached();
    const lengthText = await dimLabelLength.textContent();
    expect(lengthText).toContain('m');

    const dimLabelWidth = page.getByTestId('dim-label-width');
    await expect(dimLabelWidth).toBeAttached();
    const widthText = await dimLabelWidth.textContent();
    expect(widthText).toContain('m');

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test('Scenario 5: Floor plan rectangle encodes exact real-world aspect ratio', async ({ page }) => {
    await page.goto('/design');

    await page.locator('[placeholder="Beskriv vad du vill bygga..."]').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    );
    await page.locator('button:has-text("Skicka")').click();

    await page.waitForSelector('[data-testid="floor-plan-svg"]', { timeout: 15000 });

    const floorRect = page.getByTestId('floor-plan-rect');
    await expect(floorRect).toBeAttached();

    const diff = await page.evaluate(() => {
      const r = document.querySelector("[data-testid=floor-plan-rect]");
      return Math.abs(parseFloat(r.getAttribute("width")) - parseFloat(r.getAttribute("height")));
    });

    expect(diff).toBeLessThan(0.001);

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });
});
