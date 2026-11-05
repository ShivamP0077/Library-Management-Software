// Finds a student's photo among their uploaded documents (issues #12 and #10).
// A photo is a document named like "Photo"/"Photograph" that is an image and has a stored file.
const IMG_EXT = /\.(jpe?g|png|webp|gif|heic)$/i;
export function findPhotoDoc(student) {
  const docs = Array.isArray(student?.documents) ? student.documents : [];
  return docs.find(d => d && d.storageKey && /photo/i.test(d.name || '') &&
    ((d.fileType || '').startsWith('image/') || IMG_EXT.test(d.fileName || ''))) || null;
}
