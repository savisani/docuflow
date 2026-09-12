import { test, expect } from '@playwright/test';

const TRACK_HEIGHT = 32;

async function setupProject(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const store = (window as any).__docuflow_store;
    const state = store.getState();
    state.newProject();
    state.addAsset({ id: 'a1', logicalId: 'image1', filename: 'image1.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image1.jpg', url: 'docuflow-asset:///tmp/image1.jpg', duration: 5 });
    state.addAsset({ id: 'a2', logicalId: 'image2', filename: 'image2.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image2.jpg', url: 'docuflow-asset:///tmp/image2.jpg', duration: 5 });
    state.addAsset({ id: 'a3', logicalId: 'image3', filename: 'image3.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image3.jpg', url: 'docuflow-asset:///tmp/image3.jpg', duration: 5 });
    state.addAsset({ id: 'a4', logicalId: 'image4', filename: 'image4.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image4.jpg', url: 'docuflow-asset:///tmp/image4.jpg', duration: 5 });
  });
  await page.waitForTimeout(1000);
}

async function getCommands(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const store = (window as any).__docuflow_store;
    return store.getState().commands
      .filter((c: any) => c.type === 'show')
      .map((c: any) => ({ id: c.id, layer: c.layer, start: c.start, duration: c.duration, asset: c.asset }));
  });
}

async function addCmd(page: import('@playwright/test').Page, id: string, asset: string, start: number, duration: number, layer: number) {
  await page.evaluate(({ id, asset, start, duration, layer }) => {
    const store = (window as any).__docuflow_store;
    store.getState().addCommand({ id, type: 'show', asset, start, duration, layer });
  }, { id, asset, start, duration, layer });
  await page.waitForTimeout(300);
}

async function getClips(page: import('@playwright/test').Page) {
  const clips = await page.locator('[data-track-rows] .absolute.rounded-df-sm').all();
  const boxes: { text: string; x: number; y: number; width: number; height: number; asset: string }[] = [];
  for (const clip of clips) {
    const box = await clip.boundingBox();
    const text = await clip.textContent();
    if (box && text) {
      const trimmed = text.trim();
      boxes.push({ text: trimmed, x: box.x, y: box.y, width: box.width, height: box.height, asset: trimmed });
    }
  }
  return boxes;
}

async function dragClip(page: import('@playwright/test').Page, fromText: string, toText: string) {
  const clips = await getClips(page);
  const src = clips.find(c => c.text.includes(fromText));
  const dst = clips.find(c => c.text.includes(toText));
  if (!src || !dst) throw new Error(`Clips not found: ${fromText} or ${toText}`);

  const srcX = src.x + src.width / 2;
  const srcY = src.y + src.height / 2;
  const dstX = dst.x + dst.width / 2;
  const dstY = dst.y + dst.height / 2;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  for (let i = 0; i <= 15; i++) {
    const p = i / 15;
    await page.mouse.move(srcX + (dstX - srcX) * p, srcY + (dstY - srcY) * p);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

async function dragToTrack(page: import('@playwright/test').Page, fromText: string, targetY: number) {
  const clips = await getClips(page);
  const src = clips.find(c => c.text.includes(fromText));
  if (!src) throw new Error(`Clip not found: ${fromText}`);

  const srcX = src.x + src.width / 2;
  const srcY = src.y + src.height / 2;
  const dstX = srcX; // Keep horizontal position
  const dstY = targetY;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  for (let i = 0; i <= 15; i++) {
    const p = i / 15;
    await page.mouse.move(srcX + (dstX - srcX) * p, srcY + (dstY - srcY) * p);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

function expectNoOverlap(cmds: any[]) {
  for (let i = 0; i < cmds.length; i++) {
    for (let j = i + 1; j < cmds.length; j++) {
      if (cmds[i].layer === cmds[j].layer) {
        const aEnd = cmds[i].start + cmds[i].duration;
        const bEnd = cmds[j].start + cmds[j].duration;
        const overlaps = cmds[i].start < cmds[j].start + cmds[j].duration && aEnd > cmds[j].start;
        expect(overlaps, `Overlap detected: ${cmds[i].asset}[${cmds[i].start}-${aEnd}] on layer ${cmds[i].layer} overlaps ${cmds[j].asset}[${cmds[j].start}-${bEnd}] on layer ${cmds[j].layer}`).toBe(false);
      }
    }
  }
}

test.describe('Timeline collision resolution', () => {
  test('Test 1: Same-track collision pushes forward', async ({ page }) => {
    await setupProject(page);
    // Main: A 0-5, B 5-10
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'B', 'image2', 5, 5, 0);

    // Drag B to overlap A (move B to start at 2)
    await dragClip(page, 'image2', 'image1');

    const cmds = await getCommands(page);
    const bCmd = cmds.find(c => c.asset === 'image2');
    expect(bCmd).toBeDefined();
    // B should be pushed after A (start=5) or wherever the drop landed, but no overlap
    expectNoOverlap(cmds);
  });

  test('Test 2: Cross-track collision moves to upper layer', async ({ page }) => {
    await setupProject(page);
    // Main: A 0-5
    await addCmd(page, 'A', 'image1', 0, 5, 0);

    // Place B on Main at 2-7 (overlaps A)
    await addCmd(page, 'B', 'image2', 2, 5, 0);

    const cmds = await getCommands(page);
    // B should have moved to an upper layer
    const aCmd = cmds.find(c => c.asset === 'image1');
    const bCmd = cmds.find(c => c.asset === 'image2');
    expect(aCmd?.layer).toBe(0);
    expect(bCmd?.layer).toBeGreaterThan(0);
    expectNoOverlap(cmds);
  });

  test('Test 3: One occupied upper layer', async ({ page }) => {
    await setupProject(page);
    // Main: A 0-5, First: C 0-5
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'C', 'image3', 0, 5, 1);

    // Place B on Main at 2-7
    await addCmd(page, 'B', 'image2', 2, 5, 0);

    const cmds = await getCommands(page);
    const aCmd = cmds.find(c => c.asset === 'image1');
    const bCmd = cmds.find(c => c.asset === 'image2');
    const cCmd = cmds.find(c => c.asset === 'image3');
    expect(aCmd?.layer).toBe(0);
    expect(cCmd?.layer).toBe(1);
    expect(bCmd?.layer).toBe(2); // Should be on Second Track
    expectNoOverlap(cmds);
  });

  test('Test 4: Multi-layer cascade', async ({ page }) => {
    await setupProject(page);
    // Main: A 0-5, First: B 0-5, Second: C 0-5
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'B', 'image2', 0, 5, 1);
    await addCmd(page, 'C', 'image3', 0, 5, 2);

    // Place D on Main at 2-7
    await page.evaluate(() => {
      const store = (window as any).__docuflow_store;
      store.getState().addAsset({ id: 'a4', logicalId: 'image4', filename: 'image4.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image4.jpg', url: 'docuflow-asset:///tmp/image4.jpg', duration: 5 });
    });
    await addCmd(page, 'D', 'image4', 2, 5, 0);

    const cmds = await getCommands(page);
    const dCmd = cmds.find(c => c.asset === 'image4');
    expect(dCmd?.layer).toBe(3); // Should be on Third Track
    expectNoOverlap(cmds);
  });

  test('Test 5: No unnecessary push when destination is free', async ({ page }) => {
    await setupProject(page);
    // Main: A 0-5, First: B 10-15
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'B', 'image2', 10, 5, 1);

    // Place D on First at 2-7 (no overlap with B)
    await page.evaluate(() => {
      const store = (window as any).__docuflow_store;
      store.getState().addAsset({ id: 'a4', logicalId: 'image4', filename: 'image4.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image4.jpg', url: 'docuflow-asset:///tmp/image4.jpg', duration: 5 });
    });
    await addCmd(page, 'D', 'image4', 2, 5, 1);

    const cmds = await getCommands(page);
    const dCmd = cmds.find(c => c.asset === 'image4');
    const bCmd = cmds.find(c => c.asset === 'image2');
    expect(dCmd?.layer).toBe(1); // Should stay on First Track
    expect(dCmd?.start).toBe(2);
    expect(bCmd?.layer).toBe(1);
    expectNoOverlap(cmds);
  });

  test('Test 6: Existing upper-track drag behavior preserved', async ({ page }) => {
    await setupProject(page);
    // Second: A, First: B, Main: C
    await addCmd(page, 'A', 'image1', 0, 5, 2);
    await addCmd(page, 'B', 'image2', 0, 5, 1);
    await addCmd(page, 'C', 'image3', 0, 5, 0);

    // Drag A to First Track (B's track) - should share the track with collision resolution
    await dragClip(page, 'image1', 'image2');

    const cmds = await getCommands(page);
    const aCmd = cmds.find(c => c.asset === 'image1');
    const bCmd = cmds.find(c => c.asset === 'image2');
    // A should be on First Track or higher
    expect(aCmd?.layer).toBeGreaterThanOrEqual(1);
    expect(bCmd?.layer).toBe(1);
    expectNoOverlap(cmds);
  });

  test('Test 7: Undo restores original state', async ({ page }) => {
    await setupProject(page);
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'B', 'image2', 2, 5, 0);

    // B should have been pushed up due to collision
    const cmdsAfter = await getCommands(page);
    const bAfter = cmdsAfter.find(c => c.asset === 'image2');
    expect(bAfter?.layer).toBeGreaterThan(0);

    // Undo
    await page.evaluate(() => {
      const store = (window as any).__docuflow_store;
      store.getState().undo();
    });
    await page.waitForTimeout(500);

    const cmdsUndo = await getCommands(page);
    // After undo, B should be back on layer 0 at start 2
    const bUndo = cmdsUndo.find(c => c.asset === 'image2');
    expect(bUndo?.layer).toBe(0);
    expect(bUndo?.start).toBe(2);
  });

  test('Test 8: Import does not change existing commands', async ({ page }) => {
    await setupProject(page);
    await addCmd(page, 'A', 'image1', 0, 5, 0);
    await addCmd(page, 'B', 'image2', 5, 5, 1);

    const before = await getCommands(page);

    // Import a new asset (simulate via store)
    await page.evaluate(() => {
      const store = (window as any).__docuflow_store;
      store.getState().addAsset({ id: 'a5', logicalId: 'image5', filename: 'image5.jpg', type: 'image', mimeType: 'image/jpeg', filePath: '/tmp/image5.jpg', url: 'docuflow-asset:///tmp/image5.jpg', duration: 5 });
    });
    await page.waitForTimeout(500);

    const after = await getCommands(page);
    // Existing commands should not change
    const aAfter = after.find(c => c.asset === 'image1');
    const bAfter = after.find(c => c.asset === 'image2');
    const aBefore = before.find(c => c.asset === 'image1');
    const bBefore = before.find(c => c.asset === 'image2');
    expect(aAfter?.layer).toBe(aBefore?.layer);
    expect(aAfter?.start).toBe(aBefore?.start);
    expect(bAfter?.layer).toBe(bBefore?.layer);
    expect(bAfter?.start).toBe(bBefore?.start);
  });
});
