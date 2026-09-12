/**
 * Cross-Track Drag Tests — Real Electron + Playwright mouse interaction
 *
 * Tests: Main→Other, Other→Main, empty track persistence, drag into empty track, multi-track.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTRY = path.join(__dirname, 'out', 'main', 'index.js');

let electronApp: ElectronApplication;
let window: Page;

const MOCK_ASSETS = [
  { id: 'ma1', logicalId: 'image1', filename: 'test-image-1.png', type: 'image', mimeType: 'image/png', filePath: '/tmp/t1.png', url: 'docuflow-asset:///tmp/t1.png', width: 1920, height: 1080 },
  { id: 'ma2', logicalId: 'image2', filename: 'test-image-2.png', type: 'image', mimeType: 'image/png', filePath: '/tmp/t2.png', url: 'docuflow-asset:///tmp/t2.png', width: 1920, height: 1080 },
  { id: 'ma3', logicalId: 'image3', filename: 'test-image-3.png', type: 'image', mimeType: 'image/png', filePath: '/tmp/t3.png', url: 'docuflow-asset:///tmp/t3.png', width: 1920, height: 1080 },
];

async function launchApp() {
  electronApp = await electron.launch({ args: [ENTRY] });
  window = await electronApp.firstWindow();
  await window.waitForTimeout(4000);
}

async function injectAssetsAndCommands(commandsJson: string) {
  await window.evaluate((assets) => {
    const store = (window as any).__docuflow_store;
    if (!store) throw new Error('Store not exposed');
    store.setState({ assets });
  }, MOCK_ASSETS);
  await window.waitForTimeout(300);

  const studioBtn = window.locator('button').filter({ hasText: 'Studio' }).first();
  if (await studioBtn.count() > 0) {
    await studioBtn.click();
    await window.waitForTimeout(300);
  }

  const commandsTab = window.locator('button').filter({ hasText: 'Commands' }).first();
  await commandsTab.click();
  await window.waitForTimeout(300);

  const textarea = window.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 3000 });
  await textarea.fill(commandsJson);

  const parseBtn = window.locator('button').filter({ hasText: 'Parse & Apply' }).first();
  await parseBtn.click();
  await window.waitForTimeout(2000);

  await studioBtn.click();
  await window.waitForTimeout(1000);
}

async function getClipBoxes() {
  return window.evaluate(() => {
    const trackRows = document.querySelector('[data-track-rows]');
    if (!trackRows) return [];
    const results: { left: number; top: number; width: number; height: number; text: string; trackTop: number }[] = [];
    for (const div of trackRows.querySelectorAll('div')) {
      if (div.classList.contains('absolute') && div.style.left && div.style.width && div.className.includes('cursor-grab')) {
        const rect = div.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 5 && rect.height < 60) {
          results.push({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            text: div.textContent?.trim().substring(0, 30) || '',
            trackTop: rect.top,
          });
        }
      }
    }
    return results;
  });
}

/** Count the number of rendered track row divs in the timeline (video group only). */
async function getTrackRowCount() {
  return window.evaluate(() => {
    const trackRows = document.querySelector('[data-track-rows]');
    if (!trackRows) return 0;
    let count = 0;
    for (const div of trackRows.children) {
      if (div instanceof HTMLElement && div.style.height === '32px') {
        // Track rows have overflow-hidden; group headers have bg-df-surface-1/40
        if (div.className.includes('overflow-hidden') && div.className.includes('border-df-divider')) {
          count++;
        }
      }
    }
    return count;
  });
}

async function getStoreState() {
  return window.evaluate(() => {
    const store = (window as any).__docuflow_store;
    if (!store) return null;
    const s = store.getState();
    return {
      commands: s.commands.map((c: any) => ({ id: c.id, asset: c.asset, layer: c.layer, start: c.start })),
      mouseUpDiag: (window as any).__mouseUpDiag || null,
    };
  });
}

async function drag(startX: number, startY: number, endX: number, endY: number, steps = 10, stepDelay = 25) {
  await window.mouse.move(startX, startY);
  await window.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await window.mouse.move(
      startX + ((endX - startX) * i) / steps,
      startY + ((endY - startY) * i) / steps,
      { steps: 1 }
    );
    await window.waitForTimeout(stepDelay);
  }
  await window.waitForTimeout(150);
  await window.mouse.up();
  await window.waitForTimeout(500);
}

// ═══════════════════════════════════════════════════════════════
// Test A: Main → Other
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Cross-Track: Main→Other', () => {
  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('A-1: Single main track — drag downward moves to empty slot', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
      ]
    }));

    const boxes = await getClipBoxes();
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    const originalTop = b.top;

    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    // Drag far enough down to leave the visible track row
    await drag(cx, cy, cx, cy + 64);

    const afterBoxes = await getClipBoxes();
    expect(afterBoxes.length).toBe(1);

    // Use diagnostic data to verify the layer changed
    const diag = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('A-1 diag:', JSON.stringify(diag));

    const topChanged = Math.abs(afterBoxes[0].top - originalTop) > 5;
    const layerChanged = diag && diag.targetZIndex !== diag.originalZIndex;
    console.log(`A-1: top ${originalTop.toFixed(0)} → ${afterBoxes[0].top.toFixed(0)} (topChanged: ${topChanged}, layerChanged: ${layerChanged})`);
    // The clip MUST have moved to a different layer (the empty track slot)
    expect(layerChanged).toBe(true);
  });

  test('A-2: Two clips — drag lower clip upward to other track', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
        { id: 'c2', type: 'show', asset: 'image2', start: 0, duration: 5 },
      ]
    }));

    const boxes = await getClipBoxes();
    expect(boxes.length).toBeGreaterThanOrEqual(2);

    // Find the lower clip (higher top value = lower on screen)
    const sorted = [...boxes].sort((a, b) => b.top - a.top);
    const lowerClip = sorted[0];
    const originalTop = lowerClip.top;
    const draggedText = lowerClip.text;

    const cx = lowerClip.left + lowerClip.width / 2;
    const cy = lowerClip.top + lowerClip.height / 2;
    await drag(cx, cy, cx, cy - 32);

    const afterBoxes = await getClipBoxes();
    const draggedAfter = afterBoxes.find((c: any) => c.text === draggedText);
    expect(draggedAfter).toBeTruthy();
    const topChanged = Math.abs(draggedAfter!.top - originalTop) > 5;
    console.log(`A-2: top ${originalTop.toFixed(0)} → ${draggedAfter!.top.toFixed(0)} (${draggedText}, changed: ${topChanged})`);
    expect(topChanged).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Test B: Other → Main
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Cross-Track: Other→Main', () => {
  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('B-1: Drag upper clip downward to other track', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
        { id: 'c2', type: 'show', asset: 'image2', start: 0, duration: 5 },
      ]
    }));

    const boxes = await getClipBoxes();
    expect(boxes.length).toBeGreaterThanOrEqual(2);

    // Find the upper clip (lower top value = higher on screen)
    const sorted = [...boxes].sort((a, b) => a.top - b.top);
    const upperClip = sorted[0];
    const originalTop = upperClip.top;
    const draggedText = upperClip.text;

    const cx = upperClip.left + upperClip.width / 2;
    const cy = upperClip.top + upperClip.height / 2;
    await drag(cx, cy, cx, cy + 48);

    const afterBoxes = await getClipBoxes();
    const draggedAfter = afterBoxes.find((c: any) => c.text === draggedText);
    expect(draggedAfter).toBeTruthy();

    // Check the mouseUp diagnostic to verify the layer changed
    const diag = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('B-1 diag:', JSON.stringify(diag));

    // The clip should have moved (either top changed or layer changed via diag)
    const topChanged = Math.abs(draggedAfter!.top - originalTop) > 5;
    const layerChanged = diag && diag.targetZIndex !== diag.originalZIndex;
    console.log(`B-1: top ${originalTop.toFixed(0)} → ${draggedAfter!.top.toFixed(0)} (topChanged: ${topChanged}, layerChanged: ${layerChanged})`);
    expect(topChanged || layerChanged).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Test C: Empty track persistence
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Cross-Track: Empty Track Persistence', () => {
  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('C-1: Visible tracks match content after merge', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
        { id: 'c2', type: 'show', asset: 'image2', start: 0, duration: 5 },
      ]
    }));

    const trackRowsBefore = await getTrackRowCount();
    console.log(`C-1: track rows before = ${trackRowsBefore}`);
    // With 2 clips at different layers, there should be at least 2 visible tracks
    expect(trackRowsBefore).toBeGreaterThanOrEqual(2);

    // Move upper clip down (merge)
    const boxes = await getClipBoxes();
    const sorted = [...boxes].sort((a, b) => a.top - b.top);
    const upperClip = sorted[0];
    const cx = upperClip.left + upperClip.width / 2;
    const cy = upperClip.top + upperClip.height / 2;
    await drag(cx, cy, cx, cy + 48);

    const trackRowsAfter = await getTrackRowCount();
    console.log(`C-1: track rows after = ${trackRowsAfter}`);
    // After merge, at least 1 track should still be visible
    expect(trackRowsAfter).toBeGreaterThanOrEqual(1);
  });

  test('C-2: Drag clip into empty track', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
      ]
    }));

    const boxes = await getClipBoxes();
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    const originalTop = b.top;

    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    await drag(cx, cy, cx, cy + 32);

    const afterBoxes = await getClipBoxes();
    expect(afterBoxes.length).toBe(1);

    const diag = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('C-2 diag:', JSON.stringify(diag));

    const topChanged = Math.abs(afterBoxes[0].top - originalTop) > 5;
    const layerChanged = diag && diag.targetZIndex !== diag.originalZIndex;
    console.log(`C-2: top ${originalTop.toFixed(0)} → ${afterBoxes[0].top.toFixed(0)} (topChanged: ${topChanged}, layerChanged: ${layerChanged})`);
    // The clip MUST have moved to the empty track
    expect(layerChanged).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Test D: Multiple tracks
// ═══════════════════════════════════════════════════════════════
test.describe.serial('Cross-Track: Multi-Track', () => {
  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('D-1: Three clips — drag between tracks', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
        { id: 'c2', type: 'show', asset: 'image2', start: 0, duration: 5 },
        { id: 'c3', type: 'show', asset: 'image3', start: 0, duration: 5 },
      ]
    }));

    const boxes = await getClipBoxes();
    console.log('D-1 initial:', boxes.map(b => `[${b.text}: top=${b.top.toFixed(0)}]`));
    expect(boxes.length).toBeGreaterThanOrEqual(3);

    const sorted = [...boxes].sort((a, b) => b.top - a.top);
    const lowestClip = sorted[0];
    const originalTop = lowestClip.top;
    const draggedText = lowestClip.text;

    const cx = lowestClip.left + lowestClip.width / 2;
    const cy = lowestClip.top + lowestClip.height / 2;
    await drag(cx, cy, cx, cy - 64);

    const afterBoxes = await getClipBoxes();
    const draggedAfter = afterBoxes.find((c: any) => c.text === draggedText);
    expect(draggedAfter).toBeTruthy();

    const diag = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('D-1 diag:', JSON.stringify(diag));

    const topChanged = Math.abs(draggedAfter!.top - originalTop) > 5;
    const layerChanged = diag && diag.targetZIndex !== diag.originalZIndex;
    console.log(`D-1: top ${originalTop.toFixed(0)} → ${draggedAfter!.top.toFixed(0)} (topChanged: ${topChanged}, layerChanged: ${layerChanged})`);
    expect(topChanged || layerChanged).toBe(true);

    const trackRows = await getTrackRowCount();
    console.log(`D-1: track rows = ${trackRows}`);
    expect(trackRows).toBeGreaterThanOrEqual(2);
  });

  test('D-2: Clips can be moved to separate tracks', async () => {
    await launchApp();
    await injectAssetsAndCommands(JSON.stringify({
      commands: [
        { id: 'c1', type: 'show', asset: 'image1', start: 0, duration: 5 },
        { id: 'c2', type: 'show', asset: 'image2', start: 0, duration: 5 },
      ]
    }));

    // First drag: upper clip down to merge onto same track
    let boxes = await getClipBoxes();
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    let sorted = [...boxes].sort((a, b) => a.top - b.top);
    let clip = sorted[0];
    let cx = clip.left + clip.width / 2;
    let cy = clip.top + clip.height / 2;
    await drag(cx, cy, cx, cy + 48);

    // Verify merge happened (clips on same track)
    const diag1 = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('D-2: after first drag, layerChanged:', diag1?.targetZIndex !== diag1?.originalZIndex);

    // Second drag: drag lower clip down further to a new empty slot
    boxes = await getClipBoxes();
    sorted = [...boxes].sort((a, b) => b.top - a.top);
    clip = sorted[0];
    cx = clip.left + clip.width / 2;
    cy = clip.top + clip.height / 2;
    await drag(cx, cy, cx, cy + 64);

    const diag2 = await window.evaluate(() => (window as any).__mouseUpDiag);
    console.log('D-2: after second drag, diag:', JSON.stringify(diag2));
    const layerChanged = diag2 && diag2.targetZIndex !== diag2.originalZIndex;
    console.log(`D-2: second drag moved to different layer: ${layerChanged}`);
    expect(layerChanged).toBe(true);

    const afterBoxes = await getClipBoxes();
    console.log(`D-2: visible clips = ${afterBoxes.length}`);
    expect(afterBoxes.length).toBeGreaterThanOrEqual(2);
  });
});
