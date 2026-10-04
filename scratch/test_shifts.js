import fs from 'fs';
import path from 'path';

// Read the code of LibraryContext to extract shiftsOverlap
const code = fs.readFileSync(path.resolve('./src/context/LibraryContext.jsx'), 'utf-8');

// Extract shiftsOverlap
const match = code.match(/export const shiftsOverlap = \(shA, shB\) => \{([\s\S]*?)\};/);
if (!match) throw new Error("shiftsOverlap not found");

const fnBody = match[1];
const shiftsOverlap = new Function('shA', 'shB', fnBody);

console.log("=== SHIFT OVERLAP TEST ===");
let passed = 0, failed = 0;
const runTest = (name, shA, shB, expected) => {
  try {
    const res = shiftsOverlap(shA, shB);
    if (res === expected) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.log(`[FAIL] ${name} | expected ${expected}, got ${res}`);
      failed++;
    }
  } catch (e) {
    console.log(`[ERROR] ${name} | ${e.message}`);
    failed++;
  }
};

const fullDay = { id: 'sh1', name: 'Full Day', startTime: '08:00', endTime: '19:00' };
const morning = { id: 'sh2', name: 'Morning', startTime: '08:00', endTime: '13:00' };
const evening = { id: 'sh3', name: 'Evening', startTime: '14:00', endTime: '19:00' };
const missingTime = { id: 'sh4', name: 'Legacy' };
const morningMissingTime = { id: 'sh5', name: 'Morning' };

runTest("Same Desk + Overlapping Morning (Full Day vs Morning)", fullDay, morning, true);
runTest("Morning vs Evening (Non-overlapping)", morning, evening, false);
runTest("Different Shift Names with Missing Time (Fail-Safe Block)", morningMissingTime, fullDay, true);
runTest("Missing vs Missing (Fail-Safe Block)", missingTime, morningMissingTime, true);

console.log(`Results: ${passed} passed, ${failed} failed`);
