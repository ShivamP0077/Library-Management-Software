/**
 * Browser-side image compression for new uploads.
 * Photos (Photograph, doc-photo, names containing "photo") aim for ~200 KB.
 * ID pages and other images aim for ~500 KB. Longest side stays at or under 1600px.
 * JPEG quality starts near 75. PDFs and undecodable payloads are left unchanged.
 * When Canvas / Image / createImageBitmap are missing (Node tests), this is a no-op.
 */

export const PHOTO_TARGET_BYTES = 200 * 1024;
export const ID_TARGET_BYTES = 500 * 1024;
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.75;

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/i;

export function targetBytesFor(hints = {}) {
  const blob = [hints.purpose, hints.docType, hints.docTypeId, hints.name, hints.fileName]
    .filter(Boolean)
    .join(' ');
  if (/photograph|doc-photo|\/photo(?:\/|$|\b)|(?:^|[^a-z])photo(?:[^a-z]|$)/i.test(blob)) {
    return PHOTO_TARGET_BYTES;
  }
  return ID_TARGET_BYTES;
}

export function isPhotoDocument(hints) {
  return targetBytesFor(hints) === PHOTO_TARGET_BYTES;
}

export function dataUrlByteLength(dataUrl) {
  const m = DATA_URL_RE.exec(String(dataUrl || '').trim());
  if (!m) return 0;
  const b64 = m[2].replace(/\s/g, '').replace(/=+$/, '');
  return Math.floor((b64.length * 3) / 4);
}

export function dataUrlMime(dataUrl) {
  const m = DATA_URL_RE.exec(String(dataUrl || '').trim());
  return m ? m[1].toLowerCase() : '';
}

function browserCanCompress() {
  const hasDecode = typeof createImageBitmap === 'function' || typeof Image !== 'undefined';
  const hasCanvas = typeof OffscreenCanvas !== 'undefined'
    || (typeof document !== 'undefined' && typeof document.createElement === 'function');
  return hasDecode && hasCanvas;
}

function scaledSize(width, height, edge) {
  const max = Math.max(width || 0, height || 0);
  if (!max || max <= edge) return { width: width || 1, height: height || 1 };
  const s = edge / max;
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas-blob'));
      return;
    }
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('empty-blob'))), type, quality);
  });
}

async function blobToDataUrl(blob) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('blob-read'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(dataUrl) {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  if (typeof Image === 'undefined') throw new Error('no-image');
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('decode'));
    img.src = dataUrl;
  });
  return { source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, close() {} };
}

function hasTransparency(ctx, width, height) {
  try {
    const sample = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(4, Math.floor(sample.length / (4 * 4000)) * 4);
    for (let i = 3; i < sample.length; i += step) {
      if (sample[i] < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function encodeCanvas(canvas, mime, quality) {
  const blob = await canvasToBlob(canvas, mime, quality);
  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, fileType: blob.type || mime, fileSize: blob.size };
}

/**
 * @returns {Promise<{ dataUrl: string, compressed: boolean, reason?: string, fileType?: string, fileSize?: number, targetBytes?: number }>}
 */
export async function compressImageDataUrl(dataUrl, options = {}) {
  const original = typeof dataUrl === 'string' ? dataUrl : '';
  if (options.compress === false) {
    return { dataUrl: original, compressed: false, reason: 'disabled' };
  }
  const mime = dataUrlMime(original);
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    return { dataUrl: original, compressed: false, reason: mime ? 'not-raster' : 'invalid' };
  }
  if (!browserCanCompress()) {
    return { dataUrl: original, compressed: false, reason: 'no-canvas' };
  }

  const targetBytes = targetBytesFor(options);
  const originalBytes = dataUrlByteLength(original);
  let decoded;
  try {
    decoded = await decodeImage(original);
    const first = scaledSize(decoded.width, decoded.height, MAX_EDGE_PX);
    const canvas = makeCanvas(first.width, first.height);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return { dataUrl: original, compressed: false, reason: 'no-context' };
    ctx.drawImage(decoded.source, 0, 0, first.width, first.height);
    const transparent = (mime === 'image/png' || mime === 'image/webp') && hasTransparency(ctx, first.width, first.height);

    const attempts = [];
    const edges = [MAX_EDGE_PX, 1280, 1024, 800];
    const qualities = transparent ? [0.8] : [JPEG_QUALITY, 0.65, 0.55, 0.45];
    const outMime = transparent ? 'image/webp' : 'image/jpeg';

    for (const edge of edges) {
      const size = scaledSize(decoded.width, decoded.height, edge);
      if (size.width !== canvas.width || size.height !== canvas.height) {
        canvas.width = size.width;
        canvas.height = size.height;
        ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
      }
      for (const quality of qualities) {
        try {
          const encoded = await encodeCanvas(canvas, outMime, quality);
          attempts.push(encoded);
          if (encoded.fileSize <= targetBytes) break;
        } catch {
          if (transparent) {
            try {
              const png = await encodeCanvas(canvas, 'image/png', 1);
              attempts.push(png);
            } catch { /* keep looking */ }
          }
        }
      }
      if (attempts.some((a) => a.fileSize <= targetBytes)) break;
    }

    attempts.sort((a, b) => a.fileSize - b.fileSize);
    const best = attempts.find((a) => a.fileSize <= targetBytes) || attempts[0];
    if (!best || !best.dataUrl || best.fileSize >= originalBytes) {
      return { dataUrl: original, compressed: false, reason: 'not-smaller', targetBytes, fileSize: originalBytes, fileType: mime };
    }
    return {
      dataUrl: best.dataUrl,
      compressed: true,
      fileType: best.fileType,
      fileSize: best.fileSize,
      targetBytes,
    };
  } catch {
    return { dataUrl: original, compressed: false, reason: 'decode-failed' };
  } finally {
    decoded?.close?.();
  }
}
