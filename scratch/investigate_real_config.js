import puppeteer from 'puppeteer-core';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR (CRASH!):', err.toString()));
  
  console.log('--- NAVIGATING TO SEAT MAP ---');
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  // 1. Get Seat Map seat count
  const seatMapStats = await page.evaluate(() => {
    // try to find all physical desks rendered
    const desks = document.querySelectorAll('.grid-cell');
    let totalRendered = 0;
    desks.forEach(d => { if (d.innerText.trim()) totalRendered++; });
    
    // try to get from UI summary if exists
    const summary = document.body.innerText.match(/(\d+)\s*Total Seats/i);
    
    return {
      renderedDesksCount: totalRendered,
      summaryText: summary ? summary[0] : 'Not Found',
      allText: document.body.innerText.slice(0, 500)
    };
  });
  console.log('Seat Map Stats:', seatMapStats);

  // 2. Open New Admission and check valid plans
  console.log('--- OPENING NEW ADMISSION ---');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.innerText.includes('New Admission'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  const admissionFormDump = await page.evaluate(() => {
    // select branch, section, seat type, shift
    const selects = document.querySelectorAll('.modal-box select');
    const plans = [];
    let planSelect = null;
    
    selects.forEach(s => {
      const label = s.parentElement.innerText.toLowerCase();
      if (label.includes('plan')) {
        planSelect = s;
        Array.from(s.options).forEach(o => {
           if(o.value) plans.push(o.innerText);
        });
      }
    });
    
    return {
      plansAvailable: plans,
      modalText: document.querySelector('.modal-box') ? document.querySelector('.modal-box').innerText : 'Modal not open'
    };
  });
  console.log('New Admission Form Dump:', JSON.stringify(admissionFormDump, null, 2));
  
  await browser.close();
})();
