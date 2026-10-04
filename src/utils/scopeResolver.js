/**
 * Canonical Scope Resolution Utility
 * 
 * Hierarchy:
 * LIBRARY
 * ├── Branches (optional)
 * │   ├── Branch A
 * │   │   ├── Section A1
 * │   │   └── Section A2
 * │   └── Branch B
 * │       ├── Section B1
 * │       └── Section B2
 * └── Direct Sections (ONLY when no branches exist)
 *     ├── Section 1
 *     └── Section 2
 */

export function resolveConfigurationScope({
  branches = [],
  sections = [],
  selectedBranchId = null,
  selectedSectionId = null,
}) {
  const hasBranches = Array.isArray(branches) && branches.length > 0;
  
  // 1. Resolve Branch
  let resolvedBranchId = null;
  const availableBranches = hasBranches ? branches : [];
  const showBranchSelector = availableBranches.length > 1;

  if (hasBranches) {
    const matched = availableBranches.find(b => b.id === selectedBranchId);
    resolvedBranchId = matched ? matched.id : availableBranches[0].id;
  }

  // 2. Resolve Sections strictly belonging to the resolved branch (or direct library sections if no branches)
  const availableSections = (sections || []).filter(s => {
    if (hasBranches) {
      return s.branchId === resolvedBranchId;
    } else {
      return !s.branchId || s.branchId === 'all';
    }
  });

  const hasSections = availableSections.length > 0;
  let resolvedSectionId = null;
  const showSectionSelector = availableSections.length > 1;

  if (hasSections) {
    const matched = availableSections.find(s => s.id === selectedSectionId);
    resolvedSectionId = matched ? matched.id : availableSections[0].id;
  }

  // 3. Determine Scope Type
  let scopeType = 'LIBRARY';
  if (hasBranches && hasSections) {
    scopeType = 'SECTION';
  } else if (hasBranches && !hasSections) {
    scopeType = 'BRANCH';
  } else if (!hasBranches && hasSections) {
    scopeType = 'SECTION';
  } else {
    scopeType = 'LIBRARY';
  }

  // 4. Generate human-readable label
  const currentBranch = hasBranches ? branches.find(b => b.id === resolvedBranchId) : null;
  const currentSection = hasSections ? availableSections.find(s => s.id === resolvedSectionId) : null;

  let scopeDisplayName = 'Library';
  if (currentBranch && currentSection) {
    scopeDisplayName = `${currentBranch.name || 'Branch'} → ${currentSection.name || 'Section'}`;
  } else if (currentBranch) {
    scopeDisplayName = `${currentBranch.name || 'Branch'}`;
  } else if (currentSection) {
    scopeDisplayName = `${currentSection.name || 'Section'}`;
  }

  return {
    resolvedBranchId,
    resolvedSectionId,
    scopeType,
    availableBranches,
    availableSections,
    showBranchSelector,
    showSectionSelector,
    currentBranch,
    currentSection,
    scopeDisplayName
  };
}

/**
 * Helper: Check if an entity (SeatType, Seat, Shift, Plan) matches the resolved scope
 */
export function matchesScope(item, resolvedBranchId, resolvedSectionId) {
  if (!item) return false;

  // Branch check:
  if (resolvedBranchId) {
    if (item.branchId && item.branchId !== 'all' && item.branchId !== resolvedBranchId) {
      return false;
    }
  } else {
    // When scope has NO branch (library-level), items assigned to a specific branch must not appear
    if (item.branchId && item.branchId !== 'all') {
      return false;
    }
  }

  // Section check:
  if (resolvedSectionId) {
    if (item.sectionId && item.sectionId !== 'all' && item.sectionId !== resolvedSectionId) {
      return false;
    }
  } else {
    // When scope has NO section, items assigned to a specific section must not appear
    if (item.sectionId && item.sectionId !== 'all') {
      return false;
    }
  }

  return true;
}

/**
 * Generate all possible scopes across the library for exhaustive multi-scope workflows
 */
export function getAllConfigurationScopes(branches = [], sections = []) {
  const scopes = [];
  const hasBranches = Array.isArray(branches) && branches.length > 0;

  if (hasBranches) {
    branches.forEach(b => {
      const branchSections = (sections || []).filter(s => s.branchId === b.id);
      if (branchSections.length > 0) {
        branchSections.forEach(s => {
          scopes.push({
            scopeKey: `${b.id}__${s.id}`,
            branchId: b.id,
            sectionId: s.id,
            scopeType: 'SECTION',
            displayName: `${b.name || 'Branch'} → ${s.name || 'Section'}`,
            branch: b,
            section: s
          });
        });
      } else {
        scopes.push({
          scopeKey: `${b.id}__null`,
          branchId: b.id,
          sectionId: null,
          scopeType: 'BRANCH',
          displayName: `${b.name || 'Branch'}`,
          branch: b,
          section: null
        });
      }
    });
  } else {
    const directSections = (sections || []).filter(s => !s.branchId || s.branchId === 'all');
    if (directSections.length > 0) {
      directSections.forEach(s => {
        scopes.push({
          scopeKey: `null__${s.id}`,
          branchId: null,
          sectionId: s.id,
          scopeType: 'SECTION',
          displayName: `${s.name || 'Section'}`,
          branch: null,
          section: s
        });
      });
    } else {
      scopes.push({
        scopeKey: 'null__null',
        branchId: null,
        sectionId: null,
        scopeType: 'LIBRARY',
        displayName: 'Library',
        branch: null,
        section: null
      });
    }
  }

  return scopes;
}
