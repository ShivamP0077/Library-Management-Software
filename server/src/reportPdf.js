// Custom report PDF. Receipt layout stays in receiptPdf.js.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fontBytes, defaultLogoBytes, libraryLogoUrl, loadLogoSource, embedImage } from './receiptPdf.js';
import { formatReportMoney, formatReportStamp } from '../../src/utils/reportBuilder.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const FOOTER_H = 28;
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.35, 0.39, 0.45);
const LINE = rgb(0.86, 0.88, 0.9);
const BAR = rgb(0.12, 0.23, 0.37);
const WHITE = rgb(1, 1, 1);
const ZEBRA = rgb(0.96, 0.97, 0.98);
const GREEN = rgb(22 / 255, 163 / 255, 38 / 255);
const RED = rgb(220 / 255, 38 / 255, 38 / 255);

function wrapCell(text, font, size, maxWidth) {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const words = raw.split(/\s+/);
  const lines = [];
  let cur = '';
  const take = (word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = word;
      }
      return;
    }
    if (cur) { lines.push(cur); cur = ''; }
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) chunk = next;
      else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    cur = chunk;
  };
  for (const word of words) if (word) take(word);
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function isMoneyHeader(label) {
  return /₹|amount|refund/i.test(String(label || ''));
}

function moneyColor(label, value) {
  if (!/net profit/i.test(String(label || ''))) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? RED : GREEN;
}

function colWidths(rows, total, measureHeader) {
  const cols = Math.max(1, ...rows.filter(r => r && r.length).map(r => r.length));
  const weights = Array(cols).fill(8);
  for (const row of rows) {
    if (!row) continue;
    row.forEach((cell, i) => {
      weights[i] = Math.max(weights[i], Math.min(String(cell ?? '').length, 32));
    });
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const header = rows.find(r => r && r.length) || [];
  const mins = Array.from({ length: cols }, (_, i) => {
    const measured = measureHeader ? measureHeader(String(header[i] ?? '')) : 0;
    return Math.max(36, measured);
  });
  let widths = weights.map((w, i) => Math.max((w / sum) * total, mins[i] || 36));
  let extra = widths.reduce((a, b) => a + b, 0) - total;
  if (extra > 0.5) {
    const flex = widths.map((w, i) => Math.max(0, w - (mins[i] || 36)));
    const flexSum = flex.reduce((a, b) => a + b, 0);
    if (flexSum > 0) widths = widths.map((w, i) => w - extra * (flex[i] / flexSum));
    else {
      const scale = total / widths.reduce((a, b) => a + b, 0);
      widths = widths.map(w => w * scale);
    }
  } else if (extra < -0.5) {
    const room = -extra;
    widths = widths.map((w, i) => w + room * (weights[i] / sum));
  }
  return widths;
}

function cellText(value, money) {
  if (value === '' || value === undefined || value === null) return '';
  if (money && typeof value === 'number' && Number.isFinite(value)) return formatReportMoney(value);
  return String(value);
}

export async function renderCustomReportPdf(report, { logo } = {}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await fontBytes();
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  let logoImage = null;
  try {
    const custom = libraryLogoUrl(logo);
    const bytes = custom ? await loadLogoSource(custom) : null;
    logoImage = await embedImage(pdf, bytes || await defaultLogoBytes());
  } catch {
    logoImage = null;
  }

  const pages = [];
  const bottom = M + FOOTER_H;
  const width = PAGE_W - M * 2;
  let page;
  let y;

  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = PAGE_H - M;
  };

  const draw = (text, x, yy, font, size, color = INK) => {
    page.drawText(String(text ?? ''), { x, y: yy, size, font, color });
  };

  const fullHeader = () => {
    const p = report.period || {};
    const logoSize = 36;
    const top = y;
    if (logoImage) {
      const scale = Math.min(logoSize / logoImage.width, logoSize / logoImage.height);
      const w = logoImage.width * scale;
      const h = logoImage.height * scale;
      page.drawImage(logoImage, { x: M, y: top - h, width: w, height: h });
    }
    const textX = M + (logoImage ? logoSize + 10 : 0);
    draw(report.libraryName || 'My Library OS', textX, top - 14, bold, 14);
    draw(`${p.branchName || 'All Branches'}  ·  ${p.sectionName || 'All Sections'}`, textX, top - 30, regular, 9, MUTED);
    draw(`${p.from || ''} to ${p.to || ''}`, textX, top - 44, regular, 9, MUTED);
    draw(formatReportStamp(report.generatedAt), textX, top - 58, regular, 8, MUTED);
    y = top - Math.max(logoSize, 68) - 14;
  };

  const compactHeader = () => {
    draw(report.libraryName || 'My Library OS', M, y - 12, bold, 10);
    y -= 22;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.6, color: LINE });
    y -= 12;
  };

  const ensure = (need) => {
    if (y - need >= bottom) return;
    addPage();
    compactHeader();
  };

  const summaryPairs = () => {
    const t = report.totals || {};
    const rows = [
      ['Fee collections', t.feeCollections],
      ['Refunds', t.refunds],
      ['Net fees', t.netFees],
      ['One-time expenses', t.oneTime],
      ['Recurring paid', t.recurringPaid],
      ['Total expenses', t.expenseTotal],
    ];
    if (t.netProfit !== undefined) rows.push(['Net profit', t.netProfit]);
    return rows;
  };

  const drawSummary = () => {
    const pairs = summaryPairs();
    const students = report.studentSummary || {};
    const studentRows = [
      ['Active', students.active ?? 0],
      ['New in period', students.newInPeriod ?? 0],
      ['Cancelled in period', students.cancelledInPeriod ?? 0],
    ];
    const lineH = 14;
    const boxH = 18 + (pairs.length + studentRows.length + 2) * lineH;
    ensure(boxH + 8);
    draw('Summary', M, y - 12, bold, 12);
    y -= 22;
    for (const [label, value] of pairs) {
      draw(label, M, y - 10, regular, 9);
      const shown = formatReportMoney(value);
      const color = moneyColor(label, value) || INK;
      const font = /net profit/i.test(label) ? bold : regular;
      const w = font.widthOfTextAtSize(shown, 9);
      draw(shown, PAGE_W - M - w, y - 10, font, 9, color);
      y -= lineH;
    }
    y -= 6;
    draw('Students', M, y - 10, bold, 10);
    y -= lineH;
    for (const [label, value] of studentRows) {
      draw(label, M, y - 10, regular, 9);
      const shown = String(value);
      draw(shown, PAGE_W - M - regular.widthOfTextAtSize(shown, 9), y - 10, regular, 9);
      y -= lineH;
    }
    y -= 12;
  };

  const paintRow = (cells, widths, font, size, opts) => {
    const pad = 4;
    const wrapped = cells.map((cell, i) => wrapCell(cell, font, size, Math.max(8, widths[i] - pad * 2)));
    const lines = Math.max(1, ...wrapped.map(w => w.length));
    const rowH = lines * (size + 3) + 6;
    if (y - rowH < bottom) {
      addPage();
      compactHeader();
      if (opts.repeatHeader) opts.repeatHeader();
    }
    const top = y;
    if (opts.fill) page.drawRectangle({ x: M, y: top - rowH, width, height: rowH, color: opts.fill });
    let x = M;
    wrapped.forEach((parts, i) => {
      const money = opts.align && opts.align[i] === 'right';
      parts.forEach((line, li) => {
        const tw = font.widthOfTextAtSize(line, size);
        const tx = money ? x + widths[i] - pad - tw : x + pad;
        const color = opts.colors?.[i] || (opts.fill === BAR ? WHITE : INK);
        draw(line, Math.max(x + 1, tx), top - 4 - size - li * (size + 3), font, size, color);
      });
      x += widths[i];
    });
    page.drawLine({ start: { x: M, y: top - rowH }, end: { x: PAGE_W - M, y: top - rowH }, thickness: 0.4, color: LINE });
    y = top - rowH;
    return rowH;
  };

  const drawTable = (title, rows) => {
    const data = (rows || []).filter(r => r && r.length);
    const blanks = (rows || []).length - data.length;
    ensure(28);
    draw(title, M, y - 12, bold, 12);
    y -= 20;
    if (!data.length) {
      draw('No rows', M, y - 10, regular, 9, MUTED);
      y -= 22;
      return;
    }
    const headerSize = 8;
    const headerPad = 4;
    const widths = colWidths(data, width, (label) => bold.widthOfTextAtSize(label, headerSize) + headerPad * 2);
    const header = data[0].map(c => String(c ?? ''));
    const align = header.map(h => (isMoneyHeader(h) ? 'right' : 'left'));
    const paintHeader = () => {
      paintRow(header, widths, bold, headerSize, { fill: BAR, align });
    };
    paintHeader();
    data.slice(1).forEach((row, idx) => {
      const cells = header.map((_, i) => cellText(row[i], align[i] === 'right'));
      const label = String(row[0] ?? '');
      const emphasize = /^(One-time|Recurring paid|Total expenses|Net fees|Net profit|Fee collections|Refunds)$/i.test(label);
      const colors = header.map((_, i) => (i === 1 ? moneyColor(label, row[1]) : null));
      paintRow(cells, widths, emphasize ? bold : regular, 8, {
        fill: emphasize ? null : (idx % 2 === 1 ? ZEBRA : null),
        align,
        colors,
        repeatHeader: paintHeader,
      });
    });
    if (blanks) y -= 6;
    y -= 14;
  };

  addPage();
  fullHeader();
  drawSummary();
  for (const block of report.blocks || []) drawTable(block.title, block.rows);
  const total = pages.length;
  pages.forEach((pg, i) => {
    const label = `Page ${i + 1} of ${total}`;
    const size = 8;
    const w = regular.widthOfTextAtSize(label, size);
    pg.drawText(label, { x: (PAGE_W - w) / 2, y: 22, size, font: regular, color: MUTED });
  });
  return Buffer.from(await pdf.save());
}
