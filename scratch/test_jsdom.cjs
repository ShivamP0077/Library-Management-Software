const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '../dist/index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000',
  runScripts: 'dangerously',
  resources: 'usable',
});

dom.window.console.log = (...args) => console.log('LOG:', ...args);
dom.window.console.error = (...args) => console.error('ERROR:', ...args);
dom.window.console.warn = (...args) => console.warn('WARN:', ...args);
dom.window.addEventListener('error', (event) => {
  console.error('UNCAUGHT ERROR:', event.error);
});
dom.window.addEventListener('unhandledrejection', (event) => {
  console.error('UNHANDLED REJECTION:', event.reason);
});

setTimeout(() => {
  console.log('Finished testing.');
}, 2000);
