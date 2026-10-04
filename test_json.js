const fs = require('fs');

const students = [{
  id: "STU1",
  name: "John Doe",
  branchId: "B1",
  sectionId: "S1",
  documents: ["Aadhaar Card"],
  startDate: new Date("2024-05-10").toISOString().split('T')[0],
  status: "Active"
}];

try {
  const str = JSON.stringify(students);
  console.log("Stringify success. Length:", str.length);
  
  const parsed = JSON.parse(str);
  console.log("Parse success:", parsed.length);
} catch (e) {
  console.error("Error:", e);
}
