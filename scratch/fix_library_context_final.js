import fs from 'fs';

const p = '/Users/urshitvadhel/Desktop/Library software/Librarary Management System/src/context/LibraryContext.jsx';
const content = fs.readFileSync(p, 'utf8');
const lines = content.split('\n');

// The block to extract is from line 406 (index 405) to line 458 (index 457)
// But wait, the file might have shifted slightly, let's find it by content
let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '=> {') {
    startIndex = i;
  }
  if (startIndex !== -1 && lines[i].trim() === '};' && i > startIndex) {
    // verify this is the end of reconcileSeats by checking if dedupedSeats is returned
    if (lines[i-1].includes('return dedupedSeats.length > 0')) {
      endIndex = i;
      break;
    }
  }
}

if (startIndex === -1 || endIndex === -1) {
  console.log('Could not find block');
  process.exit(1);
}

const extractedLines = lines.slice(startIndex, endIndex + 1);
// Replace the first line '=> {' with the full signature
extractedLines[0] = 'export const reconcileSeats = ({ savedSeats, students = [], sections = [], seatTypes = [] }) => {';

// Remove the block from the original location
lines.splice(startIndex, endIndex - startIndex + 1);

// Find LibraryProvider
let providerIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('export const LibraryProvider = ({ children }) => {')) {
    providerIndex = i;
    break;
  }
}

if (providerIndex === -1) {
  console.log('Provider not found');
  process.exit(1);
}

// Insert the extracted block before LibraryProvider
lines.splice(providerIndex, 0, ...extractedLines, '');

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('Fixed successfully');
