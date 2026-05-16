import { test, expect } from '@playwright/test';

test.describe('Spec 010 - Cleaner Landing Page', () => {
  test.describe('Scenario 1: Page loads with clear messaging', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test('headline is visible with text containing bygglov or Bygglovsassistenten', async ({ page }) => {
      const headline = page.getByRole('heading', { level: 1 });
      await expect(headline).toBeVisible();
      const headlineText = await headline.textContent();
      expect(headlineText).toMatch(/bygglov|Bygglovsassistenten/);
    });

    test('subheading is visible with text at least 20 characters long', async ({ page }) => {
      const subheading = page.locator('main').getByRole('paragraph');
      await expect(subheading).toBeVisible();
      const subheadingText = await subheading.textContent();
      expect(subheadingText?.length).toBeGreaterThanOrEqual(20);
    });

    test('subheading explains app purpose (mentions friggebod, attefall, or små byggnader)', async ({ page }) => {
      const subheading = page.locator('main').getByRole('paragraph');
      const subheadingText = await subheading.textContent();
      expect(subheadingText).toMatch(/friggebod|attefall|små byggnader/i);
    });

    test('exactly one primary CTA button visible with text "Kom igång" or similar', async ({ page }) => {
      const ctaButtons = page.getByRole('link', { name: /Kom igång/i });
      const count = await ctaButtons.count();
      expect(count).toBe(1);
    });

    test('primary CTA links to /design', async ({ page }) => {
      const cta = page.getByRole('link', { name: /Kom igång/i });
      await expect(cta).toBeVisible();
      const href = await cta.getAttribute('href');
      expect(href).toBe('/design');
    });

    test('no error messages are present', async ({ page }) => {
      const pageContent = await page.content();
      expect(pageContent.toLowerCase()).not.toMatch(/fel uppstod|error|undefined|null|500/);
    });
  });

  test.describe('Scenario 2: Visual hierarchy and spacing', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test('headline font size is at least 1.5x larger than subheading', async ({ page }) => {
      const headline = page.getByRole('heading', { level: 1 });
      const subheading = page.locator('main').getByRole('paragraph');

      const headlineSize = await headline.evaluate(el => {
        return parseFloat(window.getComputedStyle(el).fontSize);
      });
      const subheadingSize = await subheading.evaluate(el => {
        return parseFloat(window.getComputedStyle(el).fontSize);
      });

      expect(headlineSize).toBeGreaterThanOrEqual(subheadingSize * 1.5);
    });

    test('primary CTA is positioned below the headline and subheading', async ({ page }) => {
      const headline = page.getByRole('heading', { level: 1 });
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      const headlineBox = await headline.boundingBox();
      const subheadingBox = await subheading.boundingBox();
      const ctaBox = await cta.boundingBox();

      expect(subheadingBox?.y).toBeGreaterThan(headlineBox?.y ?? 0);
      expect(ctaBox?.y).toBeGreaterThan(subheadingBox?.y ?? 0);
    });

    test('at least 20px vertical space between subheading and CTA', async ({ page }) => {
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      const subheadingBox = await subheading.boundingBox();
      const ctaBox = await cta.boundingBox();

      const verticalSpace = (ctaBox?.y ?? 0) - ((subheadingBox?.y ?? 0) + (subheadingBox?.height ?? 0));
      expect(verticalSpace).toBeGreaterThanOrEqual(20);
    });

    test('primary CTA has distinct background color from page background', async ({ page }) => {
      const cta = page.getByRole('link', { name: /Kom igång/i });
      const ctaBg = await cta.evaluate(el => {
        return window.getComputedStyle(el).backgroundColor;
      });
      const pageBg = await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
      });

      expect(ctaBg.toLowerCase()).not.toBe(pageBg.toLowerCase());
      expect(ctaBg).not.toBe('rgba(0, 0, 0, 0)');
      expect(pageBg).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('page has light background color (brightness >= 200 or is white)', async ({ page }) => {
      const bgColor = await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
      });

      const isWhite = bgColor === 'white' || bgColor === '#ffffff' || bgColor === '#fff' || bgColor === 'rgb(255, 255, 255)';
      const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      
      let isLight = isWhite;
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        isLight = isLight || brightness >= 200;
      }

      expect(isLight).toBe(true);
    });
  });

  test.describe('Scenario 3: Responsive layout', () => {
    test('mobile viewport (375px) - all text elements fully visible without horizontal scrolling', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      const headline = page.getByRole('heading', { level: 1 });
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      await expect(headline).toBeVisible();
      await expect(subheading).toBeVisible();
      await expect(cta).toBeVisible();

      const hasHorizontalScroll = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;
        return html.scrollWidth > html.clientWidth || body.scrollWidth > body.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    });

    test('mobile viewport (375px) - primary CTA button fully visible and tappable', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      const cta = page.getByRole('link', { name: /Kom igång/i });
      await expect(cta).toBeVisible();

      const box = await cta.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    });

    test('mobile viewport (375px) - no overlapping elements', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      const headline = page.getByRole('heading', { level: 1 });
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      const headlineBox = await headline.boundingBox();
      const subheadingBox = await subheading.boundingBox();
      const ctaBox = await cta.boundingBox();

      const hasOverlaps = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('h1, main p, a[href="/design"]'));
        for (let i = 0; i < elements.length; i++) {
          for (let j = i + 1; j < elements.length; j++) {
            const rect1 = elements[i].getBoundingClientRect();
            const rect2 = elements[j].getBoundingClientRect();
            const overlaps = !(rect1.right <= rect2.left || 
                              rect1.left >= rect2.right || 
                              rect1.bottom <= rect2.top || 
                              rect1.top >= rect2.bottom);
            if (overlaps) return true;
          }
        }
        return false;
      });

      expect(hasOverlaps).toBe(false);
    });

    test('desktop viewport (1920px) - content centered with equal left/right margins >= 100px', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');

      const main = page.locator('main');
      const mainBox = await main.boundingBox();
      const viewportWidth = await page.evaluate(() => window.innerWidth);

      if (mainBox) {
        const leftMargin = mainBox.x;
        const rightMargin = viewportWidth - (mainBox.x + mainBox.width);

        expect(leftMargin).toBeGreaterThanOrEqual(100);
        expect(rightMargin).toBeGreaterThanOrEqual(100);
        expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(2);
      }
    });

    test('desktop viewport (1920px) - maximum content width is <= 1200px', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');

      const main = page.locator('main');
      const mainBox = await main.boundingBox();

      expect(mainBox?.width).toBeLessThanOrEqual(1200);
    });
  });

  test.describe('Scenario 4: Typography consistency', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test('all visible text uses sans-serif font family', async ({ page }) => {
      const headline = page.getByRole('heading', { level: 1 });
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      const headlineFont = await headline.evaluate(el => window.getComputedStyle(el).fontFamily);
      const subheadingFont = await subheading.evaluate(el => window.getComputedStyle(el).fontFamily);
      const ctaFont = await cta.evaluate(el => window.getComputedStyle(el).fontFamily);

      const isSansSerif = (font: string) => {
        const lower = font.toLowerCase();
        return lower.includes('sans-serif') || 
               lower.includes('arial') || 
               lower.includes('helvetica') ||
               lower.includes('verdana') ||
               lower.includes('geneva') ||
               lower.includes('tahoma') ||
               lower.includes('trebuchet') ||
               lower.includes('system-ui') ||
               lower.includes('-apple-system') ||
               lower.includes('ui-sans-serif') ||
               !lower.includes('serif');
      };

      expect(isSansSerif(headlineFont)).toBe(true);
      expect(isSansSerif(subheadingFont)).toBe(true);
      expect(isSansSerif(ctaFont)).toBe(true);
    });

    test('headline uses bold or semibold font weight', async ({ page }) => {
      const headline = page.getByRole('heading', { level: 1 });
      const fontWeight = await headline.evaluate(el => {
        const weight = window.getComputedStyle(el).fontWeight;
        return weight === 'bold' || weight === '700' || parseInt(weight) >= 600;
      });

      expect(fontWeight).toBe(true);
    });

    test('subheading and button use same font weight', async ({ page }) => {
      const subheading = page.locator('main').getByRole('paragraph');
      const cta = page.getByRole('link', { name: /Kom igång/i });

      const subheadingWeight = await subheading.evaluate(el => {
        return window.getComputedStyle(el).fontWeight;
      });
      const ctaWeight = await cta.evaluate(el => {
        return window.getComputedStyle(el).fontWeight;
      });

      expect(subheadingWeight).toBe(ctaWeight);
    });
  });

  test.describe('Scenario 5: No confusing test features', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test('no visible text input field for entering a name', async ({ page }) => {
      const textInputs = page.locator('input[type="text"], input:not([type])');
      const count = await textInputs.count();
      expect(count).toBe(0);
    });

    test('no button labeled "Byt färg" or similar', async ({ page }) => {
      const colorButton = page.getByRole('button', { name: /byt färg/i });
      await expect(colorButton).not.toBeVisible();

      const colorLink = page.getByRole('link', { name: /byt färg/i });
      await expect(colorLink).not.toBeVisible();
    });

    test('no greeting text that changes based on user input', async ({ page }) => {
      const pageText = await page.textContent('body');
      
      // Check for common greeting patterns
      expect(pageText?.toLowerCase()).not.toMatch(/välkommen,\s*\w+/);
      expect(pageText?.toLowerCase()).not.toMatch(/hej\s+\w+/);
      expect(pageText?.toLowerCase()).not.toMatch(/hallå\s+\w+/);
    });

    test('no error messages are present', async ({ page }) => {
      const pageContent = await page.content();
      expect(pageContent.toLowerCase()).not.toMatch(/fel uppstod|error|undefined|null|500/);
    });
  });

  test.describe('Scenario 6: Existing navigation preserved', () => {
    test('clicking primary CTA changes URL to /design', async ({ page }) => {
      await page.goto('/');

      const cta = page.getByRole('link', { name: /Kom igång/i });
      await cta.click();

      await expect(page).toHaveURL('/design');
    });

    test('clicking primary CTA loads /design page successfully (status 200)', async ({ page }) => {
      await page.goto('/');

      const cta = page.getByRole('link', { name: /Kom igång/i });
      
      // Navigate and wait for response
      const responsePromise = page.waitForResponse(res => res.url().includes('/design'));
      await cta.click();
      const response = await responsePromise;

      expect(response.status()).toBe(200);
    });

    test('direct navigation to /design page loads successfully (status 200)', async ({ request }) => {
      const response = await request.get('/design');
      expect(response.status()).toBe(200);
    });

    test('/design page has no error messages', async ({ page }) => {
      await page.goto('/design');
      const pageContent = await page.content();
      expect(pageContent.toLowerCase()).not.toMatch(/fel uppstod|error|undefined|null|500/);
    });
  });
});