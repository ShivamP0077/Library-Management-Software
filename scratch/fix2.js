import fs from 'fs';

const p = '/Users/urshitvadhel/Desktop/Library software/Librarary Management System/src/context/LibraryContext.jsx';
let content = fs.readFileSync(p, 'utf8');

content = content.replace('export const reconcileSeats = ({ savedSeats, students = [], sections = [], seatTypes = [] };\n', '');
content = content.replace(' => {\n', 'export const reconcileSeats = ({ savedSeats, students = [], sections = [], seatTypes = [] }) => {\n');

fs.writeFileSync(p, content, 'utf8');
