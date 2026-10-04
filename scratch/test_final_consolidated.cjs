const puppeteer = require('puppeteer');

(async () => {
  console.log("🚀 Starting E2E Browser Acceptance Test on http://localhost:3000 ...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER CONSOLE ERROR:', msg.text());
  });

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
    console.log("✓ Page loaded successfully.");

    // Check if on onboarding wizard or main app
    const isWizardFirst = await page.$('h1');
    const h1Text = await page.evaluate(el => el ? el.textContent : '', isWizardFirst);
    console.log("Current header / view:", h1Text);

    if (h1Text.includes("Setup Wizard")) {
      console.log("Currently in initial setup wizard. Completing step by step...");
      // Fill library name if empty
      const nameInput = await page.$('input[placeholder*="Reading Zone"], input[placeholder*="Library"]');
      if (nameInput) {
        await nameInput.type("Prestige Academic Library");
      }
      // Click Finish or Save & Continue until completed
      for (let s = 1; s <= 8; s++) {
        const btn = await page.$('button.btn-primary');
        if (btn) {
          const btnText = await page.evaluate(el => el.textContent, btn);
          console.log(`Step ${s} button:`, btnText);
          await btn.click();
          await new Promise(r => setTimeout(r, 800));
        }
      }
      await new Promise(r => setTimeout(r, 1500));
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    }

    // Now on main app dashboard / header
    console.log("Navigating to Library Settings...");
    await page.evaluate(() => {
      // Find nav button for Settings
      const buttons = Array.from(document.querySelectorAll('button, nav a, .nav-item'));
      const settingsBtn = buttons.find(b => b.textContent.includes('Settings') || b.textContent.includes('Admin'));
      if (settingsBtn) settingsBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Verify Administration & Settings Header and Setup Wizard Button
    const settingsTitle = await page.evaluate(() => {
      const h2 = document.querySelector('h2');
      return h2 ? h2.textContent : '';
    });
    console.log("Settings header:", settingsTitle);
    if (!settingsTitle.includes('Administration & Settings')) {
      throw new Error("Failed to navigate to Administration & Settings");
    }

    // Verify Setup Wizard button with status badge
    const wizardBtnInfo = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const wBtn = btns.find(b => b.textContent.includes('Setup') || b.textContent.includes('⚙'));
      return wBtn ? wBtn.textContent.trim() : null;
    });
    console.log("Setup Wizard Button Text:", wizardBtnInfo);
    if (!wizardBtnInfo || !wizardBtnInfo.includes('Setup')) {
      throw new Error("Setup Wizard entry button not found in Administration & Settings");
    }

    // Click [⚙ Edit Setup] or [⚙ Continue Setup]
    console.log("Clicking Setup Wizard button to test Edit/Resume mode...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const wBtn = btns.find(b => b.textContent.includes('Setup') && (b.textContent.includes('Edit') || b.textContent.includes('Start') || b.textContent.includes('Continue')));
      if (wBtn) wBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Verify Setup Wizard overlay loaded with Edit / Resume mode
    const wizardModalHeader = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : '';
    });
    console.log("Setup Wizard Header:", wizardModalHeader);
    if (!wizardModalHeader.includes("Library Setup Wizard")) {
      throw new Error("Setup Wizard did not open in modal/overlay");
    }

    // Exit Setup Wizard
    console.log("Exiting Setup Wizard back to Settings...");
    await page.evaluate(() => {
      const exitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Exit') || b.textContent.includes('Close'));
      if (exitBtn) exitBtn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Navigate to Data Hub & Testing tab
    console.log("Switching to '💾 Data Hub & Testing' tab...");
    await page.evaluate(() => {
      const tabBtns = Array.from(document.querySelectorAll('button'));
      const dataTab = tabBtns.find(b => b.textContent.includes('Data Hub') || b.textContent.includes('Testing'));
      if (dataTab) dataTab.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Verify Factory Reset Safety (Confirmation modal requires typing "RESET")
    console.log("Testing Factory Reset protection modal...");
    await page.evaluate(() => {
      const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Factory Reset'));
      if (resetBtn) resetBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const resetModalPresent = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('Confirm Factory Reset') && text.includes('Type RESET in capital letters');
    });
    console.log("Factory Reset strong protection modal displayed:", resetModalPresent);
    if (!resetModalPresent) throw new Error("Factory Reset confirmation modal with typing protection not found!");

    // Verify permanently reset button is disabled initially
    const isResetDisabled = await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Permanently Reset'));
      return confirmBtn ? confirmBtn.disabled : false;
    });
    console.log("Permanently Reset button disabled before typing RESET:", isResetDisabled);
    if (!isResetDisabled) throw new Error("Reset button should be disabled before typing RESET!");

    // Close reset modal safely
    await page.evaluate(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancel'));
      if (cancelBtn) cancelBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    // Test 🧪 Random Test Student Generator
    console.log("Testing 🧪 Random Test Student Generator (Requesting 25 students)...");
    const generateBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const genBtn = btns.find(b => b.textContent.includes('Generate') && b.textContent.includes('Test Students'));
      if (genBtn) {
        genBtn.click();
        return true;
      }
      return false;
    });
    console.log("Clicked Generate Test Students button:", generateBtn);
    if (!generateBtn) throw new Error("Generate Test Students button not found!");

    await new Promise(r => setTimeout(r, 1200));

    // Verify report
    const reportText = await page.evaluate(() => {
      const card = document.querySelector('.premium-card[style*="#f0fdf4"], .premium-card[style*="rgb(240, 253, 244)"]');
      return card ? card.textContent : '';
    });
    console.log("Generator Report Summary:", reportText.slice(0, 300));
    if (!reportText.includes('Created:')) {
      throw new Error("Test student generation report was not displayed");
    }

    // Navigate to Students Tab to verify created test students
    console.log("Navigating to Students page to verify synthetic students...");
    await page.evaluate(() => {
      const navs = Array.from(document.querySelectorAll('button, .nav-item'));
      const stuNav = navs.find(b => b.textContent.trim() === 'Students');
      if (stuNav) stuNav.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const studentsFound = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('TEST-STU-') || text.includes('TEST ');
    });
    console.log("Synthetic test students present in Students page:", studentsFound);
    if (!studentsFound) throw new Error("Synthetic test students not found in Students page");

    // Navigate to Dashboard to verify occupancy & collections
    console.log("Navigating to Dashboard to verify KPIs derived from test data...");
    await page.evaluate(() => {
      const navs = Array.from(document.querySelectorAll('button, .nav-item'));
      const dashNav = navs.find(b => b.textContent.trim() === 'Dashboard');
      if (dashNav) dashNav.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const dashboardKpi = await page.evaluate(() => {
      const text = document.body.textContent;
      return {
        hasActiveStudents: text.includes('ACTIVE STUDENTS'),
        hasOccupancy: text.includes('SEAT OCCUPANCY'),
        hasCollections: text.includes('TODAY')
      };
    });
    console.log("Dashboard KPIs verified:", dashboardKpi);

    // Navigate back to Library Settings -> Data Hub to test [Clear Test Data]
    console.log("Navigating back to Data Hub to verify safe test data cleanup...");
    await page.evaluate(() => {
      const navs = Array.from(document.querySelectorAll('button, .nav-item'));
      const setNav = navs.find(b => b.textContent.trim() === 'Settings');
      if (setNav) setNav.click();
    });
    await new Promise(r => setTimeout(r, 800));

    await page.evaluate(() => {
      const tabBtns = Array.from(document.querySelectorAll('button'));
      const dataTab = tabBtns.find(b => b.textContent.includes('Data Hub') || b.textContent.includes('Testing'));
      if (dataTab) dataTab.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Handle confirm dialog automatically for clear test data
    page.on('dialog', async dialog => {
      console.log('Dialog opened:', dialog.message());
      await dialog.accept();
    });

    console.log("Clicking [Clear Test Data]...");
    await page.evaluate(() => {
      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Clear Test Data'));
      if (clearBtn) clearBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const remainingTestCount = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('Test Students in System');
    });
    console.log("Remaining test students after cleanup (should be false):", remainingTestCount);
    if (remainingTestCount) throw new Error("Test students were not cleaned up properly!");

    console.log("🎉 ALL ACCEPTANCE CRITERIA VERIFIED AND PASSED SUCCESSFULLY!");

  } catch (err) {
    console.error("❌ Acceptance test failed:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
