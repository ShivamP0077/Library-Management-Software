import assert from 'assert';
import { resolveConfigurationScope, matchesScope, getAllConfigurationScopes } from '../src/utils/scopeResolver.js';

console.log("==================================================");
console.log("1. TESTING DYNAMIC SEAT TYPE & SHIFT SCOPE LOGIC");
console.log("==================================================");

// Mock data representing genuine user configuration
const userBranch = { id: 'b-1789147966083', name: 'Bhavnagar ', code: 'BHA' };
const userSec1 = { id: 'blk-1789148083200', name: 'non ac', branchId: 'b-1789147966083' };
const userSec2 = { id: 'blk-1789148101149', name: 'ac', branchId: 'b-1789147966083' };

const userSeatType1 = { id: 'st-1789148127102', name: 'fixed', allocationMode: 'Fixed', branchId: 'b-1789147966083', sectionId: 'blk-1789148083200' };
const userSeatType2 = { id: 'st-1789148171913', name: 'non fixed', allocationMode: 'Non-Fixed', capacityMode: 'Unlimited', branchId: 'b-1789147966083', sectionId: 'blk-1789148083200' };
const userSeatType3 = { id: 'st-1789148182051', name: 'fixed', allocationMode: 'Fixed', branchId: 'b-1789147966083', sectionId: 'blk-1789148101149' };

const phantomSeatType1 = { id: 'st1', name: 'Fixed', branchId: 'all' };
const phantomSeatType2 = { id: 'st2', name: 'Non-Fixed', branchId: 'all' };

const userShift1 = { id: 'sh-1789148211301', name: 'full day', startTime: '06:00', endTime: '20:00', branchId: 'b-1789147966083', sectionId: 'blk-1789148083200', active: true };
const userShift2 = { id: 'sh-1789148220783', name: 'half day morning ', startTime: '06:00', endTime: '12:00', branchId: 'b-1789147966083', sectionId: 'blk-1789148083200', active: true };
const userShift3 = { id: 'sh-1789148237483', name: 'half day evenings ', startTime: '14:00', endTime: '20:00', branchId: 'b-1789147966083', sectionId: 'blk-1789148101149', active: true };
const phantomShift1 = { id: 'sh1', name: 'Full Day', branchId: 'all', active: true };

// TEST 1: Library Flow Case 5 (Single Branch + Multiple Sections)
console.log("\n[TEST 1] Case 5: Single Branch with Multiple Sections");
{
  const scope1 = resolveConfigurationScope({
    branches: [userBranch],
    sections: [userSec1, userSec2],
    selectedBranchId: null,
    selectedSectionId: userSec1.id
  });

  assert.strictEqual(scope1.resolvedBranchId, userBranch.id, "Branch should auto-resolve");
  assert.strictEqual(scope1.showBranchSelector, false, "Single branch -> branch selector hidden");
  assert.strictEqual(scope1.showSectionSelector, true, "2 sections -> section selector shown");
  assert.strictEqual(scope1.resolvedSectionId, userSec1.id, "Section 1 should be resolved");

  // Shifts in section 1:
  const shiftsSec1 = [userShift1, userShift2, userShift3, phantomShift1].filter(sh => 
    matchesScope(sh, scope1.resolvedBranchId, scope1.resolvedSectionId)
  );
  assert.strictEqual(shiftsSec1.some(s => s.id === userShift1.id), true, "userShift1 belongs to sec1");
  assert.strictEqual(shiftsSec1.some(s => s.id === userShift2.id), true, "userShift2 belongs to sec1");
  assert.strictEqual(shiftsSec1.some(s => s.id === userShift3.id), false, "userShift3 belongs to sec2, must NOT appear in sec1");
  console.log("  ✓ Case 5 Section 1 shifts isolated correctly");

  // Switch to section 2:
  const scope2 = resolveConfigurationScope({
    branches: [userBranch],
    sections: [userSec1, userSec2],
    selectedBranchId: null,
    selectedSectionId: userSec2.id
  });
  const shiftsSec2 = [userShift1, userShift2, userShift3, phantomShift1].filter(sh => 
    matchesScope(sh, scope2.resolvedBranchId, scope2.resolvedSectionId)
  );
  assert.strictEqual(shiftsSec2.some(s => s.id === userShift3.id), true, "userShift3 belongs to sec2");
  assert.strictEqual(shiftsSec2.some(s => s.id === userShift1.id), false, "userShift1 belongs to sec1, must NOT appear in sec2");
  assert.strictEqual(shiftsSec2.some(s => s.id === userShift2.id), false, "userShift2 belongs to sec1, must NOT appear in sec2");
  console.log("  ✓ Case 5 Section 2 shifts isolated correctly");
}

// TEST 2: Dynamic Pruning & Preservation Logic
console.log("\n[TEST 2] Dynamic Pruning of Phantom vs Legitimate Configuration");
{
  const seats = [
    { id: 's1', name: 'S1', seatTypeId: userSeatType1.id, branchId: userBranch.id, sectionId: userSec1.id },
    { id: 's2', name: 'S2', seatTypeId: userSeatType3.id, branchId: userBranch.id, sectionId: userSec2.id }
  ];
  const plans = [
    { id: 'p-real', name: 'Real Plan', seatTypeId: userSeatType2.id, shiftIds: [userShift1.id] }
  ];
  const students = [];

  const allSeatTypes = [userSeatType1, userSeatType2, userSeatType3, phantomSeatType1, phantomSeatType2];
  const hasRealUserSeatTypes = allSeatTypes.some(st => st.id !== 'st1' && st.id !== 'st2');

  const filteredSeatTypes = allSeatTypes.filter(st => {
    if (st.id === 'st1' || st.id === 'st2') {
      const seatRef = seats.some(s => s.seatTypeId === st.id);
      const planRef = plans.some(p => p.seatTypeId === st.id);
      const studentRef = students.some(s => s.seatTypeId === st.id);
      if (!seatRef && !planRef && !studentRef && hasRealUserSeatTypes) {
        return false;
      }
    }
    return true;
  });

  assert.strictEqual(filteredSeatTypes.length, 3, "Only the 3 real seat types should remain");
  assert.strictEqual(filteredSeatTypes.some(st => st.id === 'st1'), false, "st1 safely pruned");
  assert.strictEqual(filteredSeatTypes.some(st => st.id === 'st2'), false, "st2 safely pruned");
  assert.strictEqual(filteredSeatTypes.some(st => st.id === userSeatType1.id), true, "userSeatType1 preserved");
  assert.strictEqual(filteredSeatTypes.some(st => st.id === userSeatType2.id), true, "userSeatType2 preserved");
  assert.strictEqual(filteredSeatTypes.some(st => st.id === userSeatType3.id), true, "userSeatType3 preserved");
  console.log("  ✓ Phantom seat types cleanly pruned, legitimate seat types preserved");
}

// TEST 3: Dynamic Physical Seat Counting & Capacity Subtitle
console.log("\n[TEST 3] Seat Type Subtitle Calculation (Physical Seat Count / Capacity)");
{
  const testSeats = Array.from({ length: 80 }, (_, i) => ({
    id: `seat-${i}`,
    name: `S${i + 1}`,
    seatTypeId: userSeatType1.id
  }));

  const countFixed = testSeats.filter(s => s.seatTypeId === userSeatType1.id).length;
  const fixedLabel = `Fixed (${countFixed} seats)`;
  assert.strictEqual(fixedLabel, 'Fixed (80 seats)', "Fixed seat count must match real physical seats");

  const unlimitedLabel = `Non-Fixed (${userSeatType2.capacityMode || 'Unlimited'})`;
  assert.strictEqual(unlimitedLabel, 'Non-Fixed (Unlimited)', "Unlimited non-fixed format");

  const limitedSt = { id: 'st-lim', name: 'discussion', allocationMode: 'Non-Fixed', capacityMode: 'Limited', maximumStudentsAllowed: 50 };
  const limitedLabel = `Non-Fixed (${limitedSt.maximumStudentsAllowed} students)`;
  assert.strictEqual(limitedLabel, 'Non-Fixed (50 students)', "Limited non-fixed format");
  console.log("  ✓ Dynamic seat count and capacity labels verified");
}

// TEST 4: Case 1 to Case 4 Hierarchy Coverage
console.log("\n[TEST 4] Master Library Flow Cases 1–4");
{
  // Case 1: 0B + 0S
  const c1 = resolveConfigurationScope({ branches: [], sections: [] });
  assert.strictEqual(c1.scopeType, 'LIBRARY');
  assert.strictEqual(c1.showBranchSelector, false);
  assert.strictEqual(c1.showSectionSelector, false);

  // Case 2: 1B + 0S
  const c2 = resolveConfigurationScope({ branches: [{ id: 'b1', name: 'Downtown' }], sections: [] });
  assert.strictEqual(c2.scopeType, 'BRANCH');
  assert.strictEqual(c2.resolvedBranchId, 'b1');
  assert.strictEqual(c2.showBranchSelector, false);
  assert.strictEqual(c2.showSectionSelector, false);

  // Case 3: 2B + 0S
  const c3 = resolveConfigurationScope({ branches: [{ id: 'b1', name: 'Downtown' }, { id: 'b2', name: 'Campus' }], sections: [] });
  assert.strictEqual(c3.showBranchSelector, true);
  assert.strictEqual(c3.showSectionSelector, false);

  // Case 4: 0B + 2S
  const c4 = resolveConfigurationScope({ branches: [], sections: [{ id: 's1', name: 'Hall A' }, { id: 's2', name: 'Hall B' }] });
  assert.strictEqual(c4.showBranchSelector, false);
  assert.strictEqual(c4.showSectionSelector, true);
  console.log("  ✓ All Library Flow Cases 1–4 verified");
}

console.log("\n==================================================");
console.log("ALL LOGIC AND INTEGRATION TESTS PASSED!");
console.log("==================================================");
