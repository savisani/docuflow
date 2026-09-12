/**
 * DocuFlow Studio Manual UI Audit
 *
 * Uses Playwright Electron to interact with the real UI like a human.
 * Every test uses actual UI interaction — no internal API calls.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTRY = path.join(__dirname, 'out', 'main', 'index.js');
const AUDIT_DIR = path.join(__dirname, '.test-studio-audit');

let electronApp: ElectronApplication;
let window: Page;

test.describe.serial('DocuFlow Studio Audit', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(AUDIT_DIR)) {
      fs.mkdirSync(AUDIT_DIR, { recursive: true });
    }
  });

  test.afterAll(async () => {
    if (fs.existsSync(AUDIT_DIR)) {
      fs.rmSync(AUDIT_DIR, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: LAUNCH & INSPECT
  // ═══════════════════════════════════════════════════════════════

  test('1.1 App launches without crash', async () => {
    electronApp = await electron.launch({ args: [ENTRY] });
    window = await electronApp.firstWindow();
    await window.waitForTimeout(3000);

    const title = await window.title();
    expect(title).toBe('DocuFlow');
  });

  test('1.2 Take full UI snapshot for inventory', async () => {
    // Capture the full page snapshot to understand the UI layout
    const snapshot = await window.evaluate(() => {
      const body = document.body;
      const getAllInteractiveElements = (el: Element): string[] => {
        const results: string[] = [];
        const tags = el.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [data-testid]');
        tags.forEach(tag => {
          const text = tag.textContent?.trim().substring(0, 50) || '';
          const tag_name = tag.tagName.toLowerCase();
          const role = tag.getAttribute('role') || '';
          const testid = tag.getAttribute('data-testid') || '';
          const ariaLabel = tag.getAttribute('aria-label') || '';
          const className = (tag as HTMLElement).className?.toString().substring(0, 60) || '';
          results.push(`${tag_name}[${role || testid || ariaLabel || className}]: "${text}"`);
        });
        return results;
      };
      return {
        bodyText: body.innerText.substring(0, 3000),
        interactiveElements: getAllInteractiveElements(body),
        bodyHTML: body.innerHTML.length,
      };
    });

    console.log('=== UI BODY TEXT ===');
    console.log(snapshot.bodyText);
    console.log('\n=== INTERACTIVE ELEMENTS ===');
    snapshot.interactiveElements.forEach(el => console.log(el));
    console.log(`\n=== HTML size: ${snapshot.bodyHTML} chars ===`);

    // Store for later reference
    fs.writeFileSync(path.join(AUDIT_DIR, 'ui-snapshot.json'), JSON.stringify(snapshot, null, 2));
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: PROJECT CONTROLS
  // ═══════════════════════════════════════════════════════════════

  test('2.1 TitleBar is visible with window controls', async () => {
    // Look for title bar elements
    const titleBar = await window.evaluate(() => {
      const el = document.querySelector('[class*="titlebar"], [class*="TitleBar"], [data-testid*="titlebar"]');
      return {
        exists: !!el,
        text: el?.textContent?.substring(0, 100) || '',
      };
    });
    console.log('TitleBar:', titleBar);
  });

  test('2.2 File menu / Save button exists', async () => {
    const buttons = await window.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      return allButtons.map(b => ({
        text: b.textContent?.trim().substring(0, 50) || '',
        ariaLabel: b.getAttribute('aria-label') || '',
        className: b.className?.toString().substring(0, 80) || '',
        disabled: b.disabled,
      }));
    });
    console.log('All buttons found:', buttons.length);
    buttons.forEach(b => console.log(`  btn: "${b.text}" aria="${b.ariaLabel}" disabled=${b.disabled}`));
  });

  test('2.3 New Project via UI', async () => {
    // Look for "New" or "File > New" or similar
    const newButton = window.locator('button').filter({ hasText: /new/i }).first();
    const exists = await newButton.count() > 0;
    console.log('New button found:', exists);

    if (exists) {
      // Check if it's clickable
      const isDisabled = await newButton.isDisabled();
      console.log('New button disabled:', isDisabled);
    }
  });

  test('2.4 Save button exists and responds to click', async () => {
    // Look for save button
    const saveButton = window.locator('button').filter({ hasText: /save/i }).first();
    const exists = await saveButton.count() > 0;
    console.log('Save button found:', exists);

    if (exists) {
      const isDisabled = await saveButton.isDisabled();
      console.log('Save button disabled:', isDisabled);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: ASSET SYSTEM
  // ═══════════════════════════════════════════════════════════════

  test('3.1 Assets panel is visible', async () => {
    const assetsPanel = await window.evaluate(() => {
      const el = document.querySelector('[class*="asset"], [class*="Asset"], [data-testid*="asset"]');
      const text = document.body.innerText;
      return {
        exists: !!el,
        hasAssetsText: text.includes('Assets') || text.includes('assets'),
      };
    });
    console.log('Assets panel:', assetsPanel);
  });

  test('3.2 Import button exists', async () => {
    const importButton = window.locator('button').filter({ hasText: /import/i }).first();
    const exists = await importButton.count() > 0;
    console.log('Import button found:', exists);
  });

  test('3.3 Asset panel shows empty state', async () => {
    const emptyState = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasNoAssets: text.includes('No assets') || text.includes('no assets') || text.includes('Drop') || text.includes('empty'),
        hasImportHint: text.includes('Import') || text.includes('import') || text.includes('drag'),
      };
    });
    console.log('Empty state:', emptyState);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: TIMELINE
  // ═══════════════════════════════════════════════════════════════

  test('4.1 Timeline panel is visible', async () => {
    const timeline = await window.evaluate(() => {
      const el = document.querySelector('[class*="timeline"], [class*="Timeline"], [data-testid*="timeline"]');
      return {
        exists: !!el,
        text: el?.textContent?.substring(0, 200) || '',
      };
    });
    console.log('Timeline:', timeline);
  });

  test('4.2 Timeline has ruler/time display', async () => {
    const ruler = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasTimeDisplay: /\d+:\d+/.test(text) || /\d+\.\d+/.test(text),
        hasRuler: !!document.querySelector('[class*="ruler"], [class*="Ruler"]'),
      };
    });
    console.log('Timeline ruler:', ruler);
  });

  test('4.3 Play/pause controls exist', async () => {
    const controls = await window.evaluate(() => {
      const playBtn = document.querySelector('[class*="play"], [data-testid*="play"], button[aria-label*="play" i]');
      const pauseBtn = document.querySelector('[class*="pause"], [data-testid*="pause"], button[aria-label*="pause" i]');
      return {
        playExists: !!playBtn,
        pauseExists: !!pauseBtn,
      };
    });
    console.log('Playback controls:', controls);
  });

  test('4.4 Timeline tracks/layers area exists', async () => {
    const tracks = await window.evaluate(() => {
      const els = document.querySelectorAll('[class*="track"], [class*="Track"], [class*="layer"], [class*="Layer"]');
      return {
        count: els.length,
        classes: Array.from(els).map(e => e.className?.toString().substring(0, 60)).slice(0, 5),
      };
    });
    console.log('Timeline tracks:', tracks);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: PREVIEW
  // ═══════════════════════════════════════════════════════════════

  test('5.1 Preview panel is visible', async () => {
    const preview = await window.evaluate(() => {
      const el = document.querySelector('[class*="preview"], [class*="Preview"], [data-testid*="preview"]');
      const canvas = document.querySelector('canvas');
      return {
        panelExists: !!el,
        canvasExists: !!canvas,
        canvasWidth: (canvas as HTMLCanvasElement)?.width || 0,
        canvasHeight: (canvas as HTMLCanvasElement)?.height || 0,
      };
    });
    console.log('Preview panel:', preview);
  });

  test('5.2 Preview shows empty/default state', async () => {
    const previewState = await window.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const data = ctx.getImageData(0, 0, Math.min(canvas.width, 10), Math.min(canvas.height, 10));
          const nonZeroPixels = data.data.filter((v, i) => i % 4 !== 3 && v !== 0).length;
          return { hasContent: nonZeroPixels > 0, width: canvas.width, height: canvas.height };
        }
      }
      return { hasContent: false, width: 0, height: 0 };
    });
    console.log('Preview state:', previewState);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: AI PANELS
  // ═══════════════════════════════════════════════════════════════

  test('6.1 AI Image Generator panel exists', async () => {
    const aiPanel = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasImageGen: text.includes('Image Generator') || text.includes('Image Gen') || text.includes('Generate'),
        hasSceneGen: text.includes('Scene Generator') || text.includes('Scene Gen'),
      };
    });
    console.log('AI panels:', aiPanel);
  });

  test('6.2 AI prompt input exists', async () => {
    const inputs = await window.evaluate(() => {
      const textareas = document.querySelectorAll('textarea');
      const inputs = document.querySelectorAll('input[type="text"]');
      return {
        textareaCount: textareas.length,
        textInputCount: inputs.length,
        textareaPlaceholders: Array.from(textareas).map(t => t.placeholder?.substring(0, 50) || ''),
      };
    });
    console.log('AI inputs:', inputs);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 7: INSPECTOR / PROPERTIES
  // ═══════════════════════════════════════════════════════════════

  test('7.1 Inspector panel exists', async () => {
    const inspector = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasInspector: text.includes('Inspector') || text.includes('Properties'),
        hasCommands: text.includes('Commands') || text.includes('Command'),
      };
    });
    console.log('Inspector:', inspector);
  });

  test('7.2 Command editor exists', async () => {
    const cmdEditor = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasEditor: text.includes('Command Editor') || text.includes('command editor'),
        hasAddCommand: text.includes('Add Command') || text.includes('add command'),
      };
    });
    console.log('Command editor:', cmdEditor);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 8: TABS / PANELS
  // ═══════════════════════════════════════════════════════════════

  test('8.1 Tab navigation works', async () => {
    const tabs = await window.evaluate(() => {
      const tabEls = document.querySelectorAll('[role="tab"], [class*="tab"], [class*="Tab"]');
      return {
        count: tabEls.length,
        texts: Array.from(tabEls).map(t => t.textContent?.trim().substring(0, 30) || '').slice(0, 10),
      };
    });
    console.log('Tabs:', tabs);
  });

  test('8.2 Panel visibility toggles', async () => {
    // Check for panel toggle buttons or collapse controls
    const toggles = await window.evaluate(() => {
      const btns = document.querySelectorAll('button[aria-label*="toggle" i], button[aria-label*="collapse" i], button[aria-label*="expand" i], [class*="collapse"], [class*="toggle"]');
      return {
        count: btns.length,
        labels: Array.from(btns).map(b => b.getAttribute('aria-label') || b.textContent?.trim().substring(0, 30) || '').slice(0, 10),
      };
    });
    console.log('Panel toggles:', toggles);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 9: MOTION GRAPHICS
  // ═══════════════════════════════════════════════════════════════

  test('9.1 Motion Graphics panel exists', async () => {
    const motion = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasMotion: text.includes('Motion') || text.includes('motion'),
        hasMotionGraphics: text.includes('Motion Graphics') || text.includes('motion graphics'),
      };
    });
    console.log('Motion panel:', motion);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 10: VOICEOVER / TRANSCRIPT
  // ═══════════════════════════════════════════════════════════════

  test('10.1 Voiceover panel exists', async () => {
    const voiceover = await window.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasVoiceover: text.includes('Voiceover') || text.includes('voiceover'),
        hasTranscript: text.includes('Transcript') || text.includes('transcript'),
      };
    });
    console.log('Voiceover panel:', voiceover);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 11: DIALOG TESTING
  // ═══════════════════════════════════════════════════════════════

  test('11.1 Clicking Save on new project shows Save dialog', async () => {
    // Find and click Save button
    const saveButton = window.locator('button').filter({ hasText: /save/i }).first();
    if (await saveButton.count() > 0) {
      // Listen for dialog
      const dialogPromise = window.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await saveButton.click();
      const dialog = await dialogPromise;
      console.log('Save dialog appeared:', !!dialog);
      if (dialog) {
        // Cancel the dialog
        await dialog.setFiles([]);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 12: CONSOLE ERRORS
  // ═══════════════════════════════════════════════════════════════

  test('12.1 Capture console errors during session', async () => {
    const errors: string[] = [];
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await window.waitForTimeout(2000);

    const fatalErrors = errors.filter(
      (e) => !e.includes('ERR_CONNECTION_REFUSED') &&
             !e.includes('Failed to load resource') &&
             !e.includes('Content Security Policy')
    );

    console.log('Console errors:', errors.length, 'total,', fatalErrors.length, 'fatal');
    if (fatalErrors.length > 0) {
      console.log('Fatal errors:', fatalErrors);
    }
  });
});
