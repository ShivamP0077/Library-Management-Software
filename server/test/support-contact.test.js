import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportContact, registrationConfirmationText } from '../src/registration.js';

const OFFICIAL = 'mylibraryosadmin@gmail.com';

test('support contact defaults to the official address and ignores SMTP_FROM', () => {
  const prevSupport = process.env.SUPPORT_EMAIL;
  const prevFrom = process.env.SMTP_FROM;
  try {
    delete process.env.SUPPORT_EMAIL;
    process.env.SMTP_FROM = 'noreply@libraryos.app';
    assert.equal(supportContact(), OFFICIAL);
    process.env.SUPPORT_EMAIL = '  ';
    assert.equal(supportContact(), OFFICIAL);
    process.env.SUPPORT_EMAIL = 'desk@example.com';
    assert.equal(supportContact(), 'desk@example.com');
    const text = registrationConfirmationText({
      confirmationNumber: 'REG-TEST',
      libraryName: 'Test Library',
      libraryId: 'lib-test',
      paymentStatus: 'unpaid',
      registeredAt: '2026-01-01T00:00:00.000Z',
    });
    assert.match(text, /Support: desk@example.com/);
    assert.doesNotMatch(text, /noreply@libraryos\.app/);
  } finally {
    if (prevSupport == null) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = prevSupport;
    if (prevFrom == null) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = prevFrom;
  }
});
