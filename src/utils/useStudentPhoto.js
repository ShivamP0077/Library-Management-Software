import { useEffect, useState } from 'react';
import { getDocumentBlob } from './idbStorage';
import { findPhotoDoc } from './studentPhoto';

// Loads the student's photo (data URL) if they have one, else null.
export function useStudentPhoto(student) {
  const [src, setSrc] = useState(null);
  const key = findPhotoDoc(student)?.storageKey || null;
  useEffect(() => {
    let alive = true; let objUrl = null; setSrc(null);
    if (key) getDocumentBlob(key).then(d => {
      if (!alive || !d) return;
      if (typeof d === 'string') setSrc(d); else { objUrl = URL.createObjectURL(d); setSrc(objUrl); }
    }).catch(() => {});
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [key]);
  return src;
}
