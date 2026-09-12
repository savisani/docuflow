/**
 * DocuFlow Studio Visual Audit — Take screenshots to understand actual layout
 */
import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTRY = path.join(__dirname, 'out', 'main', 'index.js');
const AUDIT_DIR = path.join(__dirname, '.test-studio-audit');

let electronApp: ElectronApplication;
let window: Page;

test.describe.serial('DocuFlow Studio Visual Audit', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  });

  test.beforeEach(async () => {
    electronApp = await electron.launch({ args: [ENTRY] });
    window = await electronApp.firstWindow();
    await window.waitForTimeout(3000);
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('V1: Screenshot default Studio view', async () => {
    await window.screenshot({ path: path.join(AUDIT_DIR, '01-studio-default.png'), fullPage: true });
    console.log('Screenshot saved: 01-studio-default.png');
  });

  test('V2: Click File menu and screenshot', async () => {
    const fileBtn = window.locator('button').filter({ hasText: /^File$/ }).first();
    await fileBtn.click();
    await window.waitForTimeout(500);
    await window.screenshot({ path: path.join(AUDIT_DIR, '02-file-menu.png'), fullPage: true });
    console.log('Screenshot saved: 02-file-menu.png');

    // Get all visible text after clicking File
    const text = await window.evaluate(() => document.body.innerText);
    console.log('Visible text after File click:', text.substring(0, 2000));
  });

  test('V3: Click Image Gen tab and screenshot', async () => {
    const imgGenBtn = window.locator('button').filter({ hasText: 'Image Gen' }).first();
    await imgGenBtn.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(AUDIT_DIR, '03-image-gen.png'), fullPage: true });
    console.log('Screenshot saved: 03-image-gen.png');

    // Check what's visible now
    const text = await window.evaluate(() => document.body.innerText);
    console.log('Visible text after Image Gen:', text.substring(0, 2000));
  });

  test('V4: Click Scene Gen tab and screenshot', async () => {
    const sceneBtn = window.locator('button').filter({ hasText: 'Scene Gen' }).first();
    await sceneBtn.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(AUDIT_DIR, '04-scene-gen.png'), fullPage: true });
    console.log('Screenshot saved: 04-scene-gen.png');
  });

  test('V5: Click Motion GFX tab and screenshot', async () => {
    const motionBtn = window.locator('button').filter({ hasText: 'Motion GFX' }).first();
    await motionBtn.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(AUDIT_DIR, '05-motion-gfx.png'), fullPage: true });
    console.log('Screenshot saved: 05-motion-gfx.png');

    const text = await window.evaluate(() => document.body.innerText);
    console.log('Visible text after Motion GFX:', text.substring(0, 2000));
  });

  test('V6: Click Studio tab and screenshot', async () => {
    const studioBtn = window.locator('button').filter({ hasText: /^Studio$/ }).first();
    await studioBtn.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(AUDIT_DIR, '06-studio-tab.png'), fullPage: true });
    console.log('Screenshot saved: 06-studio-tab.png');
  });

  test('V7: Click Commands tab in right panel and screenshot', async () => {
    const studioBtn = window.locator('button').filter({ hasText: /^Studio$/ }).first();
    await studioBtn.click();
    await window.waitForTimeout(500);

    const commandsTab = window.locator('button').filter({ hasText: 'Commands' }).first();
    if (await commandsTab.count() > 0) {
      await commandsTab.click();
      await window.waitForTimeout(500);
    }
    await window.screenshot({ path: path.join(AUDIT_DIR, '07-commands-tab.png'), fullPage: true });
    console.log('Screenshot saved: 07-commands-tab.png');

    // Check visibility of command textarea
    const textareaInfo = await window.evaluate(() => {
      const textareas = document.querySelectorAll('textarea');
      return Array.from(textareas).map((ta, i) => ({
        index: i,
        visible: (ta as HTMLElement).offsetParent !== null,
        rect: ta.getBoundingClientRect(),
        placeholder: ta.placeholder?.substring(0, 50) || '',
      }));
    });
    console.log('Textarea visibility:', textareaInfo);
  });

  test('V8: Map all panel regions by bounding box', async () => {
    const regions = await window.evaluate(() => {
      const panels = document.querySelectorAll('[class*="panel"], [class*="Panel"], [class*="sidebar"], [class*="Sidebar"]');
      return Array.from(panels).map(p => ({
        class: p.className?.toString().substring(0, 80) || '',
        rect: p.getBoundingClientRect(),
        visible: (p as HTMLElement).offsetParent !== null,
      })).filter(p => p.rect.width > 0 && p.rect.height > 0);
    });
    console.log('Panel regions:');
    regions.forEach(r => console.log(`  ${r.class}: ${r.rect.x},${r.rect.y} ${r.rect.width}x${r.rect.height} visible=${r.visible}`));
  });

  test('V9: Click Import and check file dialog', async () => {
    const importBtn = window.locator('button').filter({ hasText: 'Import Assets' }).first();
    if (await importBtn.count() > 0) {
      // Try with filechooser
      const [fileChooser] = await Promise.all([
        window.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
        importBtn.click(),
      ]);
      console.log('File chooser appeared:', !!fileChooser);
      if (fileChooser) {
        console.log('File chooser multiple:', fileChooser.isMultiple());
        await fileChooser.setFiles([]);
      }
    }
  });

  test('V10: Check hidden file input', async () => {
    const hiddenInput = window.locator('input[type="file"]');
    const count = await hiddenInput.count();
    console.log('Hidden file inputs:', count);
    if (count > 0) {
      // Check if the Import button triggers this hidden input
      const importBtn = window.locator('button').filter({ hasText: 'Import Assets' }).first();
      if (await importBtn.count() > 0) {
        // Check if clicking Import triggers the hidden input
        const inputBefore = await hiddenInput.evaluate(el => (el as HTMLInputElement).value);
        console.log('Input value before:', inputBefore);
      }
    }
  });
});
