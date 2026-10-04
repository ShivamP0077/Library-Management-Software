import assert from 'assert';
import { resolveConfigurationScope, matchesScope, getAllConfigurationScopes } from '../src/utils/scopeResolver.js';

console.log("==================================================");
console.log("RUNNING MASTER HIERARCHY & SCOPE E2E TEST SUITE");
console.log("==================================================");

const results = {};

// Helper reporter
function testCase(id, name, fn) {
  try {
    fn();
    results[id] = { name, status: 'PASS', error: null };
    console.log(`[PASS] ${id}: ${name}`);
  } catch (err) {
    results[id] = { name, status: 'FAIL', error: err.message };
    console.error(`[FAIL] ${id}: ${name} -> ${err.message}`);
  }
}

// TC-H01: 0B / 0S
testCase('TC-H01', '0B / 0S -> Library level, no fake branch or section, branchId=null, sectionId=null', () => {
  const scope = resolveConfigurationScope({ branches: [], sections: [] });
  assert.strictEqual(scope.scopeType, 'LIBRARY');
  assert.strictEqual(scope.resolvedBranchId, null);
  assert.strictEqual(scope.resolvedSectionId, null);
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, false);
  assert.strictEqual(scope.scopeDisplayName, 'Library');

  const item = { id: 'st-lib', name: 'Lib Item', branchId: undefined, sectionId: undefined };
  assert.strictEqual(matchesScope(item, scope.resolvedBranchId, scope.resolvedSectionId), true);
  
  const branchItem = { id: 'st-br', name: 'Branch Item', branchId: 'b-fake' };
  assert.strictEqual(matchesScope(branchItem, scope.resolvedBranchId, scope.resolvedSectionId), false);
});

// TC-H02: 0B / 1S
testCase('TC-H02', '0B / 1S -> Implicit section, section selector hidden, sectionId retained', () => {
  const sections = [{ id: 'sec-main', name: 'Main Hall', branchId: undefined }];
  const scope = resolveConfigurationScope({ branches: [], sections });
  assert.strictEqual(scope.scopeType, 'SECTION');
  assert.strictEqual(scope.resolvedBranchId, null);
  assert.strictEqual(scope.resolvedSectionId, 'sec-main');
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, false, 'Selector must be hidden for 1 section');
  assert.strictEqual(scope.scopeDisplayName, 'Main Hall');

  const secItem = { id: 'sh-1', sectionId: 'sec-main' };
  assert.strictEqual(matchesScope(secItem, scope.resolvedBranchId, scope.resolvedSectionId), true);
  const otherSecItem = { id: 'sh-2', sectionId: 'sec-other' };
  assert.strictEqual(matchesScope(otherSecItem, scope.resolvedBranchId, scope.resolvedSectionId), false);
});

// TC-H03: 0B / 2S+
testCase('TC-H03', '0B / 2S+ -> Direct library sections, section selector visible, independent scopes', () => {
  const sections = [
    { id: 'sec-a', name: 'Hall Alpha' },
    { id: 'sec-b', name: 'Hall Beta' }
  ];
  const scopeA = resolveConfigurationScope({ branches: [], sections, selectedSectionId: 'sec-a' });
  assert.strictEqual(scopeA.showBranchSelector, false);
  assert.strictEqual(scopeA.showSectionSelector, true);
  assert.strictEqual(scopeA.resolvedSectionId, 'sec-a');

  const scopeB = resolveConfigurationScope({ branches: [], sections, selectedSectionId: 'sec-b' });
  assert.strictEqual(scopeB.resolvedSectionId, 'sec-b');
  assert.strictEqual(scopeB.showSectionSelector, true);

  const itemA = { id: 'pl-a', sectionId: 'sec-a' };
  const itemB = { id: 'pl-b', sectionId: 'sec-b' };
  assert.strictEqual(matchesScope(itemA, scopeA.resolvedBranchId, scopeA.resolvedSectionId), true);
  assert.strictEqual(matchesScope(itemB, scopeA.resolvedBranchId, scopeA.resolvedSectionId), false);
  assert.strictEqual(matchesScope(itemA, scopeB.resolvedBranchId, scopeB.resolvedSectionId), false);
  assert.strictEqual(matchesScope(itemB, scopeB.resolvedBranchId, scopeB.resolvedSectionId), true);
});

// TC-H04: 1B / 0S
testCase('TC-H04', '1B / 0S -> Implicit branch, branch selector hidden, section selector hidden, branchId retained, sectionId=null', () => {
  const branches = [{ id: 'b-central', name: 'Central Campus' }];
  const scope = resolveConfigurationScope({ branches, sections: [] });
  assert.strictEqual(scope.scopeType, 'BRANCH');
  assert.strictEqual(scope.resolvedBranchId, 'b-central');
  assert.strictEqual(scope.resolvedSectionId, null);
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, false);
  assert.strictEqual(scope.scopeDisplayName, 'Central Campus');

  const item = { id: 'sh-1', branchId: 'b-central' };
  assert.strictEqual(matchesScope(item, scope.resolvedBranchId, scope.resolvedSectionId), true);
  const secLeakedItem = { id: 'sh-leak', branchId: 'b-central', sectionId: 'sec-foreign' };
  assert.strictEqual(matchesScope(secLeakedItem, scope.resolvedBranchId, scope.resolvedSectionId), false);
});

// TC-H05: 1B / 1S
testCase('TC-H05', '1B / 1S -> Implicit branch & implicit section, both selectors hidden, both IDs retained', () => {
  const branches = [{ id: 'b-central', name: 'Central Campus' }];
  const sections = [{ id: 'sec-floor1', name: 'Floor 1', branchId: 'b-central' }];
  const scope = resolveConfigurationScope({ branches, sections });
  assert.strictEqual(scope.scopeType, 'SECTION');
  assert.strictEqual(scope.resolvedBranchId, 'b-central');
  assert.strictEqual(scope.resolvedSectionId, 'sec-floor1');
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, false);
  assert.strictEqual(scope.scopeDisplayName, 'Central Campus → Floor 1');
});

// TC-H06: 1B / 2S+
testCase('TC-H06', '1B / 2S+ -> Implicit branch (selector hidden), section selector visible, filtered to branch', () => {
  const branches = [{ id: 'b-central', name: 'Central Campus' }];
  const sections = [
    { id: 'sec-f1', name: 'Floor 1', branchId: 'b-central' },
    { id: 'sec-f2', name: 'Floor 2', branchId: 'b-central' }
  ];
  const scope = resolveConfigurationScope({ branches, sections, selectedSectionId: 'sec-f2' });
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, true);
  assert.strictEqual(scope.availableSections.length, 2);
  assert.strictEqual(scope.resolvedSectionId, 'sec-f2');
});

// TC-H07: 2B / 0S in selected branch
testCase('TC-H07', '2B / 0S -> Branch selector visible, section selector hidden, no fake section', () => {
  const branches = [
    { id: 'b-north', name: 'North Branch' },
    { id: 'b-south', name: 'South Branch' }
  ];
  const sections = [
    { id: 'sec-s1', name: 'South Hall', branchId: 'b-south' }
  ];
  // Select North which has 0 sections
  const scope = resolveConfigurationScope({ branches, sections, selectedBranchId: 'b-north' });
  assert.strictEqual(scope.scopeType, 'BRANCH');
  assert.strictEqual(scope.resolvedBranchId, 'b-north');
  assert.strictEqual(scope.resolvedSectionId, null);
  assert.strictEqual(scope.showBranchSelector, true);
  assert.strictEqual(scope.showSectionSelector, false);
  assert.strictEqual(scope.availableSections.length, 0);
  assert.strictEqual(scope.scopeDisplayName, 'North Branch');
});

// TC-H08: 2B / 2S+ with Branch A (A1, A2) and Branch B (B1, B2)
testCase('TC-H08', '2B / 2S+ -> Branch A (A1, A2) & Branch B (B1, B2) - Strict section isolation', () => {
  const branches = [
    { id: 'bA', name: 'Branch A' },
    { id: 'bB', name: 'Branch B' }
  ];
  const sections = [
    { id: 'A1', name: 'Section A1', branchId: 'bA' },
    { id: 'A2', name: 'Section A2', branchId: 'bA' },
    { id: 'B1', name: 'Section B1', branchId: 'bB' },
    { id: 'B2', name: 'Section B2', branchId: 'bB' }
  ];

  // Scope A1
  const scopeA1 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'bA', selectedSectionId: 'A1' });
  assert.strictEqual(scopeA1.resolvedBranchId, 'bA');
  assert.strictEqual(scopeA1.resolvedSectionId, 'A1');
  assert.deepStrictEqual(scopeA1.availableSections.map(s => s.id), ['A1', 'A2'], 'Branch A must see A1 and A2 only!');

  // Scope B2
  const scopeB2 = resolveConfigurationScope({ branches, sections, selectedBranchId: 'bB', selectedSectionId: 'B2' });
  assert.strictEqual(scopeB2.resolvedBranchId, 'bB');
  assert.strictEqual(scopeB2.resolvedSectionId, 'B2');
  assert.deepStrictEqual(scopeB2.availableSections.map(s => s.id), ['B1', 'B2'], 'Branch B must see B1 and B2 only!');
});

// TC-H09: Branch Isolation
testCase('TC-H09', 'Branch Isolation -> Branch A records never match Branch B scope', () => {
  const itemA = { id: 'st-a', branchId: 'bA', sectionId: 'A1' };
  assert.strictEqual(matchesScope(itemA, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(itemA, 'bB', 'B1'), false);
  assert.strictEqual(matchesScope(itemA, 'bB', 'B2'), false);
});

// TC-H10: Section downstream configuration isolation
testCase('TC-H10', 'Section downstream isolation -> A1 never sees A2, B1, B2 configuration', () => {
  const a1Config = { id: 'st-a1', branchId: 'bA', sectionId: 'A1' };
  const a2Config = { id: 'st-a2', branchId: 'bA', sectionId: 'A2' };
  const b1Config = { id: 'st-b1', branchId: 'bB', sectionId: 'B1' };
  const b2Config = { id: 'st-b2', branchId: 'bB', sectionId: 'B2' };

  // Testing A1
  assert.strictEqual(matchesScope(a1Config, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(a2Config, 'bA', 'A1'), false);
  assert.strictEqual(matchesScope(b1Config, 'bA', 'A1'), false);
  assert.strictEqual(matchesScope(b2Config, 'bA', 'A1'), false);

  // Testing A2
  assert.strictEqual(matchesScope(a1Config, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(a2Config, 'bA', 'A2'), true);
  assert.strictEqual(matchesScope(b1Config, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(b2Config, 'bA', 'A2'), false);

  // Testing B1
  assert.strictEqual(matchesScope(a1Config, 'bB', 'B1'), false);
  assert.strictEqual(matchesScope(a2Config, 'bB', 'B1'), false);
  assert.strictEqual(matchesScope(b1Config, 'bB', 'B1'), true);
  assert.strictEqual(matchesScope(b2Config, 'bB', 'B1'), false);

  // Testing B2
  assert.strictEqual(matchesScope(a1Config, 'bB', 'B2'), false);
  assert.strictEqual(matchesScope(a2Config, 'bB', 'B2'), false);
  assert.strictEqual(matchesScope(b1Config, 'bB', 'B2'), false);
  assert.strictEqual(matchesScope(b2Config, 'bB', 'B2'), true);
});

// TC-H11: Branch switch clears/re-resolves Section
testCase('TC-H11', 'Branch switch clears/re-resolves Section -> Stale section A1 cannot leak to Branch B', () => {
  const branches = [{ id: 'bA', name: 'A' }, { id: 'bB', name: 'B' }];
  const sections = [
    { id: 'A1', branchId: 'bA' },
    { id: 'B1', branchId: 'bB' }
  ];
  // User had A1 selected in Branch A, now changes branch to bB but passed old selectedSectionId 'A1'
  const scope = resolveConfigurationScope({ branches, sections, selectedBranchId: 'bB', selectedSectionId: 'A1' });
  assert.strictEqual(scope.resolvedBranchId, 'bB');
  assert.strictEqual(scope.resolvedSectionId, 'B1', 'A1 is invalid in Branch B; must re-resolve to B1!');
});

// TC-H12: Progressive selector visibility
testCase('TC-H12', 'Progressive selector visibility -> 0=none, 1=auto-resolve/hide, 2+=visible', () => {
  // 0 branches -> showBranchSelector=false
  assert.strictEqual(resolveConfigurationScope({ branches: [], sections: [] }).showBranchSelector, false);
  // 1 branch -> showBranchSelector=false
  assert.strictEqual(resolveConfigurationScope({ branches: [{ id: 'b1' }], sections: [] }).showBranchSelector, false);
  // 2 branches -> showBranchSelector=true
  assert.strictEqual(resolveConfigurationScope({ branches: [{ id: 'b1' }, { id: 'b2' }], sections: [] }).showBranchSelector, true);

  // 0 sections in branch -> showSectionSelector=false
  assert.strictEqual(resolveConfigurationScope({ branches: [{ id: 'b1' }], sections: [] }).showSectionSelector, false);
  // 1 section in branch -> showSectionSelector=false
  assert.strictEqual(resolveConfigurationScope({ branches: [{ id: 'b1' }], sections: [{ id: 's1', branchId: 'b1' }] }).showSectionSelector, false);
  // 2 sections in branch -> showSectionSelector=true
  assert.strictEqual(resolveConfigurationScope({ branches: [{ id: 'b1' }], sections: [{ id: 's1', branchId: 'b1' }, { id: 's2', branchId: 'b1' }] }).showSectionSelector, true);
});

// TC-H13: Internal IDs retained when selectors hidden
testCase('TC-H13', 'Internal IDs retained when selectors hidden -> branchId & sectionId are fully preserved', () => {
  const scope = resolveConfigurationScope({
    branches: [{ id: 'b-lone', name: 'Solo Branch' }],
    sections: [{ id: 's-lone', name: 'Solo Section', branchId: 'b-lone' }]
  });
  assert.strictEqual(scope.showBranchSelector, false);
  assert.strictEqual(scope.showSectionSelector, false);
  assert.strictEqual(scope.resolvedBranchId, 'b-lone');
  assert.strictEqual(scope.resolvedSectionId, 's-lone');
});

// TC-H14: Seat Type isolation
testCase('TC-H14', 'Seat Type isolation -> Fixed & Non-Fixed types remain strictly bound to their scope', () => {
  const stA1 = { id: 'st-a1', name: 'A1 Fixed', allocationMode: 'Fixed', branchId: 'bA', sectionId: 'A1' };
  const stA2 = { id: 'st-a2', name: 'A2 Flex', allocationMode: 'Non-Fixed', branchId: 'bA', sectionId: 'A2' };
  assert.strictEqual(matchesScope(stA1, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(stA1, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(stA2, 'bA', 'A1'), false);
  assert.strictEqual(matchesScope(stA2, 'bA', 'A2'), true);
});

// TC-H15: Seat Map isolation
testCase('TC-H15', 'Seat Map isolation -> Desks in Section A1 never leak into Section A2 or Branch B', () => {
  const deskA1 = { id: 'seat-a1-1', name: 'Desk 1', branchId: 'bA', sectionId: 'A1' };
  const deskB1 = { id: 'seat-b1-1', name: 'Desk 1', branchId: 'bB', sectionId: 'B1' };
  assert.strictEqual(matchesScope(deskA1, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(deskA1, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(deskA1, 'bB', 'B1'), false);
  assert.strictEqual(matchesScope(deskB1, 'bB', 'B1'), true);
  assert.strictEqual(matchesScope(deskB1, 'bA', 'A1'), false);
});

// TC-H16: Shift isolation
testCase('TC-H16', 'Shift isolation -> Shifts in Section A1 never leak into Section A2 or Branch B', () => {
  const shiftA1 = { id: 'sh-a1-morn', name: 'A1 Morning', branchId: 'bA', sectionId: 'A1' };
  const shiftA2 = { id: 'sh-a2-eve', name: 'A2 Evening', branchId: 'bA', sectionId: 'A2' };
  assert.strictEqual(matchesScope(shiftA1, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(shiftA1, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(shiftA2, 'bA', 'A1'), false);
  assert.strictEqual(matchesScope(shiftA2, 'bA', 'A2'), true);
});

// TC-H17: Plan isolation
testCase('TC-H17', 'Plan isolation -> Fee Plans and duration pricing remain bound to section', () => {
  const planA1 = { id: 'pl-a1', name: 'A1 Plan', branchId: 'bA', sectionId: 'A1', durationPricing: [{ durationMonths: 1, basePrice: 1000 }] };
  const planB2 = { id: 'pl-b2', name: 'B2 Plan', branchId: 'bB', sectionId: 'B2', durationPricing: [{ durationMonths: 1, basePrice: 2500 }] };
  assert.strictEqual(matchesScope(planA1, 'bA', 'A1'), true);
  assert.strictEqual(matchesScope(planA1, 'bA', 'A2'), false);
  assert.strictEqual(matchesScope(planA1, 'bB', 'B2'), false);
  assert.strictEqual(matchesScope(planB2, 'bB', 'B2'), true);
  assert.strictEqual(matchesScope(planB2, 'bA', 'A1'), false);
});

// TC-H18: Admission compatibility isolation
testCase('TC-H18', 'Admission compatibility isolation -> New student in A1 can only select A1 shifts, plans, and seats', () => {
  const plans = [
    { id: 'pl-a1', name: 'A1 Plan', branchId: 'bA', sectionId: 'A1', seatTypeId: 'st-a1', shiftIds: ['sh-a1'], active: true },
    { id: 'pl-a2', name: 'A2 Plan', branchId: 'bA', sectionId: 'A2', seatTypeId: 'st-a2', shiftIds: ['sh-a2'], active: true }
  ];
  // Filter for A1
  const a1Plans = plans.filter(p => matchesScope(p, 'bA', 'A1'));
  assert.strictEqual(a1Plans.length, 1);
  assert.strictEqual(a1Plans[0].id, 'pl-a1');
});

// TC-H19: Renewal/relocation isolation
testCase('TC-H19', 'Renewal/relocation isolation -> Relocating a student to A2 uses A2 seats and seat types', () => {
  const seats = [
    { id: 's1', name: 'D1', branchId: 'bA', sectionId: 'A1' },
    { id: 's2', name: 'D2', branchId: 'bA', sectionId: 'A2' }
  ];
  const a2Seats = seats.filter(s => matchesScope(s, 'bA', 'A2'));
  assert.strictEqual(a2Seats.length, 1);
  assert.strictEqual(a2Seats[0].id, 's2');
  assert.strictEqual(a2Seats[0].name, 'D2');
});

// TC-H20: Existing data preserved
testCase('TC-H20', 'Existing data preserved -> Legacy records without branch/section remain accessible in unsectioned scopes', () => {
  const legacyShift = { id: 'sh-legacy', name: 'General Shift', branchId: undefined, sectionId: undefined };
  // When viewed at library level (0B/0S)
  assert.strictEqual(matchesScope(legacyShift, null, null), true);
  // Does not leak into foreign branch
  const otherBranchShift = { id: 'sh-b2', name: 'Branch 2 Shift', branchId: 'b2' };
  assert.strictEqual(matchesScope(otherBranchShift, null, null), false);
});

console.log("\n==================================================");
console.log("SUMMARY OF ACCEPTANCE TESTS (TC-H01 to TC-H20):");
console.log("==================================================");
let passed = 0;
let total = 0;
for (const [id, res] of Object.entries(results)) {
  total++;
  if (res.status === 'PASS') passed++;
  console.log(`${res.status === 'PASS' ? '🟢' : '🔴'} ${id}: ${res.name}`);
}
console.log(`\nTOTAL: ${passed}/${total} PASSED (${Math.round((passed/total)*100)}%)`);
assert.strictEqual(passed, 20, 'All 20 hierarchy acceptance tests must pass!');
