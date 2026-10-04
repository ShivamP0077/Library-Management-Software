import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function inspectData() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

  const storageData = await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      try {
        data[key] = JSON.parse(localStorage.getItem(key));
      } catch (e) {
        data[key] = localStorage.getItem(key);
      }
    }
    return data;
  });

  console.log('--- LOCALSTORAGE KEYS PRESENT ---');
  console.log(Object.keys(storageData));

  console.log('\n--- SEAT TYPES ---');
  console.log(JSON.stringify(storageData.reading_room_seat_types || storageData.seat_types, null, 2));

  console.log('\n--- PHYSICAL SEATS (Sample / Count) ---');
  const seats = storageData.reading_room_seats || storageData.seats || [];
  console.log(`Total seats: ${seats.length}`);
  if (seats.length > 0) {
    const seatTypeIdsInSeats = [...new Set(seats.map(s => s.seatTypeId || s.type))];
    console.log('Seat Type IDs referenced by physical seats:', seatTypeIdsInSeats);
    console.log('Sample seats:', seats.slice(0, 3));
  }

  console.log('\n--- PLANS (Sample / Seat Type references) ---');
  const plans = storageData.reading_room_plans || storageData.plans || [];
  console.log(`Total plans: ${plans.length}`);
  plans.forEach(p => {
    console.log(`Plan "${p.name}" (id: ${p.id}, branch: ${p.branchId}, sec: ${p.sectionId}) -> seatTypeId: ${p.seatTypeId}, shiftIds: ${JSON.stringify(p.shiftIds)}`);
  });

  console.log('\n--- SHIFTS ---');
  const shifts = storageData.reading_room_shifts || storageData.shifts || [];
  console.log(`Total shifts: ${shifts.length}`);
  shifts.forEach(s => {
    console.log(`Shift "${s.name}" (id: ${s.id}, branch: ${s.branchId}, sec: ${s.sectionId}) -> ${s.startTime}-${s.endTime}, active: ${s.active}`);
  });

  console.log('\n--- BRANCHES & SECTIONS ---');
  console.log('Branches:', storageData.reading_room_branches || storageData.branches);
  console.log('Sections:', storageData.reading_room_sections || storageData.sections);

  console.log('\n--- STUDENTS (Seat Type & Shift & Plan references) ---');
  const students = storageData.reading_room_students || storageData.students || [];
  console.log(`Total students: ${students.length}`);
  students.forEach(st => {
    console.log(`Student "${st.name}" -> planId: ${st.planId}, shift: ${st.shift}, seatNo: ${st.seatNo}, branchId: ${st.branchId}`);
  });

  console.log('\n--- SETUP WIZARD DRAFT ---');
  console.log('Setup draft:', JSON.stringify(storageData.reading_room_setup_draft || storageData.setup_wizard_draft, null, 2));

  console.log('\n--- SETTINGS ---');
  console.log('Settings:', JSON.stringify(storageData.reading_room_settings || storageData.settings, null, 2));

  await browser.close();
}

inspectData();
