const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:8000/index.html');

  // Set to 4 players and start
  await page.selectOption('#player-count', '4');
  await page.click('#start-btn');

  // Wait a moment for layout
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'layout_4p.png' });
  await browser.close();
})();
