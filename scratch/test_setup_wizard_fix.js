import puppeteer from 'puppeteer-core';

const APP_URL = 'http://localhost:3000';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function verifySetupWizardFix() {
  console.log('====================================================');
  console.log('TESTING SETUP WIZARD FIX: START SETUP & CONTINUE SETUP');
  console.log('====================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const errors = [];
  page.on('pageerror', err => {
    console.error('PAGE ERROR DETECTED:', err.stack || err.message);
    errors.push(err.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('CONSOLE ERROR DETECTED:', msg.text());
      errors.push(msg.text());
    }
  });

  // TEST 1: START LIBRARY SETUP (NOT_STARTED)
  console.log('--- TEST 1: Start Library Setup (State: NOT_STARTED) ---');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('library_settings') || '{}');
    settings.isSetupComplete = false;
    settings.setupStatus = 'NOT_STARTED';
    localStorage.setItem('library_settings', JSON.stringify(settings));
    localStorage.removeItem('wizardDraft');
  });

  await page.goto(APP_URL + '?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));

  // Ensure on Dashboard
  await page.evaluate(() => {
    const dashBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Dashboard'));
    if (dashBtn) dashBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  // Click Start Library Setup
  const clickedStart = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.includes('Start') && b.textContent.includes('Setup')
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log('Clicked Start Library Setup button:', clickedStart);
  await new Promise(r => setTimeout(r, 1000));

  // Verify wizard content is rendered (NOT BLANK)
  const wizardState1 = await page.evaluate(() => {
    const wizardH1 = Array.from(document.querySelectorAll('h1')).find(h => h.textContent.includes('Setup Wizard'));
    const stepSubtitle = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Step 1'));
    const isVisible = !!wizardH1 && !!stepSubtitle;
    const bodyText = document.body.innerText.trim();
    const isBlank = bodyText.length === 0;
    return { 
      header: wizardH1?.textContent.trim(), 
      stepTitle: stepSubtitle?.textContent.trim(), 
      isVisible, 
      isBlank 
    };
  });

  console.log('Wizard State 1:', wizardState1);

  if (wizardState1.isBlank || !wizardState1.isVisible || !wizardState1.header?.includes('Setup Wizard')) {
    console.error('FAIL: Setup Wizard is blank or not rendered for Start Setup!');
    await browser.close();
    process.exit(1);
  }
  console.log('🟢 PASS: Start Setup opened smoothly with Step 1 rendered. No white screen!\n');

  // Close Wizard via Exit Setup
  await page.evaluate(() => {
    const exitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Exit Setup'));
    if (exitBtn) exitBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // TEST 2: CONTINUE SETUP (DRAFT at Step 3)
  console.log('--- TEST 2: Continue Setup (State: DRAFT at Step 3) ---');
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('library_settings') || '{}');
    settings.isSetupComplete = false;
    settings.setupStatus = 'DRAFT';
    localStorage.setItem('library_settings', JSON.stringify(settings));
    localStorage.setItem('wizardDraft', JSON.stringify({
      step: 3,
      tempLibraryName: 'My Awesome Library',
      tempBranches: [],
      tempSections: []
    }));
  });

  await page.goto(APP_URL + '?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));

  // Ensure on Dashboard
  await page.evaluate(() => {
    const dashBtn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Dashboard'));
    if (dashBtn) dashBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  // Click Continue Setup
  const clickedContinue = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.includes('Continue') && b.textContent.includes('Setup')
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log('Clicked Continue Setup button:', clickedContinue);
  await new Promise(r => setTimeout(r, 1000));

  // Verify wizard opened at Step 3 without resetting to Step 1 and NOT BLANK
  const wizardState2 = await page.evaluate(() => {
    const wizardH1 = Array.from(document.querySelectorAll('h1')).find(h => h.textContent.includes('Setup Wizard'));
    const stepText = Array.from(document.querySelectorAll('span')).find(s => s.textContent.includes('Step 3 of 8'))?.textContent;
    const isVisible = !!wizardH1 && !!stepText;
    const bodyText = document.body.innerText.trim();
    const isBlank = bodyText.length === 0;
    return { header: wizardH1?.textContent.trim(), stepText, isVisible, isBlank };
  });

  console.log('Wizard State 2:', wizardState2);

  if (wizardState2.isBlank || !wizardState2.isVisible || !wizardState2.stepText?.includes('Step 3')) {
    console.error('FAIL: Continue Setup did not resume at Step 3 or is blank!');
    await browser.close();
    process.exit(1);
  }
  console.log('🟢 PASS: Continue Setup opened smoothly and resumed at Step 3. No white screen!\n');

  // Close Wizard
  await page.evaluate(() => {
    const exitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Exit Setup'));
    if (exitBtn) exitBtn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  console.log('Checking for recorded errors during session:', errors);
  if (errors.length > 0) {
    console.error('FAIL: Console or runtime errors occurred during test:', errors);
    await browser.close();
    process.exit(1);
  }

  console.log('====================================================');
  console.log('🟢 ALL SETUP WIZARD CRASH TESTS PASSED WITH 0 ERRORS');
  console.log('====================================================');
  await browser.close();
  process.exit(0);
}

verifySetupWizardFix();
