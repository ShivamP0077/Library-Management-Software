// Minimal dependency-free text PDF writer for confirmations and receipts.
// It is intentionally simple (Helvetica, A4, wrapped lines) but emits a valid PDF.
import { receiptReferenceText } from '../../src/utils/paymentReference.js';

/** Lines for a student fee-receipt PDF. Includes "Ref: …" when a UTR was stored. */
export function feeReceiptPdfLines(payment) {
  const lines = [
    `Receipt: ${payment?.receiptNo || payment?.id || ''}`,
    `Mode: ${payment?.method || ''}`,
    `Amount: ${payment?.netTotal ?? payment?.amount ?? ''}`,
  ];
  const ref = receiptReferenceText(payment);
  if (ref) lines.push(ref);
  return lines;
}
const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 48;
const TOP = 790;
const LEADING = 14;
const MAX_LINES = 48;

const ascii = (s) => String(s ?? '').normalize('NFKD')
  .replace(/[–—]/g, '-')
  .replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/·/g, '-')
  .replace(/₹/g, 'INR ')
  .replace(/[^\x20-\x7E]/g, '?');
const esc = (s) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrapLine(line, width = 92) {
  const text = ascii(line);
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function textToPdf(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = [];
  for (const line of rawLines) lines.push(...wrapLine(line));
  if (!lines.length) lines.push('');
  const pages = [];
  for (let i = 0; i < lines.length; i += MAX_LINES) pages.push(lines.slice(i, i + MAX_LINES));

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const pageLines of pages) {
    const content = ['BT', '/F1 10 Tf', `${LEFT} ${TOP} Td`, `${LEADING} TL`]
      .concat(pageLines.map(l => `(${esc(l)}) Tj T*`))
      .concat(['ET'])
      .join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}
