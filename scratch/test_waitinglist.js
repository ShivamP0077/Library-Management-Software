import fs from 'fs';
import path from 'path';

// Read the code of LibraryContext
const code = fs.readFileSync(path.resolve('./src/context/LibraryContext.jsx'), 'utf-8');

// Extract updateWaitingListStatus
const match = code.match(/const updateWaitingListStatus = \(entryId, newStatus, additionalData = \{\}\) => \{([\s\S]*?)\};/);
if (!match) throw new Error("updateWaitingListStatus not found");

// Mock state setter
let waitingListState = [
  { id: 'w1', status: 'WAITING', branchId: 'b1', planId: 'p1' }
];

const setWaitingList = (callback) => {
  waitingListState = callback(waitingListState);
};

const fnBody = match[1];
// The function uses setWaitingList and new Date().toISOString()
const updateWaitingListStatus = new Function('entryId', 'newStatus', 'additionalData', `
  ${fnBody}
`);

console.log("=== WAITING LIST STATUS TEST ===");
updateWaitingListStatus('w1', 'OFFERED', { someExtra: 'data' });
const updated1 = waitingListState[0];
console.log(`[TEST 1] OFFERED -> Status: ${updated1.status}, hasOfferedDate: ${!!updated1.offeredDate}, hasLastChange: ${!!updated1.lastStatusChangeDate}`);
if (updated1.status === 'OFFERED' && updated1.offeredDate && updated1.lastStatusChangeDate) console.log("[PASS] OFFERED");
else console.log("[FAIL] OFFERED");

updateWaitingListStatus('w1', 'ADMITTED');
const updated2 = waitingListState[0];
console.log(`[TEST 2] ADMITTED -> Status: ${updated2.status}, hasAdmittedDate: ${!!updated2.admittedDate}, Original Branch: ${updated2.branchId}`);
if (updated2.status === 'ADMITTED' && updated2.admittedDate && updated2.branchId === 'b1') console.log("[PASS] ADMITTED");
else console.log("[FAIL] ADMITTED");

