/**
 * Re-encode a student document image with sharp.
 * Photos → ~200 KB, ID / other images → ~500 KB, longest side ≤ 1600px, JPEG quality ~75.
 * If the result is not smaller than the original, the original buffer is kept.
 * PDFs and non-images are skipped. Transparent images stay PNG or WebP.
 */
import sharp from 'sharp';

export const PHOTO_TARGET_BYTES = 200 * 1024;
export const ID_TARGET_BYTES = 500 * 1024;
export const MAX_EDGE_PX = 1600;

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/i;

export function classifyDocument(doc = {}) {
  const blob = [doc.docTypeId, doc.fileName, doc.name, doc.purpose, doc.storageKey].filter(Boolean).join(' ');
  const photo = /photograph|doc-photo|\/photo(?:\/|$|\b)|(?:^|[^a-z])photo(?:[^a-z]|$)/i.test(blob);
  return photo
    ? { kind: 'photo', targetBytes: PHOTO_TARGET_BYTES }
    : { kind: 'id', targetBytes: ID_TARGET_BYTES };
}

export function parseDataUrl(data) {
  const m = DATA_URL_RE.exec(String(data || '').trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  let buf;
  try {
    buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  } catch {
    return null;
  }
  if (!buf.length) return null;
  return { mime, buf };
}

export function toDataUrl(mime, buf) {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function encode(buf, { edge, quality, mime }) {
  let pipeline = sharp(buf, { failOn: 'none', unlimited: false }).rotate().resize({
    width: edge,
    height: edge,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' });
  else if (mime === 'image/webp') pipeline = pipeline.webp({ quality, alphaQuality: 80, effort: 4 });
  else pipeline = pipeline.png({ compressionLevel: 9, effort: 8 });
  return pipeline.toBuffer();
}

/**
 * @returns {Promise<{
 *   action: 'compress' | 'keep' | 'skip',
 *   reason?: string,
 *   mime?: string,
 *   buf?: Buffer,
 *   beforeBytes: number,
 *   afterBytes: number,
 *   kind?: string,
 *   targetBytes?: number,
 * }>}
 */
export async function compressImageBuffer(buf, mime, hints = {}) {
  const beforeBytes = buf?.length || 0;
  const type = String(mime || '').toLowerCase();
  if (!beforeBytes) return { action: 'skip', reason: 'empty', beforeBytes, afterBytes: 0 };
  if (type === 'application/pdf' || type.includes('pdf')) {
    return { action: 'skip', reason: 'pdf', beforeBytes, afterBytes: beforeBytes };
  }
  if (!type.startsWith('image/')) {
    return { action: 'skip', reason: 'non-image', beforeBytes, afterBytes: beforeBytes };
  }

  const { kind, targetBytes } = classifyDocument(hints);
  let meta;
  try {
    meta = await sharp(buf, { failOn: 'none' }).metadata();
  } catch {
    return { action: 'skip', reason: 'invalid-image', beforeBytes, afterBytes: beforeBytes, kind, targetBytes };
  }

  let opaque = true;
  if (meta.hasAlpha) {
    try {
      const stats = await sharp(buf, { failOn: 'none' }).stats();
      opaque = stats.isOpaque !== false;
    } catch {
      opaque = false;
    }
  }

  const alreadySmall = beforeBytes <= targetBytes
    && Math.max(meta.width || 0, meta.height || 0) <= MAX_EDGE_PX
    && (opaque ? type === 'image/jpeg' : true);
  if (hints.compressedAt) {
    return { action: 'skip', reason: 'already-compressed', beforeBytes, afterBytes: beforeBytes, kind, targetBytes };
  }
  if (alreadySmall) {
    return { action: 'skip', reason: 'already-under-target', beforeBytes, afterBytes: beforeBytes, kind, targetBytes };
  }

  const outMime = opaque ? 'image/jpeg' : 'image/webp';
  const qualities = kind === 'photo' ? [75, 65, 55, 45] : [75, 68, 60, 52];
  const edges = [MAX_EDGE_PX, 1280, 1024, 800];
  let best = null;
  let bestMime = outMime;

  try {
    for (const edge of edges) {
      for (const quality of qualities) {
        const out = await encode(buf, { edge, quality, mime: outMime });
        if (!best || out.length < best.length) {
          best = out;
          bestMime = outMime;
        }
        if (out.length <= targetBytes) break;
      }
      if (best && best.length <= targetBytes) break;
    }
    if (!opaque && (!best || best.length > targetBytes)) {
      const png = await encode(buf, { edge: MAX_EDGE_PX, quality: 75, mime: 'image/png' });
      if (!best || png.length < best.length) {
        best = png;
        bestMime = 'image/png';
      }
    }
  } catch {
    return { action: 'skip', reason: 'encode-failed', beforeBytes, afterBytes: beforeBytes, kind, targetBytes };
  }

  if (!best || best.length >= beforeBytes) {
    return {
      action: 'keep',
      reason: 'not-smaller',
      mime: type,
      beforeBytes,
      afterBytes: best?.length || beforeBytes,
      kind,
      targetBytes,
    };
  }
  return {
    action: 'compress',
    mime: bestMime,
    buf: best,
    beforeBytes,
    afterBytes: best.length,
    kind,
    targetBytes,
  };
}
