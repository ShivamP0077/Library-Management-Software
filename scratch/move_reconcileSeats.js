import fs from 'fs';

const p = '/Users/urshitvadhel/Desktop/Library software/Librarary Management System/src/context/LibraryContext.jsx';
let content = fs.readFileSync(p, 'utf8');

const funcStart = 'export const reconcileSeats = ({ savedSeats, students = [], sections = [], seatTypes = [] }) => {';
const startIndex = content.indexOf(funcStart);
if (startIndex === -1) {
  console.log('Not found');
  process.exit(1);
}

let braceCount = 0;
let endIndex = -1;
let started = false;

for (let i = startIndex; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    started = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (started && braceCount === 0) {
      endIndex = i;
      break;
    }
  }
}

const funcContent = content.substring(startIndex, endIndex + 1) + ';\n\n';
content = content.substring(0, startIndex) + content.substring(endIndex + 2); // remove from current location

const providerStart = 'export const LibraryProvider = ({ children }) => {';
const providerIndex = content.indexOf(providerStart);

if (providerIndex === -1) {
  console.log('Provider not found');
  process.exit(1);
}

content = content.substring(0, providerIndex) + funcContent + content.substring(providerIndex);

fs.writeFileSync(p, content, 'utf8');
console.log('Moved successfully');
