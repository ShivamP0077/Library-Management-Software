// Designed student fee receipt PDF for WhatsApp. Matches the on-screen slip
// (PrintReceiptModal / receiptView). textToPdf stays the plain-text writer.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import { Library, Settings, models } from './models.js';
import { receiptView, money } from '../../src/utils/receipt.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(repoRoot, 'public');
const fontDir = path.join(repoRoot, 'server', 'assets', 'fonts');
const DEFAULT_LOGO = path.join(publicDir, 'logo-icon.png');
const DEFAULT_TERMS = 'Fees once paid are non-refundable. Keep this receipt for your records.';
const LOGO_MAX = 512 * 1024;
const LOGO_TIMEOUT_MS = 2500;

const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.322, 0.322, 0.322);
const LINE = rgb(0.898, 0.898, 0.898);
const WASH = rgb(0.98, 0.98, 0.98);
const PAPER = rgb(1, 1, 1);

let fontBytesCache;
let defaultLogoCache;

async function fontBytes() {
  if (!fontBytesCache) {
    fontBytesCache = {
      regular: await fs.readFile(path.join(fontDir, 'DejaVuSans.ttf')),
      bold: await fs.readFile(path.join(fontDir, 'DejaVuSans-Bold.ttf')),
    };
  }
  return fontBytesCache;
}

async function defaultLogoBytes() {
  if (!defaultLogoCache) defaultLogoCache = await fs.readFile(DEFAULT_LOGO);
  return defaultLogoCache;
}

/** Image URL only. Emoji and plain text logos are skipped, same as the modal. */
export function libraryLogoUrl(logo) {
  const value = typeof logo === 'string' ? logo.trim() : '';
  if (!value) return '';
  if (/^(https?:\/\/|data:image\/)/i.test(value)) return value;
  if (value.startsWith('/') && /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(value)) return value;
  return '';
}

function storedWords(receipt) {
  const candidates = [receipt?.amountInWords, receipt?.amountWords, receipt?.netInWords, receipt?.netTotalInWords, receipt?.inWords];
  const found = candidates.find(w => typeof w === 'string' && w.trim());
  return found ? found.trim() : '';
}

function storedDue(receipt, state) {
  if (state?.code !== 'partial' && state?.code !== 'unpaid') return null;
  const keys = ['dueAmount', 'balanceDue', 'pendingAmount', 'remaining', 'amountDue'];
  for (const key of keys) {
    if (receipt?.[key] == null || receipt[key] === '') continue;
    const n = Number(receipt[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mergeBranding(settings, library, branch) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    name: String(s.name || library?.name || 'My Library OS').trim() || 'My Library OS',
    address: String(branch?.address || s.address || library?.address || '').trim(),
    phone: String(s.phone || library?.phone || '').trim(),
    taxId: String(s.taxId || '').trim(),
    logo: s.logo,
    receiptFooter: s.receiptFooter,
  };
}

async function loadLogoSource(spec) {
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(spec)) {
    if (spec.length > LOGO_MAX * 2) return null;
    const b64 = spec.slice(spec.indexOf(',') + 1).replace(/\s/g, '');
    const buf = Buffer.from(b64, 'base64');
    return buf.length && buf.length <= LOGO_MAX ? buf : null;
  }
  if (/^https?:\/\//i.test(spec)) {
    const res = await fetch(spec, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), redirect: 'manual' });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '');
    if (type && !/^image\/(png|jpe?g|gif|webp)/i.test(type)) return null;
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > LOGO_MAX) return null;
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > LOGO_MAX) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  if (spec.startsWith('/')) {
    const rel = decodeURIComponent(spec.split(/[?#]/)[0]).replace(/^\/+/, '');
    if (!rel || rel.includes('..')) return null;
    const full = path.resolve(publicDir, rel);
    if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return null;
    const st = await fs.stat(full);
    if (!st.isFile() || st.size > LOGO_MAX) return null;
    return fs.readFile(full);
  }
  return null;
}

async function embedImage(pdf, bytes) {
  if (!bytes?.length) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (png) return await pdf.embedPng(bytes);
    if (jpg) return await pdf.embedJpg(bytes);
    const converted = await sharp(bytes).png().toBuffer();
    return await pdf.embedPng(converted);
  } catch {
    return null;
  }
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawText(page, text, x, y, font, size, color = INK) {
  page.drawText(String(text ?? ''), { x, y, size, font, color });
}

/**
 * @returns {Promise<Buffer>}
 */
export async function renderFeeReceiptPdf(payment, student, { settings, library, branch } = {}) {
  const brand = mergeBranding(settings, library, branch);
  const view = receiptView(payment, { student, branch, settings: brand });
  const words = storedWords(payment);
  const due = storedDue(payment, view.state);
  const refText = view.referenceLine ? view.referenceLine.replace(/^Ref:\s*/, '') : '';
  const seat = String(payment?.seatNo || payment?.seatName || view.seatNo || '').trim() || 'Non-Fixed / Not Assigned';
  const plan = view.planName || '—';
  const studentName = view.studentName || '—';
  const stamp = view.state?.label || 'PAID';
  const terms = String(brand.receiptFooter || '').trim() || DEFAULT_TERMS;
  const contact = [brand.phone ? `Phone: ${brand.phone}` : '', brand.taxId ? `GST: ${brand.taxId}` : ''].filter(Boolean).join('  ·  ');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const pageH = 640;
  const page = pdf.addPage([595.28, pageH]);
  const fonts = await fontBytes();
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });

  let logoImage = null;
  try {
    const custom = libraryLogoUrl(brand.logo);
    const bytes = custom ? await loadLogoSource(custom) : null;
    logoImage = await embedImage(pdf, bytes || await defaultLogoBytes());
  } catch {
    logoImage = null;
  }

  const left = 40;
  const right = 555;
  const width = right - left;
  let y = pageH - 42;

  const headerTop = y;
  const logoSize = 42;
  if (logoImage) {
    const scale = Math.min(logoSize / logoImage.width, logoSize / logoImage.height);
    const w = logoImage.width * scale;
    const h = logoImage.height * scale;
    page.drawImage(logoImage, { x: left, y: y - h, width: w, height: h });
  }
  const textX = left + (logoImage ? logoSize + 10 : 0);
  const stampSize = stamp.length > 12 ? 8 : 10;
  const stampW = Math.min(150, bold.widthOfTextAtSize(stamp, stampSize) + 16);
  const nameMax = right - textX - stampW - 12;
  const nameLines = wrapText(brand.name, bold, 16, nameMax).slice(0, 2);
  let nameY = y - 16;
  for (const line of nameLines) {
    drawText(page, line, textX, nameY, bold, 16);
    nameY -= 18;
  }
  let metaY = nameY - 1;
  if (brand.address) {
    for (const line of wrapText(brand.address, regular, 9, nameMax).slice(0, 2)) {
      drawText(page, line, textX, metaY, regular, 9, MUTED);
      metaY -= 12;
    }
  }
  if (contact) {
    for (const line of wrapText(contact, regular, 9, nameMax).slice(0, 2)) {
      drawText(page, line, textX, metaY, regular, 9, MUTED);
      metaY -= 12;
    }
  }
  const stampH = 16;
  const stampX = right - stampW;
  const stampY = headerTop - stampH;
  page.drawRectangle({ x: stampX, y: stampY, width: stampW, height: stampH, borderColor: INK, borderWidth: 1.4, color: PAPER });
  page.drawRectangle({ x: stampX + 1.6, y: stampY + 1.6, width: stampW - 3.2, height: stampH - 3.2, borderColor: INK, borderWidth: 0.4 });
  const stampTextW = bold.widthOfTextAtSize(stamp, stampSize);
  drawText(page, stamp, stampX + (stampW - stampTextW) / 2, stampY + 4, bold, stampSize);
  const copy = 'STUDENT COPY';
  const copyW = bold.widthOfTextAtSize(copy, 8);
  drawText(page, copy, right - copyW, stampY - 14, bold, 8);

  y = Math.min(metaY, stampY - 22) - 8;

  const cells = [
    ['RECEIPT NO', payment?.receiptNo || payment?.id || '—'],
    ['PAID ON', view.paidOn || '—'],
    ['PERIOD', `${view.period.start || '—'} – ${view.period.end || '—'}`],
    ['NEXT DUE', view.period.nextDue || '—'],
  ];
  const cellH = 32;
  const cellW = width / 2;
  page.drawRectangle({ x: left, y: y - cellH * 2, width, height: cellH * 2, color: WASH, borderColor: LINE, borderWidth: 0.8 });
  page.drawLine({ start: { x: left, y: y - cellH }, end: { x: right, y: y - cellH }, thickness: 0.6, color: LINE });
  page.drawLine({ start: { x: left + cellW, y }, end: { x: left + cellW, y: y - cellH * 2 }, thickness: 0.6, color: LINE });
  cells.forEach((cell, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * cellW + 8;
    const top = y - row * cellH - 11;
    drawText(page, cell[0], x, top, bold, 7.5, MUTED);
    const value = wrapText(cell[1], bold, 10, cellW - 16)[0];
    drawText(page, value, x, top - 13, bold, 10);
  });
  y -= cellH * 2 + 12;

  page.drawRectangle({ x: left, y: y - 48, width, height: 48, borderColor: LINE, borderWidth: 0.8 });
  drawText(page, studentName, left + 10, y - 18, bold, 13);
  const metaBits = [
    `ID  ${view.studentId || '—'}`,
    `Seat  ${seat}`,
    `Plan  ${plan}`,
    ...(view.shift ? [`Shift  ${view.shift}`] : []),
  ];
  let metaX = left + 10;
  const metaBase = y - 36;
  for (const bit of metaBits) {
    const w = regular.widthOfTextAtSize(bit, 9);
    if (metaX + w > right - 8) break;
    drawText(page, bit, metaX, metaBase, regular, 9);
    metaX += w + 14;
  }
  y -= 60;

  drawText(page, 'PAYMENT MODE', left, y, bold, 7.5, MUTED);
  y -= 14;
  if (payment?.method === 'Split' && Array.isArray(payment.breakdown)) {
    drawText(page, 'SPLIT', left, y, bold, 11);
    y -= 14;
    for (const leg of payment.breakdown) {
      const line = `${leg?.method || '—'}: ${money(leg?.amount)}${leg?.referenceNo ? `  ·  Ref: ${leg.referenceNo}` : ''}`;
      for (const wrapped of wrapText(line, regular, 10, width)) {
        drawText(page, wrapped, left, y, regular, 10);
        y -= 13;
      }
    }
  } else {
    drawText(page, payment?.method || view.method || '—', left, y, bold, 11);
    y -= 16;
  }
  if (refText && payment?.method !== 'Split') {
    drawText(page, 'REF / UTR', left, y, bold, 7.5, MUTED);
    y -= 13;
    for (const line of wrapText(refText, bold, 11, width).slice(0, 2)) {
      drawText(page, line, left, y, bold, 11);
      y -= 14;
    }
  }
  y -= 6;

  const baseLabel = 'Subscription Base Fee';
  const rows = [[baseLabel, money(payment?.amount || payment?.netTotal || view.amounts.base)]];
  if (Number(payment?.discount) > 0) rows.push(['Concession / Discount', `- ${money(payment.discount)}`]);
  if (Number(payment?.fine) > 0) rows.push(['Late Fine / Reg Charge', `+ ${money(payment.fine)}`]);
  const netLabel = view.state?.settled ? 'Net total paid' : 'Net total';
  rows.push([netLabel, money(view.amounts.netTotal)]);
  if (due != null) rows.push(['Due / remaining', money(due)]);

  const rowH = 18;
  const tableH = 20 + rows.length * rowH;
  page.drawRectangle({ x: left, y: y - tableH, width, height: tableH, borderColor: LINE, borderWidth: 0.8 });
  page.drawRectangle({ x: left, y: y - 18, width, height: 18, color: WASH });
  drawText(page, 'DESCRIPTION', left + 8, y - 13, bold, 7.5, MUTED);
  const amountHead = 'AMOUNT';
  drawText(page, amountHead, right - 8 - bold.widthOfTextAtSize(amountHead, 7.5), y - 13, bold, 7.5, MUTED);
  rows.forEach((row, i) => {
    const rowY = y - 18 - i * rowH;
    const isNet = row[0] === netLabel;
    if (isNet) page.drawRectangle({ x: left + 0.4, y: rowY - rowH, width: width - 0.8, height: rowH, color: rgb(0.956, 0.956, 0.957) });
    const font = isNet ? bold : regular;
    drawText(page, row[0], left + 8, rowY - 13, font, 10);
    const amtW = font.widthOfTextAtSize(row[1], 10);
    drawText(page, row[1], right - 8 - amtW, rowY - 13, font, 10);
  });
  y -= tableH + 14;

  if (words) {
    const labelW = bold.widthOfTextAtSize('Amount in words', 9);
    drawText(page, 'Amount in words', left, y, bold, 9, MUTED);
    for (const line of wrapText(words, regular, 10, width - labelW - 8).slice(0, 2)) {
      drawText(page, line, left + labelW + 8, y, regular, 10);
      y -= 13;
    }
    y -= 6;
  }

  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: LINE });
  y -= 16;
  for (const line of wrapText(terms, regular, 8.5, width).slice(0, 3)) {
    drawText(page, line, left, y, regular, 8.5, MUTED);
    y -= 11;
  }
  y -= 4;
  drawText(page, 'Powered by My Library OS', left, y, regular, 8, MUTED);
  y -= 16;

  page.drawRectangle({
    x: left - 12,
    y: y,
    width: width + 24,
    height: (headerTop + 16) - y,
    borderColor: LINE,
    borderWidth: 1,
  });

  const fixed = new Date(Date.UTC(2026, 0, 1));
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  return Buffer.from(await pdf.save());
}

async function loadReceiptBranding(tenantId, payment) {
  const [settingsDoc, library] = await Promise.all([
    Settings.findOne({ tenantId }).lean(),
    Library.findOne({ libraryId: tenantId }).lean(),
  ]);
  let branch = null;
  const branchId = payment?.branchId;
  if (branchId) {
    branch = await models.branches.findOne({ tenantId, _key: String(branchId) }).lean();
  }
  return { settings: settingsDoc || {}, library, branch };
}

/** Same return shape as the old plain-text attachment. */
export async function receiptDocument(payment, student, context = {}) {
  const tenantId = context.tenantId || payment?.tenantId || payment?.libraryId || null;
  let settings = context.settings;
  let library = context.library;
  let branch = context.branch;
  const omitted = settings == null && library == null && branch == null;
  if (omitted && tenantId && mongoose.connection.readyState === 1) {
    try {
      const loaded = await loadReceiptBranding(tenantId, payment);
      settings = loaded.settings;
      library = loaded.library;
      branch = loaded.branch;
    } catch {
      settings = {};
    }
  }
  const buffer = await renderFeeReceiptPdf(payment, student, { settings, library, branch });
  const rawName = String(payment?.receiptNo || payment?._key || payment?.id || 'receipt');
  const fileName = `${rawName.replace(/[^\w.-]+/g, '_')}.pdf`;
  return { buffer, base64: buffer.toString('base64'), fileName, mimetype: 'application/pdf' };
}
