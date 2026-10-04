import puppeteer from 'puppeteer-core';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new'
  });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  
  const dump = await page.evaluate(() => {
    return {
      branches: JSON.parse(localStorage.getItem('library_branches') || '[]'),
      sections: JSON.parse(localStorage.getItem('library_sections') || '[]'),
      seatTypes: JSON.parse(localStorage.getItem('library_seat_types') || '[]'),
      shifts: JSON.parse(localStorage.getItem('library_shifts') || '[]'),
      plans: JSON.parse(localStorage.getItem('library_plans') || '[]'),
      seats: JSON.parse(localStorage.getItem('library_seats') || '[]'),
      students: JSON.parse(localStorage.getItem('library_students') || '[]'),
      settings: JSON.parse(localStorage.getItem('library_settings') || '{}')
    };
  });
  
  fs.writeFileSync('scratch/real_config_dump.json', JSON.stringify(dump, null, 2));
  
  console.log(`Dumped:
Branches: ${dump.branches.length}
Sections: ${dump.sections.length}
SeatTypes: ${dump.seatTypes.length}
Shifts: ${dump.shifts.length}
Plans: ${dump.plans.length}
Seats: ${dump.seats.length}
Students: ${dump.students.length}
  `);
  
  await browser.close();
})();
