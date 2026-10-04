import puppeteer from 'puppeteer-core';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: 'scratch/chrome_test_profile'
  });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  // Click New Admission
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(b => b.innerText.includes('New Admission'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Select Plan
  await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('.modal-content select'));
    const planSel = selects.find(s => s.previousSibling && s.previousSibling.innerText && s.previousSibling.innerText.includes('Fee Plan'));
    if (planSel && planSel.options.length > 1) {
      planSel.selectedIndex = 1; // pick first real plan
      planSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Expose UI state
  const data = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('.modal-content select'));
    const getVal = id => {
      const sel = selects.find(s => s.previousSibling && s.previousSibling.innerText && s.previousSibling.innerText.includes(id));
      if (!sel) return null;
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.innerText, selected: o.selected }));
    };
    
    const textNodes = Array.from(document.querySelectorAll('.modal-content div, span, p')).map(el => el.innerText);
    const hasVacantError = textNodes.some(t => t && t.includes('No vacant desks'));
    
    return {
      hasVacantError,
      branch: getVal('Branch'),
      section: getVal('Section'),
      plan: getVal('Fee Plan'),
      seatType: getVal('Seat Type'),
      shift: getVal('Operating Shift'),
      physicalDesk: getVal('Physical Desk')
    };
  });
  
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
