import test from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeCount, formatIndianMobile, indianMobileError, normalizeIndianMobile, telHref, timeAgo,
} from '../src/utils/enquiry.js';

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
