import { resolveConfigurationScope, matchesScope, getAllConfigurationScopes } from './src/utils/scopeResolver.js';

console.log('================================================================');
console.log('🧪 MASTER HIERARCHY & SCOPE ALGORITHM VERIFICATION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} - ${details}`);
    throw new Error(`Assertion failed: ${testName} - ${details}`);
  }
}

// ---------------------------------------------------------------------
// TEST SECTION 1: ALL HIERARCHY CASES (CASE A THROUGH CASE H + VARIANTS)
// ---------------------------------------------------------------------

// CASE A: 0 Branch + 0 Section
{
  const res = resolveConfigurationScope({ branches: [], sections: [] });
  assert(res.scopeType === 'LIBRARY', 'CASE A: Scope is LIBRARY');
  assert(res.resolvedBranchId === null, 'CASE A: resolvedBranchId is null');
  assert(res.resolvedSectionId === null, 'CASE A: resolvedSectionId is null');
  assert(!res.showBranchSelector, 'CASE A: Branch selector hidden');
  assert(!res.showSectionSelector, 'CASE A: Section selector hidden');
  assert(res.scopeDisplayName === 'Library', 'CASE A: Label is Library');
}

// CASE B: 0 Branch + 1 Section
{
  const sections = [{ id: 'sec-1', name: 'Open Reading Hall', branchId: null }];
  const res = resolveConfigurationScope({ branches: [], sections });
  assert(res.scopeType === 'SECTION', 'CASE B: Scope is SECTION');
  assert(res.resolvedBranchId === null, 'CASE B: resolvedBranchId is null (No fake branch)');
  assert(res.resolvedSectionId === 'sec-1', 'CASE B: Section is implicit');
  assert(!res.showBranchSelector, 'CASE B: Branch selector hidden');
  assert(!res.showSectionSelector, 'CASE B: Section selector hidden (1 section)');
  assert(res.scopeDisplayName === 'Open Reading Hall', 'CASE B: Label is Section Name');
}

// CASE C: 0 Branch + Multiple Sections
{
  const sections = [
    { id: 'sec-1', name: 'Quiet Room', branchId: null },
    { id: 'sec-2', name: 'Discussion Zone', branchId: null }
  ];
  const res = resolveConfigurationScope({ branches: [], sections, selectedSectionId: 'sec-2' });
  assert(res.scopeType === 'SECTION', 'CASE C: Scope is SECTION');
  assert(res.resolvedBranchId === null, 'CASE C: resolvedBranchId is null (No fake branch)');
  assert(res.resolvedSectionId === 'sec-2', 'CASE C: Selected section resolved');
  assert(!res.showBranchSelector, 'CASE C: Branch selector hidden (0 branches)');
  assert(res.showSectionSelector, 'CASE C: Section selector shown (2+ sections)');
  assert(res.scopeDisplayName === 'Discussion Zone', 'CASE C: Label reflects selected section');
}

// CASE D: 1 Branch + 0 Section
{
  const branches = [{ id: 'b-main', name: 'Main Campus' }];
  const res = resolveConfigurationScope({ branches, sections: [] });
  assert(res.scopeType === 'BRANCH', 'CASE D: Scope is BRANCH');
  assert(res.resolvedBranchId === 'b-main', 'CASE D: Branch is implicit');
  assert(res.resolvedSectionId === null, 'CASE D: resolvedSectionId is null (No fake section)');
  assert(!res.showBranchSelector, 'CASE D: Branch selector hidden (1 branch)');
  assert(!res.showSectionSelector, 'CASE D: Section selector hidden (0 sections)');
  assert(res.scopeDisplayName === 'Main Campus', 'CASE D: Label is Branch Name');
}

// CASE E: 1 Branch + 1 Section
{
  const branches = [{ id: 'b-main', name: 'Main Campus' }];
  const sections = [{ id: 'sec-main-1', name: 'Floor 1 Hall', branchId: 'b-main' }];
  const res = resolveConfigurationScope({ branches, sections });
  assert(res.scopeType === 'SECTION', 'CASE E: Scope is SECTION');
  assert(res.resolvedBranchId === 'b-main', 'CASE E: Branch is implicit');
  assert(res.resolvedSectionId === 'sec-main-1', 'CASE E: Section is implicit');
  assert(!res.showBranchSelector, 'CASE E: Branch selector hidden');
  assert(!res.showSectionSelector, 'CASE E: Section selector hidden');
  assert(res.scopeDisplayName === 'Main Campus → Floor 1 Hall', 'CASE E: Label preserves both IDs');
}

// CASE F: 1 Branch + Multiple Sections
{
  const branches = [{ id: 'b-main', name: 'Main Campus' }];
  const sections = [
    { id: 'sec-a', name: 'AC Hall', branchId: 'b-main' },
    { id: 'sec-b', name: 'Non-AC Hall', branchId: 'b-main' }
  ];
  const res = resolveConfigurationScope({ branches, sections, selectedSectionId: 'sec-b' });
  assert(res.scopeType === 'SECTION', 'CASE F: Scope is SECTION');
  assert(res.resolvedBranchId === 'b-main', 'CASE F: Branch is implicit');
  assert(res.resolvedSectionId === 'sec-b', 'CASE F: Selected section resolved');
  assert(!res.showBranchSelector, 'CASE F: Branch selector hidden (1 branch)');
  assert(res.showSectionSelector, 'CASE F: Section selector shown (2 sections)');
}

// CASE G: Multiple Branches + 0 Sections in Selected Branch
{
  const branches = [
    { id: 'b-north', name: 'North Branch' },
    { id: 'b-south', name: 'South Branch' }
  ];
  const res = resolveConfigurationScope({ branches, sections: [], selectedBranchId: 'b-south' });
  assert(res.scopeType === 'BRANCH', 'CASE G: Scope is BRANCH');
  assert(res.resolvedBranchId === 'b-south', 'CASE G: Selected branch resolved');
  assert(res.resolvedSectionId === null, 'CASE G: resolvedSectionId is null');
  assert(res.showBranchSelector, 'CASE G: Branch selector shown');
  assert(!res.showSectionSelector, 'CASE G: Section selector hidden (0 sections in branch)');
}

// CASE H: Multiple Branches + Sections
{
  const branches = [
    { id: 'b-1', name: 'Branch A' },
    { id: 'b-2', name: 'Branch B' }
  ];
  const sections = [
    { id: 'sec-a1', name: 'Section A1', branchId: 'b-1' },
    { id: 'sec-a2', name: 'Section A2', branchId: 'b-1' },
    { id: 'sec-b1', name: 'Section B1', branchId: 'b-2' },
    { id: 'sec-b2', name: 'Section B2', branchId: 'b-2' }
  ];
  const res = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-1', selectedSectionId: 'sec-a2' });
  assert(res.scopeType === 'SECTION', 'CASE H: Scope is SECTION');
  assert(res.resolvedBranchId === 'b-1', 'CASE H: Branch A resolved');
  assert(res.resolvedSectionId === 'sec-a2', 'CASE H: Section A2 resolved');
  assert(res.availableSections.length === 2, 'CASE H: Only Branch A sections available');
  assert(!res.availableSections.some(s => s.branchId !== 'b-1'), 'CASE H: Zero cross-branch section leakage');
}

// ---------------------------------------------------------------------
// TEST SECTION 2: 4-SCOPE ISOLATION SCENARIO (A1, A2, B1, B2)
// ---------------------------------------------------------------------
console.log('\n--- Running Complete 4-Scope Isolation Test (A1, A2, B1, B2) ---');
{
  const branches = [
    { id: 'b-a', name: 'Branch A' },
    { id: 'b-b', name: 'Branch B' }
  ];
  const sections = [
    { id: 'sec-a1', name: 'Section A1', branchId: 'b-a' },
    { id: 'sec-a2', name: 'Section A2', branchId: 'b-a' },
    { id: 'sec-b1', name: 'Section B1', branchId: 'b-b' },
    { id: 'sec-b2', name: 'Section B2', branchId: 'b-b' }
  ];

  // Intentionally completely different configurations per section:
  // Scope A1: Fixed Desks (1-50), Morning Shift (06-12), Half Day Plan (₹1000)
  // Scope A2: Fixed Desks (1-20), Evening Shift (14-20), Evening Plan (₹1200)
  // Scope B1: Non-Fixed Unlimited, Full Day Shift (06-22), Full Day Plan (₹2000)
  // Scope B2: Non-Fixed Limited (Max 30), Night Shift (20-04), Night Plan (₹1500)
  const seatTypes = [
    { id: 'st-a1', name: 'A1 Fixed Type', allocationMode: 'Fixed', branchId: 'b-a', sectionId: 'sec-a1' },
    { id: 'st-a2', name: 'A2 Fixed Type', allocationMode: 'Fixed', branchId: 'b-a', sectionId: 'sec-a2' },
    { id: 'st-b1', name: 'B1 Flex Unlimited', allocationMode: 'Non-Fixed', capacityMode: 'Unlimited', branchId: 'b-b', sectionId: 'sec-b1' },
    { id: 'st-b2', name: 'B2 Flex Limited', allocationMode: 'Non-Fixed', capacityMode: 'Limited', maximumStudentsAllowed: 30, branchId: 'b-b', sectionId: 'sec-b2' }
  ];

  const seats = [
    { id: 'seat-a1-1', name: '1', seatTypeId: 'st-a1', branchId: 'b-a', sectionId: 'sec-a1' },
    { id: 'seat-a1-2', name: '2', seatTypeId: 'st-a1', branchId: 'b-a', sectionId: 'sec-a1' },
    { id: 'seat-a2-1', name: '1', seatTypeId: 'st-a2', branchId: 'b-a', sectionId: 'sec-a2' }, // Desk '1' in A2!
    { id: 'seat-a2-2', name: '2', seatTypeId: 'st-a2', branchId: 'b-a', sectionId: 'sec-a2' }  // Desk '2' in A2!
  ];

  const shifts = [
    { id: 'sh-a1', name: 'A1 Morning', startTime: '06:00', endTime: '12:00', branchId: 'b-a', sectionId: 'sec-a1' },
    { id: 'sh-a2', name: 'A2 Evening', startTime: '14:00', endTime: '20:00', branchId: 'b-a', sectionId: 'sec-a2' },
    { id: 'sh-b1', name: 'B1 Full Day', startTime: '06:00', endTime: '22:00', branchId: 'b-b', sectionId: 'sec-b1' },
    { id: 'sh-b2', name: 'B2 Night Shift', startTime: '20:00', endTime: '04:00', branchId: 'b-b', sectionId: 'sec-b2' }
  ];

  const plans = [
    { id: 'pl-a1', name: 'A1 Plan', seatTypeId: 'st-a1', shiftIds: ['sh-a1'], branchId: 'b-a', sectionId: 'sec-a1' },
    { id: 'pl-a2', name: 'A2 Plan', seatTypeId: 'st-a2', shiftIds: ['sh-a2'], branchId: 'b-a', sectionId: 'sec-a2' },
    { id: 'pl-b1', name: 'B1 Plan', seatTypeId: 'st-b1', shiftIds: ['sh-b1'], branchId: 'b-b', sectionId: 'sec-b1' },
    { id: 'pl-b2', name: 'B2 Plan', seatTypeId: 'st-b2', shiftIds: ['sh-b2'], branchId: 'b-b', sectionId: 'sec-b2' }
  ];

  // Test Scope A1
  const scopeA1 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-a', selectedSectionId: 'sec-a1' });
  const a1_st = seatTypes.filter(st => matchesScope(st, scopeA1.resolvedBranchId, scopeA1.resolvedSectionId));
  const a1_seats = seats.filter(s => matchesScope(s, scopeA1.resolvedBranchId, scopeA1.resolvedSectionId));
  const a1_shifts = shifts.filter(sh => matchesScope(sh, scopeA1.resolvedBranchId, scopeA1.resolvedSectionId));
  const a1_plans = plans.filter(p => matchesScope(p, scopeA1.resolvedBranchId, scopeA1.resolvedSectionId));

  assert(a1_st.length === 1 && a1_st[0].id === 'st-a1', 'Isolation: A1 has only A1 Seat Types');
  assert(a1_seats.length === 2 && a1_seats[0].name === '1', 'Isolation: A1 has only A1 Seats');
  assert(a1_shifts.length === 1 && a1_shifts[0].id === 'sh-a1', 'Isolation: A1 has only A1 Shifts');
  assert(a1_plans.length === 1 && a1_plans[0].id === 'pl-a1', 'Isolation: A1 has only A1 Plans');

  // Test Scope A2
  const scopeA2 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-a', selectedSectionId: 'sec-a2' });
  const a2_st = seatTypes.filter(st => matchesScope(st, scopeA2.resolvedBranchId, scopeA2.resolvedSectionId));
  const a2_seats = seats.filter(s => matchesScope(s, scopeA2.resolvedBranchId, scopeA2.resolvedSectionId));
  const a2_shifts = shifts.filter(sh => matchesScope(sh, scopeA2.resolvedBranchId, scopeA2.resolvedSectionId));
  const a2_plans = plans.filter(p => matchesScope(p, scopeA2.resolvedBranchId, scopeA2.resolvedSectionId));

  assert(a2_st.length === 1 && a2_st[0].id === 'st-a2', 'Isolation: A2 has only A2 Seat Types');
  assert(a2_seats.length === 2 && a2_seats[0].name === '1', 'Isolation: A2 Seat 1 exists independently from A1 Seat 1');
  assert(a2_shifts.length === 1 && a2_shifts[0].id === 'sh-a2', 'Isolation: A2 has only A2 Shifts');
  assert(a2_plans.length === 1 && a2_plans[0].id === 'pl-a2', 'Isolation: A2 has only A2 Plans');

  // Test Scope B1
  const scopeB1 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-b', selectedSectionId: 'sec-b1' });
  const b1_st = seatTypes.filter(st => matchesScope(st, scopeB1.resolvedBranchId, scopeB1.resolvedSectionId));
  const b1_seats = seats.filter(s => matchesScope(s, scopeB1.resolvedBranchId, scopeB1.resolvedSectionId));
  const b1_shifts = shifts.filter(sh => matchesScope(sh, scopeB1.resolvedBranchId, scopeB1.resolvedSectionId));
  const b1_plans = plans.filter(p => matchesScope(p, scopeB1.resolvedBranchId, scopeB1.resolvedSectionId));

  assert(b1_st.length === 1 && b1_st[0].allocationMode === 'Non-Fixed', 'Isolation: B1 has Non-Fixed Unlimited');
  assert(b1_seats.length === 0, 'Isolation: B1 has 0 physical seats (Non-Fixed)');
  assert(b1_shifts.length === 1 && b1_shifts[0].id === 'sh-b1', 'Isolation: B1 has only B1 Shifts');
  assert(b1_plans.length === 1 && b1_plans[0].id === 'pl-b1', 'Isolation: B1 has only B1 Plans');

  // Test Scope B2
  const scopeB2 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-b', selectedSectionId: 'sec-b2' });
  const b2_st = seatTypes.filter(st => matchesScope(st, scopeB2.resolvedBranchId, scopeB2.resolvedSectionId));
  const b2_seats = seats.filter(s => matchesScope(s, scopeB2.resolvedBranchId, scopeB2.resolvedSectionId));
  const b2_shifts = shifts.filter(sh => matchesScope(sh, scopeB2.resolvedBranchId, scopeB2.resolvedSectionId));
  const b2_plans = plans.filter(p => matchesScope(p, scopeB2.resolvedBranchId, scopeB2.resolvedSectionId));

  assert(b2_st.length === 1 && b2_st[0].maximumStudentsAllowed === 30, 'Isolation: B2 has Non-Fixed Limited (30)');
  assert(b2_seats.length === 0, 'Isolation: B2 has 0 physical seats');
  assert(b2_shifts.length === 1 && b2_shifts[0].id === 'sh-b2', 'Isolation: B2 has only B2 Shifts');
  assert(b2_plans.length === 1 && b2_plans[0].id === 'pl-b2', 'Isolation: B2 has only B2 Plans');

  // Test exhaustive getAllConfigurationScopes
  const allScopes = getAllConfigurationScopes(branches, sections);
  assert(allScopes.length === 4, 'getAllConfigurationScopes returns exactly 4 scopes for 2x2 hierarchy');
}

console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED CLEANLY!`);
