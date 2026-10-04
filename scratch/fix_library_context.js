import fs from 'fs';

const p = '/Users/urshitvadhel/Desktop/Library software/Librarary Management System/src/context/LibraryContext.jsx';
let content = fs.readFileSync(p, 'utf8');

// Find the export const reconcileSeats function
const funcStartStr = 'export const reconcileSeats = ({ savedSeats, students = [], sections = [], seatTypes = [] }) => {';
const startIdx = content.indexOf(funcStartStr);
if (startIdx === -1) {
  console.log('Not found');
  process.exit(1);
}

// Find the end of reconcileSeats
let braceCount = 0;
let endIdx = -1;
let started = false;

for (let i = startIdx; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    started = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (started && braceCount === 0) {
      endIdx = i;
      break;
    }
  }
}

if (endIdx === -1) {
  console.log('End not found');
  process.exit(1);
}

const funcContent = content.substring(startIdx, endIdx + 1) + ';\n';
content = content.substring(0, startIdx) + content.substring(endIdx + 2); // remove it

// Now place it right before export const LibraryProvider
const providerStartStr = 'export const LibraryProvider = ({ children }) => {';
const providerStartIdx = content.indexOf(providerStartStr);

content = content.substring(0, providerStartIdx) + funcContent + '\n' + content.substring(providerStartIdx);

fs.writeFileSync(p, content, 'utf8');
console.log('Fixed export syntax error');
