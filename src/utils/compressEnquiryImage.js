import { ENQUIRY_IMAGE_LIMITS } from './enquiryForm.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}

/**
 * JPEG or WebP, quality 85 then 75, longest side ≤ 1600, result ≤ 500 KB.
 * Returns a data URL. Throws a short Error when the file cannot be made small enough.
 */
export function compressEnquiryImage(file) {
  const limits = ENQUIRY_IMAGE_LIMITS;
  if (!file || !limits.types.includes(file.type)) {
    return Promise.reject(new Error('Use a JPEG or WebP image'));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, limits.maxEdge / Math.max(img.width, img.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const mimeCycle = ['image/webp', 'image/jpeg'];
      for (const quality of limits.qualities) {
        for (const mime of mimeCycle) {
          const blob = await new Promise(done => canvas.toBlob(done, mime, quality));
          if (blob && blob.size <= limits.maxBytes) {
            resolve(await blobToDataUrl(blob));
            return;
          }
        }
      }
      reject(new Error('Image must be 500 KB or smaller after compression'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image'));
    };
    img.src = url;
  });
}
