import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.on('requestfailed', req => {
    console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText);
  });
  page.on('response', res => {
    if (res.status() >= 400) {
      console.log('RESPONSE ERROR:', res.status(), res.url());
    }
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1000));
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log('HTML loaded length:', html.length);
  await browser.close();
}

main().catch(console.error);
