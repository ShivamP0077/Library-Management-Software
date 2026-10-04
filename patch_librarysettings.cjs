const fs = require('fs');
const path = require('path');

let content = fs.readFileSync(path.join(__dirname, 'scratch_librarysettings.jsx'), 'utf8');

content = content.replace(/const targetBlocks = targetBranch\?\.blocks \|\| \[\];/g, "const targetBlocks = sections.filter(s => s.branchId === targetBranch?.id);");
content = content.replace(/b\.blocks\?\.map/g, "sections.filter(s => s.branchId === b.id).map");
content = content.replace(/blk\.seats\?\.length/g, "seats.filter(st => st.sectionId === blk.id).length");
content = content.replace(/const validSeatTypes = seatTypes\.filter\(st => st\.blockId ===/g, "const validSeatTypes = seatTypes.filter(st => st.sectionId ===");

// Also add sections and seats to useLibrary destructure
content = content.replace(
  "const { settings, updateSettings, branches, setBranches, plans, setPlans, shifts, setShifts, seatTypes } = useLibrary();",
  "const { settings, updateSettings, branches, setBranches, sections, seats, plans, setPlans, shifts, setShifts, seatTypes } = useLibrary();"
);

fs.writeFileSync(path.join(__dirname, 'src/components/LibrarySettings.jsx'), content, 'utf8');
console.log('LibrarySettings.jsx patched successfully!');
