import puppeteer from 'puppeteer-core';
import fs from 'fs';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new'
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.toString()));
  
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
  await page.screenshot({ path: 'scratch/screenshot.png' });
  console.log('Screenshot saved to scratch/screenshot.png');
  
  await browser.close();
})();
