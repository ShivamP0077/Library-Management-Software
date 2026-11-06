// Finds a student's photo among their uploaded documents (issues #12 and #10).
// A photo is a document type named like "Photo"/"Photograph" and an image file.
// Issue #3 documents may hold several files under `files[]`; legacy top-level
// storageKey/fileName records are still supported.
import { groupStudentDocuments } from './studentDocuments.js';

const IMG_EXT = /\.(jpe?g|png|webp|gif|heic)$/i;

const isImageFile = (f) => Boolean(f?.storageKey) && (
  String(f.fileType || '').startsWith('image/') || IMG_EXT.test(f.fileName || f.name || '')
);

export function findPhotoDoc(student) {
  const docs = Array.isArray(student?.documents) ? student.documents : [];
  const groups = groupStudentDocuments(docs);
  for (const g of groups) {
    if (!/photo/i.test(g.name || '')) continue;
    const file = (g.files || []).find(isImageFile);
    if (file) return { ...file, name: g.name, docTypeId: g.docTypeId };
  }
  // Legacy fallback for malformed rows not picked up by the grouping helper.
  return docs.find((d) => d && d.storageKey && /photo/i.test(d.name || '') &&
    ((d.fileType || '').startsWith('image/') || IMG_EXT.test(d.fileName || ''))) || null;
}
