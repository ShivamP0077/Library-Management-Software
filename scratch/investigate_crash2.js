import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  
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
  
  // Change Section Dropdown
  await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    // Find the one that has an option text including "Section" or "Block" or something
    for(let sel of selects) {
      if(Array.from(sel.options).some(o => o.innerText.toLowerCase().includes('section') || o.innerText.toLowerCase().includes('ac'))) {
        sel.selectedIndex = sel.options.length - 1; // pick the last one
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
