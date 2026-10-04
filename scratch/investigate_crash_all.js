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
  
  // Get all text nodes containing "Section"
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div, button, a, span, select, option')).filter(el => {
      // Only get visible elements that contain "Section"
      return el.innerText && el.innerText.includes('Section') && el.getBoundingClientRect().width > 0;
    }).map(el => el.outerHTML);
  });
  
  console.log('Found elements with Section:', elements.length);
  for(let html of elements) {
    if(html.length < 200) console.log(html);
  }
  
  await browser.close();
})();
