const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  const logs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    else logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000);

  // Check preload
  const docuflowType = await page.evaluate(() => typeof (window).docuflow);
  console.log('window.docuflow type:', docuflowType);

  if (docuflowType !== 'undefined') {
    const methods = await page.evaluate(() => Object.keys((window).docuflow));
    console.log('window.docuflow methods:', JSON.stringify(methods));

    // Test filePathToAssetUrl
    const testUrl = await page.evaluate(() => (window).docuflow.filePathToAssetUrl('C:\\Users\\test\\video.mp4'));
    console.log('filePathToAssetUrl test:', testUrl);
  }

  if (errors.length) {
    console.log('\nConsole errors:');
    errors.forEach(e => console.log(' -', e));
  } else {
    console.log('\nNo console errors');
  }

  if (logs.length) {
    console.log('\nConsole logs:');
    logs.forEach(l => console.log(' ', l));
  }

  await browser.close();
})();
