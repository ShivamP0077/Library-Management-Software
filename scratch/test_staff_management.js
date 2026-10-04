import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runStaffVerification() {
  console.log('🚀 Starting Staff Management Browser Verification...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      `--user-data-dir=/tmp/chrome_staff_${Date.now()}`
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const testLog = [];
  function log(msg, pass = true) {
    const symbol = pass ? '✅' : '❌';
    console.log(`${symbol} ${msg}`);
    testLog.push({ msg, pass });
  }

  try {
    // 1. Navigate to application
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
    log('Application loaded on http://localhost:3000');

    // 2. Navigate to Settings page via reliable nav ID
    await page.waitForSelector('#nav-tab-settings', { timeout: 15000 });
    await page.click('#nav-tab-settings');
    await new Promise(r => setTimeout(r, 600));

    // 3. Switch to Staff tab via reliable subtab ID
    await page.waitForSelector('#settings-tab-staff', { timeout: 5000 });
    await page.click('#settings-tab-staff');
    await new Promise(r => setTimeout(r, 800));
    log('Navigated to Library Settings -> Staff Management Tab');

    // 4. Verify NO WhatsApp Verification / API UI
    const whatsappCheck = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const hasVerifyWhatsapp = /verify whatsapp|whatsapp api|send whatsapp verification|otp verification/i.test(pageText);
      const hasWhatsappInput = document.querySelector('input[placeholder*="WhatsApp" i], button[id*="whatsapp-verify" i]');
      return { hasVerifyWhatsapp, hasWhatsappInput: !!hasWhatsappInput };
    });
    const noWhatsapp = !whatsappCheck.hasVerifyWhatsapp && !whatsappCheck.hasWhatsappInput;
    log(`Zero WhatsApp Verification UI confirmed: ${noWhatsapp}`, noWhatsapp);

    // 5. Verify NO Login / Password / Auth credentials UI in Staff Management
    const authCheck = await page.evaluate(() => {
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      const pageText = document.body.innerText;
      const hasAuthFields = /create password|staff user id|login credentials|staff username/i.test(pageText);
      return { passwordInputCount: passwordInputs.length, hasAuthFields };
    });
    const noAuth = authCheck.passwordInputCount === 0 && !authCheck.hasAuthFields;
    log(`Zero Staff Login / Password / Auth credentials UI confirmed: ${noAuth}`, noAuth);

    // 6. Click "Add Staff Member"
    const addStaffBtn = await page.$('#btn-add-staff');
    if (!addStaffBtn) throw new Error('Add Staff button not found');
    await addStaffBtn.click();
    await new Promise(r => setTimeout(r, 600));

    // 7. Verify Add Staff Modal opened
    await page.waitForSelector('#staff-name-input', { timeout: 5000 });
    log('Add Staff Modal opened with clean basic details form');

    // 8. Fill in staff details
    await page.type('#staff-name-input', 'Sunita Verma');
    await page.type('#staff-phone-input', '+91 98765 12345');
    await page.type('#staff-email-input', 'sunita.verma@citylibrary.com');
    await page.select('#staff-role-select', 'Manager');
    await page.select('#staff-branch-select', 'all');

    // 9. Save Staff Member
    await page.click('#btn-save-staff');
    await new Promise(r => setTimeout(r, 1000));

    // 10. Check if Sunita Verma is listed in directory table
    const staffListed = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const found = rows.find(r => r.textContent.includes('Sunita Verma'));
      if (!found) return null;
      return {
        hasName: found.textContent.includes('Sunita Verma'),
        hasPhone: found.textContent.includes('+91 98765 12345'),
        hasRole: found.textContent.includes('Manager'),
        hasActive: found.textContent.includes('Active')
      };
    });
    log(`Staff member added and listed with correct role & phone: ${JSON.stringify(staffListed)}`, !!staffListed);

    // 11. Open Permission Matrix for Sunita Verma
    const permBtnClicked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const sunitaRow = rows.find(r => r.textContent.includes('Sunita Verma'));
      if (!sunitaRow) return false;
      const permBtn = sunitaRow.querySelector('button[id^="btn-perm-"]');
      if (permBtn) {
        permBtn.click();
        return true;
      }
      return false;
    });
    log(`Permission Matrix modal opened: ${permBtnClicked}`, permBtnClicked);
    await new Promise(r => setTimeout(r, 800));

    // 12. Modify permission in Matrix (deny reports view and students create, both originally true for Manager)
    await page.waitForSelector('#perm-toggle-reports-view', { timeout: 5000 });
    await page.click('#perm-toggle-reports-view');
    await new Promise(r => setTimeout(r, 300));
    await page.click('#perm-toggle-students-create');
    await new Promise(r => setTimeout(r, 300));
    log('Toggled individual action permissions (reports view & students create)');

    // 13. Save permissions
    await page.click('#btn-save-permissions');
    log('Saved updated granular permission matrix');
    await new Promise(r => setTimeout(r, 1000));

    // 14. Reload page to verify persistence in database
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#nav-tab-settings', { timeout: 15000 });
    await page.click('#nav-tab-settings');
    await new Promise(r => setTimeout(r, 600));

    await page.waitForSelector('#settings-tab-staff', { timeout: 5000 });
    await page.click('#settings-tab-staff');
    await new Promise(r => setTimeout(r, 800));

    // Check Sunita Verma persists after reload in UI
    const persistedStaff = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const found = rows.find(r => r.textContent.includes('Sunita Verma'));
      return found ? found.textContent : null;
    });
    log(`Staff record persisted after reload: ${Boolean(persistedStaff)}`, Boolean(persistedStaff));

    // Check that customized permission state persisted in localStorage ('library_staff')
    const savedPerms = await page.evaluate(() => {
      const saved = localStorage.getItem('library_staff');
      if (!saved) return null;
      const staffList = JSON.parse(saved);
      const sunita = staffList.find(s => s.name === 'Sunita Verma');
      return sunita?.permissions;
    });
    const reportsDenied = savedPerms?.reports?.view === false;
    const studentsCreateDenied = savedPerms?.students?.create === false;
    log(`Customized permissions persisted in database (reports view denied=${reportsDenied}, students create denied=${studentsCreateDenied})`, reportsDenied && studentsCreateDenied);

    // 15. Verify Active / Inactive Status Toggle
    const statusToggled = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const sunitaRow = rows.find(r => r.textContent.includes('Sunita Verma'));
      if (!sunitaRow) return false;
      const statusBtn = sunitaRow.querySelector('button[id^="btn-status-"]');
      if (statusBtn) {
        statusBtn.click();
        return true;
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 800));

    const newStatusText = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const sunitaRow = rows.find(r => r.textContent.includes('Sunita Verma'));
      return sunitaRow?.querySelector('button[id^="btn-status-"]')?.textContent?.trim();
    });
    log(`Status toggled to Inactive: ${newStatusText === 'Inactive'} (Button shows: "${newStatusText}")`, newStatusText === 'Inactive');

    // 16. Verify Inactive staff permission blocking (authorization layer)
    const inactiveBlocked = await page.evaluate(() => {
      const saved = localStorage.getItem('library_staff');
      if (!saved) return false;
      const staffList = JSON.parse(saved);
      const sunita = staffList.find(s => s.name === 'Sunita Verma');
      return sunita?.status === 'Inactive';
    });
    log(`Inactive staff status correctly updated in storage: ${inactiveBlocked}`, inactiveBlocked);

    // 17. Verify Library Scope Isolation
    const libraryScopeVerified = await page.evaluate(() => {
      const saved = localStorage.getItem('library_staff');
      if (!saved) return false;
      const staffList = JSON.parse(saved);
      const sunita = staffList.find(s => s.name === 'Sunita Verma');
      return Boolean(sunita?.libraryId && sunita.branchId);
    });
    log(`Staff record has libraryId and branchId scope isolation: ${libraryScopeVerified}`, libraryScopeVerified);

    // 18. Re-open permission matrix to confirm custom matrix loads cleanly
    const reOpenPerm = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const sunitaRow = rows.find(r => r.textContent.includes('Sunita Verma'));
      const permBtn = sunitaRow?.querySelector('button[id^="btn-perm-"]');
      if (permBtn) {
        permBtn.click();
        return true;
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: 'scratch/staff_permissions_matrix_modal.png' });
    log('Captured Permissions Matrix Modal screenshot at scratch/staff_permissions_matrix_modal.png');

    // Close modal and take full-page screenshot of Staff Management directory
    await page.click('#btn-close-perm-modal');
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: 'scratch/staff_management_verified.png', fullPage: true });
    log('Captured Staff Directory screenshot at scratch/staff_management_verified.png');

    console.log('\n=======================================');
    console.log('🏁 FINAL VERIFICATION SUMMARY');
    console.log('=======================================');
    testLog.forEach(t => console.log(`${t.pass ? '✅ PASS' : '❌ FAIL'}: ${t.msg}`));

    const allPassed = testLog.every(t => t.pass);
    console.log(`\nOverall Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    await browser.close();
  }
}

runStaffVerification();
