# Eight-issue implementation evidence — 6 November 2026

## Testing boundary

This is an unmerged feature-branch handoff. The synthetic preview uses an isolated throwaway test database, sample users, sample files and simulated wallet settlement. No production data, migration, gateway funds, email or WhatsApp service was used. Passing local tests do not prove real Razorpay/PayPal credentials or third-party delivery.

| Issue | Application implementation | Direct verification |
| --- | --- | --- |
| #3 Student documents | Multiple normalised document records, stored-file downloads, replacement with 30-day restricted retention, purge and recovery, legacy-document migration. | `documents-multi.test.js`, `delete-library.test.js`, frontend `studentDocuments.test.js`; synthetic sample STU001 files supplied to preview. |
| #12 Student receipt and delivery state | PDF receipt, stored delivery record/status/reason and retry when an actual attempt fails; no silent success assumption. | `notifications.test.js` and the student receipt frontend integration; WhatsApp requires a separately approved live test. |
| #15 Registration, profile and confirmation | Confirmation is retained whether delivery succeeds or fails, downloadable PDF/text/api views, profile contacts, verification and owner-only sensitive changes. | `account-registration.test.js`: 7 tests passed, including delivery independence, tenant boundary and PDF text formatting. |
| #16 Safe deletion | Exact-name confirmation, role restrictions, retained document recovery and audited scheduled removal. | `delete-library.test.js`, shared `confirmName.test.js`. |
| #18 Reliable workflows | Bounded requests, safe response parsing, fewer stale state updates, correct menu/page combinations and non-destructive retries for applicable work. | Frontend suite, submission integration tests, permission tests, receipts support tests and full backend suite. |
| #19 Software billing | Separate My Software Plan, wallet bonus-first consumption and expiry, referrals/offers, GST included/excluded, invoices, checkout and owner/admin invoice histories; Razorpay/PayPal configuration. | `payments.test.js`, `settlement-hardening.test.js`, `billing-final.test.js`, `subscription.test.js`, `account-plan.test.js`; one wallet-only synthetic checkout produced consistent owner/admin invoice views of INR 999 total, INR 999 wallet, INR 0 external, INR 152.39 included GST. Not an actual gateway charge. |
| #20 Global support and notices | Atomic global ticket allocation, retained legacy-number aliases, idempotent replies, scoped admin notes and attachment validation, multiple notice files. | `support-global-numbering.test.js`, `support.test.js`: 15-support + boundary checks; 100 concurrent creates yield unique consecutive ticket numbers. No production numbering migration has run. |
| #22 All eight screens and responsive layouts | My Profile separately from My Software Plan, provider administration and history, library/student flow integration, corrected UI selection states. | Frontend 74 tests and build passed. Desktop/mobile browser evidence is not completed; browser connectivity blocked the preview. Phone testing is deliberately retained for after deployment. |

## Commit status

The implementation is on `feat/expanded-eight-issues`. Original base: `0fa4c03`. The branch commit and PR will be linked after they exist. This feature set deliberately contains no production migration, deployment or merge.

## Required pre-deployment migration review

Global support numbering provides a migration tool with dry-run/check modes. Before enabling it on production, inspect a fresh database/backup snapshot, run the dry run, resolve ambiguous/legacy cases, then execute with explicit production approval. Deployment with old ticket-number writers and new ones concurrently must follow `docs/support-ticket-numbering-migration.md`; local tests do not validate a live migration.

## Commands and logs

- `npm test`: 74/74 passed, `evidence/frontend-final-clean.log`.
- `NODE_ENV=test node --test server/test/account-registration.test.js`: 7/7 passed, `evidence/pdf-registration-final-2.log`.
- Focused permission/upload checks: 18/18 passed, `evidence/boundary-final.log`.
- Support migration/concurrency: 15/15 passed, `evidence/support-migration-final.log`.
- Billing routes: 14/14 passed, `evidence/billing-routes-review.log`.
- `npm run build`: passed, only Vite chunk-size advisory, `evidence/frontend-final-clean.log`.
- Final full backend result is recorded in `evidence/server-accepted.log`.

`evidence/` is a local review folder, not part of the app or the production database. Do not commit fixture downloads or synthetic credentials.
