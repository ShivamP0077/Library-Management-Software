import puppeteer from 'puppeteer-core';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  // Navigate to Library Settings
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button'));
    const btn = btns.find(b => b.innerText.includes('Library Settings'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Select Section
  await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    // Find Section selector
    const secSel = selects.find(s => s.options.length > 0 && (s.options[0].text.toLowerCase().includes('section') || Array.from(s.options).some(o => o.text.toLowerCase().includes('ac'))));
    if (secSel && secSel.options.length > 1) {
      secSel.selectedIndex = 1; 
      secSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  
  await page.screenshot({ path: 'scratch/crash.png' });
  
  // Get all text on the page to see if it's a white screen
  const html = await page.evaluate(() => document.body.innerHTML);
  
  // check for react error overlay
  const hasOverlay = await page.evaluate(() => !!document.querySelector('vite-error-overlay'));
  
  console.log(JSON.stringify({ 
    htmlLength: html.length,
    hasOverlay,
    htmlSnippet: html.substring(0, 200)
  }, null, 2));
  
  await browser.close();
})();
