import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function inspectData() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });

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

  console.log('--- ALL LOCALSTORAGE KEYS ---');
  console.log(Object.keys(storageData));

  for (const k of Object.keys(storageData)) {
    if (k.startsWith('library_') || k.includes('Draft') || k.includes('wizard') || k.includes('setup')) {
      console.log(`\n=== KEY: ${k} ===`);
      console.log(JSON.stringify(storageData[k], null, 2));
    }
  }

  await browser.close();
}

inspectData().catch(console.error);
