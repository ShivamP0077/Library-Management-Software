import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  
  // Track page errors
  page.on('pageerror', err => {
    console.log('CRASH CAUGHT:', err.message);
    console.log('STACK:', err.stack);
  });
  
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  // Navigate to Students
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const t = tabs.find(b => b.innerText.includes('Students'));
    if (t) t.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Setup a waiting list entry directly in localStorage so we can test the click
  await page.evaluate(() => {
    const wl = [{
      id: 'wl-1',
      name: 'Waitlist Student 1',
      phone: '1234567890',
      branchId: 'b-1789147966083',
      sectionId: 'blk-nonac',
      seatTypeId: 'st-fixed-nonac',
      shiftId: 'sh-full',
      planId: 'p-nonac-full',
      libraryId: 'lib-1789147966083'
    }];
    localStorage.setItem('library_waiting_list', JSON.stringify(wl));
  });
  
  // Refresh to load it
  await page.reload();
  await new Promise(r => setTimeout(r, 2000));
  
  // Navigate to Students again
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const t = tabs.find(b => b.innerText.includes('Students'));
    if (t) t.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Go to Waiting List tab inside Students
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const wlTab = tabs.find(t => t.innerText.includes('Waiting List'));
    if (wlTab) wlTab.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Click Admit
  await page.evaluate(() => {
    const admitBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('Admit'));
    if (admitBtns.length > 0) admitBtns[0].click();
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
