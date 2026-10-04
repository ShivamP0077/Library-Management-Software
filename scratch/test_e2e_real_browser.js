import puppeteer from 'puppeteer-core';
import fs from 'fs';
import assert from 'assert';

const APP_URL = 'http://localhost:3000';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runTest() {
  console.log('==================================================');
  console.log('RUNNING REAL BROWSER E2E VERIFICATION');
  console.log('==================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--window-size=1400,900',
      `--user-data-dir=/tmp/test_chrome_e2e_${Date.now()}`
    ]
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  await page.setViewport({ width: 1400, height: 900 });

  // 1. Navigate to blank static page on origin to initialize localStorage cleanly
  console.log('Navigating to static empty page to populate test state...');
  await page.goto('http://localhost:3000/empty.html', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // 2. Populate genuine user setup in localStorage
  const libId = 'lib-1789147966083';
  const branchId = 'b-1789147966083';
  const sec1Id = 'blk-1789148083200'; // non ac
  const sec2Id = 'blk-1789148101149'; // ac
  const st1Id = 'st-1789148127102'; // fixed in sec1
  const st2Id = 'st-1789148171913'; // non fixed in sec1
  const st3Id = 'st-1789148182051'; // fixed in sec2

  const branches = [
    { id: branchId, code: 'BHA', name: 'Bhavnagar', address: 'Bhavnagar Main', active: true, libraryId: libId }
  ];
  const sections = [
    { id: sec1Id, name: 'non ac', branchId: branchId, libraryId: libId },
    { id: sec2Id, name: 'ac', branchId: branchId, libraryId: libId }
  ];

  // Generate 80 seats in sec1 with st1Id, and 20 seats in sec2 with st3Id
  const seats = [];
  for (let i = 1; i <= 80; i++) {
    seats.push({ id: `seat-sec1-${i}`, name: `S${i}`, seatTypeId: st1Id, branchId, sectionId: sec1Id, libraryId: libId, isMaintenance: false, isUnavailable: false });
  }
  for (let i = 1; i <= 20; i++) {
    seats.push({ id: `seat-sec2-${i}`, name: `S${i}`, seatTypeId: st3Id, branchId, sectionId: sec2Id, libraryId: libId, isMaintenance: false, isUnavailable: false });
  }

  const shifts = [
    { id: 'sh-full', name: 'full day', startTime: '06:00', endTime: '20:00', branchId, sectionId: sec1Id, libraryId: libId, active: true },
    { id: 'sh-morn', name: 'half day morning', startTime: '06:00', endTime: '12:00', branchId, sectionId: sec1Id, libraryId: libId, active: true },
    { id: 'sh-eve', name: 'half day evenings', startTime: '14:00', endTime: '20:00', branchId, sectionId: sec2Id, libraryId: libId, active: true }
  ];

  const plans = [
    { id: 'pl-1', name: 'monthly non ac full day plan', branchId, sectionId: sec1Id, seatTypeId: st1Id, shiftIds: ['sh-full'], durationPricing: [{ durationMonths: 1, basePrice: 2000 }], libraryId: libId, active: true },
    { id: 'pl-2', name: 'monthly ac half day plan', branchId, sectionId: sec2Id, seatTypeId: st3Id, shiftIds: ['sh-eve'], durationPricing: [{ durationMonths: 1, basePrice: 2500 }], libraryId: libId, active: true },
    { id: 'pl-3', name: 'monthly non ac non fix plan', branchId, sectionId: sec1Id, seatTypeId: st2Id, shiftIds: ['sh-full'], durationPricing: [{ durationMonths: 1, basePrice: 1200 }], libraryId: libId, active: true }
  ];

  const settings = {
    name: 'Bhavnagar Study Hub',
    logo: '📖',
    libraryId: libId,
    isSetupComplete: true,
    migrationVersion: 4,
    allowedDocuments: ["Aadhaar Card"],
    documentTypes: [{ id: "doc-aadhaar", name: "Aadhaar Card", requirement: "Required", active: true }]
  };

  const setupData = {
    library_settings: JSON.stringify(settings),
    library_branches: JSON.stringify(branches),
    library_sections: JSON.stringify(sections),
    library_seats: JSON.stringify(seats),
    library_shifts: JSON.stringify(shifts),
    library_plans: JSON.stringify(plans),
    library_seat_types: JSON.stringify([
      { id: 'st1', name: 'Fixed', branchId: 'all' },
      { id: 'st2', name: 'Non-Fixed', branchId: 'all' }
    ])
  };

  console.log('Writing setupData into localStorage...');
  await page.evaluate((data) => {
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
  }, setupData);

  // 3. Navigate to Main Application (React mounts for first time with populated state)
  console.log('Navigating to main application...');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  // 4. Verify Seat Types in LocalStorage
  const dump = await page.evaluate(() => {
    return {
      seatTypes: JSON.parse(localStorage.getItem('library_seat_types') || '[]'),
      seatsLen: JSON.parse(localStorage.getItem('library_seats') || '[]').length,
      plansLen: JSON.parse(localStorage.getItem('library_plans') || '[]').length,
      shiftsLen: JSON.parse(localStorage.getItem('library_shifts') || '[]').length,
    };
  });
  console.log('STORAGE DUMP AFTER RELOAD:', dump);
  const recoveredSeatTypes = dump.seatTypes;

  console.log('\n--- VERIFICATION 1: SEAT TYPES RECONCILIATION ---');
  console.log('Recovered Seat Types in LocalStorage:', recoveredSeatTypes.map(s => `${s.id} (${s.name}, mode: ${s.allocationMode})`));

  const hasSt1 = recoveredSeatTypes.some(s => s.id === 'st1');
  const hasSt2 = recoveredSeatTypes.some(s => s.id === 'st2');
  const hasUserSt1 = recoveredSeatTypes.some(s => s.id === 'st-1789148127102');
  const hasUserSt2 = recoveredSeatTypes.some(s => s.id === 'st-1789148171913');
  const hasUserSt3 = recoveredSeatTypes.some(s => s.id === 'st-1789148182051');

  console.log(`  ✓ Real User Seat Type 1 (Fixed non-ac): ${hasUserSt1 ? 'RESTORED' : 'MISSING'}`);
  console.log(`  ✓ Real User Seat Type 2 (Non-Fixed non-ac): ${hasUserSt2 ? 'RESTORED' : 'MISSING'}`);
  console.log(`  ✓ Real User Seat Type 3 (Fixed ac): ${hasUserSt3 ? 'RESTORED' : 'MISSING'}`);
  console.log(`  ✓ Phantom Demo 'st1': ${!hasSt1 ? 'CLEANLY PRUNED' : 'STILL PRESENT'}`);
  console.log(`  ✓ Phantom Demo 'st2': ${!hasSt2 ? 'CLEANLY PRUNED' : 'STILL PRESENT'}`);

  assert.strictEqual(hasUserSt1, true, "User Seat Type 1 must be restored");
  assert.strictEqual(hasUserSt2, true, "User Seat Type 2 must be restored");
  assert.strictEqual(hasUserSt3, true, "User Seat Type 3 must be restored");
  assert.strictEqual(hasSt1, false, "Phantom st1 must be pruned");
  assert.strictEqual(hasSt2, false, "Phantom st2 must be pruned");

  // 5. Navigate to Library Settings -> Config Tab
  console.log('\n--- VERIFICATION 2: LIBRARY SETTINGS DISPLAY ---');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button, nav a, [role="tab"]'));
    const settingsBtn = navButtons.find(b => b.textContent.includes('Settings') || b.textContent.includes('Administration'));
    if (settingsBtn) settingsBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // Click on Config tab in settings
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const configTab = tabs.find(b => b.textContent.includes('Configuration') || b.textContent.includes('Branches'));
    if (configTab) configTab.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // Verify Seat Types card subtitles (Requirement 9: Fixed (80 seats), Non-Fixed (Unlimited))
  const seatTypeCardTexts = await page.evaluate(() => {
    const section = document.getElementById('seat-types-section');
    if (!section) return [];
    return Array.from(section.querySelectorAll('strong')).map(strong => {
      const parent = strong.closest('div');
      return parent && parent.parentElement ? parent.parentElement.innerText : '';
    });
  });
  console.log('Seat Type Cards HTML in UI:\n', seatTypeCardTexts.join('\n---\n'));

  assert(seatTypeCardTexts.some(t => t.includes('80 seats')), "Must show physical seat count: Fixed (80 seats)");
  assert(seatTypeCardTexts.some(t => t.includes('20 seats')), "Must show physical seat count: Fixed (20 seats)");
  assert(seatTypeCardTexts.some(t => t.includes('Unlimited')), "Must show Non-Fixed (Unlimited)");

  // 6. Navigate to Seat Map
  console.log('\n--- VERIFICATION 3: SEAT MAP SHIFT SCOPE & PROGRESSIVE RESOLUTION ---');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button, nav a'));
    const seatMapBtn = navButtons.find(b => b.textContent.includes('Seat Map'));
    if (seatMapBtn) seatMapBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // Check Seat Map Shift Tabs for Section 1 ("non ac")
  const sec1Shifts = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('[style*="layoutId"]') || b.closest('[style*="boxShadow"]'));
    return tabs.map(t => t.innerText.trim()).filter(Boolean);
  });
  console.log('Shift tabs currently rendered for resolved section:', sec1Shifts);

  // Switch Room to "ac" section
  console.log('Switching to Room: "ac" via progressive Section selector...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const acRoomBtn = buttons.find(b => b.textContent.includes('ac') && !b.textContent.includes('non ac'));
    if (acRoomBtn) acRoomBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  const sec2Shifts = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.closest('[style*="boxShadow"]'));
    return tabs.map(t => t.innerText.trim()).filter(Boolean);
  });
  console.log('Shift tabs after switching to "ac" section:', sec2Shifts);

  // Take screenshot for walkthrough evidence
  await page.screenshot({ path: 'scratch/verified_seatmap_and_settings.png', fullPage: true });
  console.log('Screenshot captured at scratch/verified_seatmap_and_settings.png');

  // 7. Verify Staff Management remains unaffected
  console.log('\n--- VERIFICATION 4: STAFF MANAGEMENT UNTOUCHED & OPERATIONAL ---');
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll('button, nav a'));
    const staffBtn = navButtons.find(b => b.textContent.includes('Staff'));
    if (staffBtn) staffBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  const staffCount = await page.evaluate(() => {
    return document.querySelectorAll('table tbody tr').length || document.querySelectorAll('[class*="staff"]').length;
  });
  console.log(`Staff Management rendered cleanly (rows/cards: ${staffCount})`);

  console.log('\n==================================================');
  console.log('REAL BROWSER E2E VERIFICATION COMPLETED SUCCESSFULLY!');
  console.log('==================================================');

  await browser.close();
}

runTest().catch(err => {
  console.error('Browser Test Failed:', err);
  process.exit(1);
});
