import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canUseNativeShare, referralShareUrl, shareReferralLink } from '../src/utils/referralShare.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('profile Wallet opens the wallet page and Subscription stays on its own page', () => {
  const profile = read('../src/components/profile/LibraryOsProfile.jsx');
  const wallet = read('../src/components/profile/WalletPage.jsx');
  assert.match(profile, /go\('wallet'\)/);
  assert.match(profile, /view === 'wallet'/);
  assert.match(profile, /<WalletPage/);
  assert.match(profile, /go\('subscription'\)/);
  assert.match(profile, /<SubscriptionPage/);
  assert.doesNotMatch(profile, /MySoftwarePlanModal/);
  assert.doesNotMatch(profile, /walletOpen/);
  assert.match(wallet, /Custom amount/);
  assert.match(wallet, /Confirm top-up/);
  assert.match(wallet, /api\.walletTopup/);
  assert.match(wallet, /api\.walletHistory/);
  assert.match(wallet, /Referral code copied/);
  assert.match(wallet, /Referral link copied/);
  assert.match(wallet, /shareReferralLink/);
  assert.match(wallet, /earnedMinor/);
  assert.match(wallet, /Wallet receipts/);
  assert.match(wallet, /softwarePlanReceipt/);
  assert.match(wallet, /kind === 'topup'/);
  assert.doesNotMatch(wallet, /creditWallet/);
});

test('the software plan modal no longer hosts wallet top-up or referrals', () => {
  const modal = read('../src/auth/MySoftwarePlanModal.jsx');
  assert.doesNotMatch(modal, /Wallet top-up/);
  assert.doesNotMatch(modal, /Refer & Earn/);
  assert.doesNotMatch(modal, /api\.walletTopup/);
  assert.doesNotMatch(modal, /api\.referrals/);
});

test('referral share uses the native sheet on a phone and copies otherwise', async () => {
  const code = 'LIB-ABC123';
  const url = referralShareUrl(code, 'https://mylibraryos.in');
  assert.equal(url, 'https://mylibraryos.in/#signup?referral=LIB-ABC123');
  assert.equal(canUseNativeShare({ share() {}, maxTouchPoints: 1 }), true);
  assert.equal(canUseNativeShare({ share() {}, maxTouchPoints: 0 }), false);

  let shared = null;
  const mobile = await shareReferralLink({
    code,
    url,
    nav: { share: async (payload) => { shared = payload; }, maxTouchPoints: 2, clipboard: { writeText: async () => { throw new Error('should not copy'); } } },
  });
  assert.equal(mobile, 'shared');
  assert.equal(shared.url, url);

  let copied = '';
  const desktop = await shareReferralLink({
    code,
    url,
    nav: { share: async () => { throw new Error('desktop'); }, maxTouchPoints: 0, clipboard: { writeText: async (value) => { copied = value; } } },
  });
  assert.equal(desktop, 'copied');
  assert.equal(copied, url);

  const cancelled = await shareReferralLink({
    code,
    url,
    nav: { share: async () => { const err = new Error('no'); err.name = 'AbortError'; throw err; }, maxTouchPoints: 1, clipboard: { writeText: async () => { throw new Error('should not copy'); } } },
  });
  assert.equal(cancelled, 'cancelled');
});
