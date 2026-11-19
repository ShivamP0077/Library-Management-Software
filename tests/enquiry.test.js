import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  badgeCount, formatIndianMobile, indianMobileError, normalizeIndianMobile, telHref, timeAgo,
} from '../src/utils/enquiry.js';
import { normalizePoster, posterDocumentHtml, posterDraftOmitsUrl } from '../src/utils/enquiryPoster.js';
import { branchSectionState, genderError, viewOnlyPlans, ENQUIRY_IMAGE_LIMITS } from '../src/utils/enquiryForm.js';
import { buildPosterPdf } from '../src/utils/posterPdf.js';

test('Indian mobile validation accepts +91, leading 0 and 10 digits', () => {
  assert.equal(indianMobileError(''), 'Enter a 10-digit mobile number');
  assert.equal(indianMobileError('98765'), 'Enter a valid 10-digit Indian mobile number');
  assert.equal(indianMobileError('1234567890'), 'Enter a valid 10-digit Indian mobile number');
  assert.equal(indianMobileError('9876543210'), '');
  assert.equal(indianMobileError('+91 98765 43210'), '');
  assert.equal(indianMobileError('09876543210'), '');
  assert.equal(indianMobileError('919876543210'), '');
  assert.equal(normalizeIndianMobile('+91 98765 43210'), '9876543210');
  assert.equal(normalizeIndianMobile('09876543210'), '9876543210');
  assert.equal(normalizeIndianMobile('1234567890'), '');
  assert.equal(formatIndianMobile('919876543210'), '+91 98765 43210');
  assert.equal(telHref('9876543210'), 'tel:+919876543210');
});

test('time ago buckets and waiting-list badge', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(timeAgo(now - 10_000, now), 'just now');
  assert.equal(timeAgo(now - 60_000, now), '1 minute ago');
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 minutes ago');
  assert.equal(timeAgo(now - 3 * 60 * 60_000, now), '3 hours ago');
  assert.equal(timeAgo(now - 24 * 60 * 60_000, now), '1 day ago');
  assert.equal(timeAgo(now - 40 * 24 * 60 * 60_000, now), '1 month ago');
  assert.equal(timeAgo('not-a-date', now), '');
  assert.equal(badgeCount(0), '');
  assert.equal(badgeCount(3), '3');
  assert.equal(badgeCount(120), '99+');
});

test('withAbsoluteUrl prefixes a relative enquiry link and keeps absolute ones', async () => {
  const { withAbsoluteUrl } = await import('../src/utils/enquiry.js');
  assert.equal(withAbsoluteUrl({ url: '/enquiry/abc' }, 'https://app.example.com/').url, 'https://app.example.com/enquiry/abc');
  assert.equal(withAbsoluteUrl({ url: 'https://x.y/enquiry/abc' }, 'https://app.example.com').url, 'https://x.y/enquiry/abc');
});

test('enquiry QR offers six actions and a full A4 poster', async () => {
  const card = fs.readFileSync(new URL('../src/components/enquiry/EnquiryQrCard.jsx', import.meta.url), 'utf8');
  for (const label of ['Copy', 'Share', 'Download full poster', 'Print full poster', 'Regenerate Link', 'Edit Poster']) {
    assert.equal(card.includes(label), true, label);
  }
  assert.equal(card.includes('enquiry-qr.png'), false);
  assert.equal(card.includes('The old QR code will stop working.'), true);
  assert.equal(card.includes('The print window was blocked.'), true);
  assert.equal(card.includes('buildPosterPdf'), true);
  assert.equal(card.includes('setLink'), true);
  assert.equal(/savePoster[\s\S]*setLink/.test(card), false);

  const poster = normalizePoster({ heading: 'Welcome', message: 'Come in', theme: 'forest', facilities: 'AC, Wi-Fi', showLogo: true }, { name: 'City Library' });
  assert.equal(posterDraftOmitsUrl(poster), true);
  const url = 'https://app.example.com/enquiry/token-1';
  const html = posterDocumentHtml({ poster, libraryName: 'City Library', qrDataUrl: 'data:image/png;base64,aaaa', logoUrl: '' });
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Welcome/);
  assert.match(html, /data:image\/png;base64,aaaa/);
  assert.equal(html.includes(url), false);
  const bytes = new Uint8Array(buildPosterPdf({ poster, libraryName: 'City Library', qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', output: 'arraybuffer' }));
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
});

test('public enquiry form rules: field order, documents and plan sections, locked branch', () => {
  const source = fs.readFileSync(new URL('../src/components/enquiry/PublicEnquiryForm.jsx', import.meta.url), 'utf8');
  const form = source.slice(source.indexOf('phase === \'form\''));
  const order = ['enquiry-name', 'enquiry-mobile', 'enquiry-email', '>Gender', 'enquiry-branch', 'enquiry-section', 'enquiry-documents', 'enquiry-plan', 'enquiry-message'];
  let last = -1;
  for (const token of order) {
    const at = form.indexOf(token);
    assert.ok(at > last, `${token} is missing or out of order`);
    last = at;
  }
  assert.equal(form.includes('enquiry-preferred'), false);
  assert.match(source, /preferredPlan/);
  assert.match(form, /Mobile number/);
  assert.match(form, /enquiry-aadhaar/);
  assert.match(form, /enquiry-photo/);
  assert.equal(form.includes('type="radio"'), true);
  assert.equal(source.includes('planChoiceOptions'), true);
  assert.equal(source.includes('aria-readonly'), true);
  assert.equal(genderError(''), 'Select male, female or other');
  assert.equal(genderError('female'), '');
  assert.equal(ENQUIRY_IMAGE_LIMITS.maxEdge, 1600);
  assert.equal(ENQUIRY_IMAGE_LIMITS.maxBytes, 500 * 1024);
  assert.deepEqual(ENQUIRY_IMAGE_LIMITS.qualities, [0.85, 0.75]);

  const one = branchSectionState({
    branches: [{ id: 'b1', name: 'Main' }],
    sections: [{ id: 's1', name: 'Hall', branchId: 'b1' }],
  }, '', '');
  assert.equal(one.branch.locked, true);
  assert.equal(one.branch.value, 'b1');
  assert.equal(one.section.locked, true);
  assert.equal(one.section.value, 's1');

  const many = branchSectionState({
    branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }],
    sections: [{ id: 's1', name: 'Hall', branchId: 'b1' }, { id: 's2', name: 'Cabin', branchId: 'b2' }],
  }, 'b2', '');
  assert.equal(many.branch.locked, false);
  assert.deepEqual(many.section.options.map(s => s.id), ['s2']);
  assert.equal(many.section.locked, true);

  const plans = viewOnlyPlans([
    { id: 'p1', name: 'Morning', price: 999 },
    { planId: 'saas', name: 'SaaS Gold', priceMonthly: 4999 },
  ]);
  assert.deepEqual(plans, [{ id: 'p1', name: 'Morning', price: 999 }]);
});
