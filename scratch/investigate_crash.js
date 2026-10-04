import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('CRASH CAUGHT:', err.message);
    console.log('STACK:', err.stack);
  });
  
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  // Navigate to Library Settings
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const t = tabs.find(b => b.innerText.includes('Library Settings'));
    if (t) t.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Click Section
  await page.evaluate(() => {
    const sectionTabs = Array.from(document.querySelectorAll('.tab-btn'));
    const t = sectionTabs.find(b => b.innerText.includes('Section'));
    if (t) t.click();
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
