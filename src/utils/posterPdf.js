import { jsPDF } from 'jspdf';
import { POSTER_THEMES, posterFacilities } from './enquiryPoster.js';

function hex(doc, value) {
  const n = parseInt(String(value).replace('#', ''), 16);
  doc.setFillColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
  doc.setTextColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** One A4 page. Returns a Blob (browser) or a Buffer-like output when asked. */
export function buildPosterPdf({ poster, libraryName, logoDataUrl, qrDataUrl, output = 'blob' }) {
  const theme = POSTER_THEMES[poster.theme] || POSTER_THEMES.classic;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  hex(doc, theme.bg);
  doc.rect(0, 0, 210, 297, 'F');
  hex(doc, theme.band);
  doc.roundedRect(14, 14, 182, 78, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  let y = 28;
  if (poster.showLogo && String(logoDataUrl || '').startsWith('data:image/')) {
    try { doc.addImage(logoDataUrl, 'PNG', 95, 18, 20, 20); y = 44; } catch { /* logo is decorative */ }
  }
  doc.setFont('times', 'bold');
  doc.setFontSize(26);
  const heading = doc.splitTextToSize(poster.heading || libraryName || 'Enquiry', 160);
  doc.text(heading, 105, y, { align: 'center' });
  y += heading.length * 10 + 2;
  doc.setFont('times', 'normal');
  doc.setFontSize(13);
  const message = doc.splitTextToSize(poster.message || '', 160);
  doc.text(message, 105, y, { align: 'center' });
  if (String(qrDataUrl || '').startsWith('data:image/')) {
    doc.addImage(qrDataUrl, 'PNG', 68, 108, 74, 74);
  }
  hex(doc, theme.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  let foot = 196;
  const facilities = posterFacilities(poster);
  if (facilities.length) {
    const line = doc.splitTextToSize(facilities.join('  ·  '), 170);
    doc.text(line, 105, foot, { align: 'center' });
    foot += line.length * 6 + 4;
  }
  if (poster.showPhone && poster.phone) { doc.text(poster.phone, 105, foot, { align: 'center' }); foot += 7; }
  if (poster.showAddress && poster.address) {
    const address = doc.splitTextToSize(poster.address, 170);
    doc.text(address, 105, foot, { align: 'center' });
    foot += address.length * 6;
  }
  doc.setFontSize(10);
  doc.text(`${libraryName || ''} · Scan to enquire`, 105, 280, { align: 'center' });
  if (output === 'arraybuffer') return doc.output('arraybuffer');
  return doc.output('blob');
}
