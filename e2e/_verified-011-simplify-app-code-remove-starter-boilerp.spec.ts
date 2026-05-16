import { expect, test } from '@playwright/test';

test.describe('Simplify app code - remove starter boilerplate, fix footer year', () => {
  test('Landing page renders correctly', async ({ page }) => {
    await page.goto('/');

    const mainHeading = page.getByText('Din svenska bygglovsassistent');
    await expect(mainHeading).toBeVisible();

    const subheading = page.locator('main p');
    await expect(subheading).toBeVisible();

    const ctaButton = page.getByRole('link', { name: 'Kom igång' });
    await expect(ctaButton).toBeVisible();
    await expect(ctaButton).toHaveAttribute('href', '/design');

    const allCtaButtons = page.getByRole('link', { name: 'Kom igång' });
    const count = await allCtaButtons.count();
    expect(count).toBe(1);

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await expect.soft(consoleErrors).toHaveLength(0);
  });

  test('Design screen renders correctly', async ({ page }) => {
    await page.goto('/design');

    const heading = page.getByText('Design');
    await expect(heading).toBeVisible();

    const chatInput = page.getByRole('textbox');
    await expect(chatInput).toBeVisible();

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await expect.soft(consoleErrors).toHaveLength(0);
  });

  test('Footer shows dynamic current year', async ({ page }) => {
    await page.goto('/');

    const footer = page.getByText(/© Bygglovsassistenten \d{4}/);
    await expect(footer).toBeVisible();

    const currentYear = new Date().getFullYear();
    const footerText = await footer.textContent();
    expect(footerText).toContain(`© Bygglovsassistenten ${currentYear}`);

    await page.goto('/design');

    const footerDesign = page.getByText(/© Bygglovsassistenten \d{4}/);
    await expect(footerDesign).toBeVisible();

    const footerDesignText = await footerDesign.textContent();
    expect(footerDesignText).toContain(`© Bygglovsassistenten ${currentYear}`);
  });

  test('No visual regression', async ({ page }) => {
    await page.goto('/');

    const mainHeading = page.getByText('Din svenska bygglovsassistent');
    await expect(mainHeading).toBeVisible();

    const subheading = page.locator('main p');
    await expect(subheading).toBeVisible();

    const ctaButton = page.getByRole('link', { name: 'Kom igång' });
    await expect(ctaButton).toBeVisible();
    await expect(ctaButton).toHaveAttribute('href', '/design');

    const footer = page.getByText(/© Bygglovsassistenten \d{4}/);
    await expect(footer).toBeVisible();

    await page.goto('/design');

    const heading = page.getByText('Design');
    await expect(heading).toBeVisible();

    const chatInput = page.getByRole('textbox');
    await expect(chatInput).toBeVisible();

    const footerDesign = page.getByText(/© Bygglovsassistenten \d{4}/);
    await expect(footerDesign).toBeVisible();

    const consoleErrors: string[] = [];
    const fontErrors: string[] = [];

    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
      if (text.includes('Geist_Mono') || text.includes('font')) {
        fontErrors.push(text);
      }
    });

    await expect.soft(consoleErrors).toHaveLength(0);
    await expect.soft(fontErrors).toHaveLength(0);

    const computedStyles = await page.evaluate(() => {
      const body = document.body;
      return {
        display: window.getComputedStyle(body).display,
        visibility: window.getComputedStyle(body).visibility,
      };
    });

    expect(computedStyles.display).not.toBe('none');
    expect(computedStyles.visibility).not.toBe('hidden');
  });
});