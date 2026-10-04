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
  
  // Expose the React context or localStorage data
  const data = await page.evaluate(() => {
    try {
      const seats = JSON.parse(localStorage.getItem('library_seats'));
      const seatTypes = JSON.parse(localStorage.getItem('library_seat_types'));
      const plans = JSON.parse(localStorage.getItem('library_plans'));
      const branches = JSON.parse(localStorage.getItem('library_branches'));
      const sections = JSON.parse(localStorage.getItem('library_sections'));
      
      return {
        seatsCount: seats?.length || 0,
        seatTypes: seatTypes,
        seatsSample: seats?.slice(0, 5),
        plansCount: plans?.length || 0,
        plans: plans,
        sections: sections,
        branches: branches
      };
    } catch(e) {
      return { error: e.message };
    }
  });
  
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
