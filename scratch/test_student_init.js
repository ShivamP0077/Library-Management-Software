import fs from 'fs';
import path from 'path';

// Read the code of LibraryContext
const code = fs.readFileSync(path.resolve('./src/context/LibraryContext.jsx'), 'utf-8');

// We will extract the exact useState logic for students
const match = code.match(/const \[students, setStudents\] = useState\(\(\) => \{([\s\S]*?)\}\);/);
if (!match) throw new Error("useState students not found");
const studentInitBody = match[1];

let localStorageMock = {};
global.localStorage = {
  getItem: (key) => localStorageMock[key] || null,
  setItem: (key, val) => { localStorageMock[key] = val; },
  clear: () => { localStorageMock = {}; }
};

const INITIAL_STUDENTS = [];
const INITIAL_BRANCHES = [{id: 'b1'}];
const INITIAL_SECTIONS = [{id: 's1'}];

const initStudents = new Function('INITIAL_STUDENTS', 'INITIAL_BRANCHES', 'INITIAL_SECTIONS', `
  ${studentInitBody}
`);

// Test 1: Empty localStorage
let parsed = initStudents(INITIAL_STUDENTS, INITIAL_BRANCHES, INITIAL_SECTIONS);
console.log("Empty load:", parsed);

// Add a student and save
const testStudent = { id: 'STU-1', name: 'John Doe', branchId: 'b1', sectionId: 's1' };
localStorage.setItem('library_students', JSON.stringify([testStudent]));

// Test 2: Load with student
try {
  let parsed2 = initStudents(INITIAL_STUDENTS, INITIAL_BRANCHES, INITIAL_SECTIONS);
  console.log("Loaded student:", parsed2);
} catch (e) {
  console.log("Error loading:", e.message);
}

