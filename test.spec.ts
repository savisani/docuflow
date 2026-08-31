import { test, expect } from '@playwright/test';

test.describe('DocuFlow Desktop', () => {
  test('preload exposes window.docuflow', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(2000);

    const docuflowType = await page.evaluate(() => typeof (window as any).docuflow);
    console.log('window.docuflow type:', docuflowType);
    expect(docuflowType).toBe('object');

    const methods = await page.evaluate(() => Object.keys((window as any).docuflow));
    console.log('methods:', methods);
    expect(methods).toContain('importAsset');
    expect(methods).toContain('filePathToAssetUrl');
  });

  test('UI renders correctly', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(2000);

    const title = await page.title();
    expect(title).toBe('DocuFlow');

    const assetsPanel = await page.locator('text=Assets').first();
    await expect(assetsPanel).toBeVisible();
  });
});
