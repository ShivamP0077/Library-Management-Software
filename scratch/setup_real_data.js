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
  
  await page.evaluate(() => {
    const libId = 'lib-1789147966083';
    const branchId = 'b-1789147966083';
    const secNonAc = 'blk-nonac';
    const secAc = 'blk-ac';
    
    // Seat Types
    const stFixedNonAc = 'st-fixed-nonac';
    const stFixedAc = 'st-fixed-ac';
    const stNonFixedNonAc = 'st-nonfixed-nonac';
    
    // Shifts
    const shFull = 'sh-full';
    const shMorn = 'sh-morn';
    const shEve = 'sh-eve';
    
    // Plans
    const pNonAcFull = 'p-nonac-full';
    const pAcFull = 'p-ac-full';
    const pNonAcMorn = 'p-nonac-morn';
    const pAcMorn = 'p-ac-morn';
    const pNonAcFullNonFix = 'p-nonac-full-nonfix';

    const settings = {
      id: libId,
      name: 'Mindspace Reading Library & Study Hub / bhai library',
      isSetupComplete: true
    };
    
    const branches = [{ id: branchId, name: 'Main Branch' }];
    
    const sections = [
      { id: secNonAc, name: 'non ac', branchId, libraryId: libId },
      { id: secAc, name: 'ac', branchId, libraryId: libId }
    ];
    
    const seatTypes = [
      { id: stFixedNonAc, name: 'Fixed', allocationMode: 'Fixed', branchId, sectionId: secNonAc, libraryId: libId },
      { id: stFixedAc, name: 'Fixed', allocationMode: 'Fixed', branchId, sectionId: secAc, libraryId: libId },
      { id: stNonFixedNonAc, name: 'Non-Fixed', allocationMode: 'Non-Fixed', capacityMode: 'Unlimited', branchId, sectionId: secNonAc, libraryId: libId }
    ];
    
    const shifts = [
      { id: shFull, name: 'full day', startTime: '06:00', endTime: '20:00', branchId, sectionId: 'all', libraryId: libId },
      { id: shMorn, name: 'half day morning', startTime: '06:00', endTime: '12:00', branchId, sectionId: 'all', libraryId: libId },
      { id: shEve, name: 'half day evenings', startTime: '14:00', endTime: '20:00', branchId, sectionId: 'all', libraryId: libId }
    ];
    
    const plans = [
      { id: pNonAcFull, name: 'monthly non ac full day plan', seatTypeId: stFixedNonAc, shiftIds: [shFull], branchId, sectionId: secNonAc, active: true },
      { id: pAcFull, name: 'monthly ac full day plan', seatTypeId: stFixedAc, shiftIds: [shFull], branchId, sectionId: secAc, active: true },
      { id: pNonAcMorn, name: 'monthly non ac half day plan', seatTypeId: stFixedNonAc, shiftIds: [shMorn, shEve], branchId, sectionId: secNonAc, active: true },
      { id: pAcMorn, name: 'monthly ac half day plan', seatTypeId: stFixedAc, shiftIds: [shMorn, shEve], branchId, sectionId: secAc, active: true },
      { id: pNonAcFullNonFix, name: 'monthly non ac full day non fix plan', seatTypeId: stNonFixedNonAc, shiftIds: [shFull], branchId, sectionId: secNonAc, active: true }
    ];
    
    // Generate actual seats according to bug report: 80 for non ac, 20 for ac
    let seats = [];
    for(let i=1; i<=80; i++) {
      seats.push({ id: `seat-nonac-${i}`, seatNumber: i.toString(), seatTypeId: stFixedNonAc, sectionId: secNonAc, branchId });
    }
    for(let i=1; i<=20; i++) {
      seats.push({ id: `seat-ac-${i}`, seatNumber: i.toString(), seatTypeId: stFixedAc, sectionId: secAc, branchId });
    }

    localStorage.setItem('library_settings', JSON.stringify(settings));
    localStorage.setItem('library_branches', JSON.stringify(branches));
    localStorage.setItem('library_sections', JSON.stringify(sections));
    localStorage.setItem('library_seat_types', JSON.stringify(seatTypes));
    localStorage.setItem('library_shifts', JSON.stringify(shifts));
    localStorage.setItem('library_plans', JSON.stringify(plans));
    localStorage.setItem('library_seats', JSON.stringify(seats));
    localStorage.setItem('library_students', JSON.stringify([]));
  });
  
  await browser.close();
  console.log('Real configuration loaded into chrome_test_profile');
})();
