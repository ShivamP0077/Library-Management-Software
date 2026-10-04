import puppeteer from 'puppeteer-core';
import fs from 'fs';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new'
  });
  const page = await browser.newPage();
  
  // Set up localstorage monitor
  await page.evaluateOnNewDocument(() => {
    window.originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      console.log(`[LS-SET] ${key} = ${value.slice(0, 100)}`);
      window.originalSetItem.apply(this, arguments);
    };
  });
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  console.log('Loading page to set initial state...');
  await page.goto('http://localhost:3000/empty.html');
  await page.evaluate(() => {
    localStorage.setItem('library_seat_types', JSON.stringify([
      { id: 'st1', name: 'Fixed', branchId: 'all' },
      { id: 'st2', name: 'Non-Fixed', branchId: 'all' }
    ]));
    localStorage.setItem('library_seats', JSON.stringify([{ id: 's1', seatTypeId: 'st-1789148127102' }]));
  });
  
  console.log('Loading app...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  
  await new Promise(r => setTimeout(r, 2500));
  
  const final = await page.evaluate(() => localStorage.getItem('library_seat_types'));
  const didRender = await page.evaluate(() => localStorage.getItem('DEBUG_DID_RENDER'));
  console.log('FINAL library_seat_types:', final);
  console.log('FINAL DEBUG_DID_RENDER:', didRender);
  
  await browser.close();
})();
