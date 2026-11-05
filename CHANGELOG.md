# Changelog

## 2026-11-05 (IST)

- **Issue #2: each library now has its own browser cache, so data can no longer leak between libraries** (branch `fix/tenant-cache-isolation`, not merged or deployed).
  Before, every library on the same browser shared one set of `library_*` keys. When you opened a library whose server data was empty, the app uploaded whatever another library had left in the browser. That is how data could be copied from one library into another. Now:
  - Every key, including the setup wizard draft and the saved documents, is stored as `t:<libraryId>:<key>`.
  - An empty library starts empty with the setup wizard. Local data is only uploaded if it was saved by that same library.
  - Super-admin read-only views use memory only, and logging out clears the in-memory cache scope.
  - Offline mode keeps its old keys.
  - Old unprefixed data is copied only into the library the old marker names. It is never uploaded automatically and never deleted.
  - Tests: `tests/tenantCache.test.js`.

## 2026-11-04 (IST)

- **WhatsApp phase 1: WhatsApp section, send button on every student, bulk send, disconnected banner** ([PR #28](https://github.com/ShivamP0077/Library-Management-Software/pull/28), merge commit [`a835fd2`](https://github.com/ShivamP0077/Library-Management-Software/commit/a835fd2), 19:00 IST).
  New "WhatsApp" menu section with Messages, Templates (coming soon), Auto reminders (coming soon) and WhatsApp Login (QR connect, moved from Settings; Settings now links there). Students list: Status, Branch and Shift are dropdowns, one student per row at every width (checkbox, name, seat, status and WhatsApp always on one line, extra columns appear on bigger screens), the View button is gone (tap the row), "Select all" and a "N selected · Clear · Send WhatsApp" bar. The send window has Fee reminder, Fee receipt (pick any past payment), Renewal reminder, Seat/shift info and Custom, with {name} {amount} {month} {dueDate} {seat}, a live WhatsApp preview and the student's recent messages. Bulk send sends the chosen message to each selected student one by one and shows who failed, with Retry failed. New tenant-scoped endpoint `POST /api/whatsapp/students/:id/send` logs every send and reuses the wake/retry logic. A red banner shows when WhatsApp is disconnected, and Send is disabled with the reason.

- **WhatsApp Resend no longer fails while the WhatsApp server is starting up** ([PR #26](https://github.com/ShivamP0077/Library-Management-Software/pull/26), commit [`24e1e0c`](https://github.com/ShivamP0077/Library-Management-Software/commit/24e1e0c)).
  At 16:33 IST the Resend failed because the sleeping Evolution server answered HTTP 429 ("busy, starting up"), which was treated as a permanent error. The number was fine. Sends now treat 429 as temporary, wait until the WhatsApp session is "open", and the Messages screen shows the real reason from the WhatsApp server.

- **WhatsApp receipts survive the Evolution server waking up** ([PR #25](https://github.com/ShivamP0077/Library-Management-Software/pull/25), commit [`4ffcc6b`](https://github.com/ShivamP0077/Library-Management-Software/commit/4ffcc6b)).
  A renewal receipt failed at 14:53 IST because the free-plan WhatsApp (Evolution) server was asleep and the send gave up after 20 seconds. Sends now wake the server first and retry for about 90 seconds. A new background job runs every 3 minutes, at any hour, and resends receipts that failed this way, up to 3 attempts in total, without ever sending twice. lms-api also pings the WhatsApp server every 10 minutes to keep it awake. Both services are on Render's free plan, so a paid plan is the real fix.
- **WhatsApp Messages screen** ([PR #24](https://github.com/ShivamP0077/Library-Management-Software/pull/24), commit [`e41772d`](https://github.com/ShivamP0077/Library-Management-Software/commit/e41772d)).
  New "Messages" tab in Settings (next to WhatsApp) and a "WhatsApp" tab on each student's profile list every receipt and reminder with its text, time and status (Sent, Delivered, Read, Failed, Not sent) plus the reason, and a Resend button for failed or not-sent messages. Delivery and read ticks come from an Evolution MESSAGES_UPDATE webhook, secured with a per-instance token derived from the existing Evolution key, so no new setting was needed. In Local Offline Mode the screen asks the user to sign in.
- **WhatsApp admission receipts no longer skipped for new students** ([PR #23](https://github.com/ShivamP0077/Library-Management-Software/pull/23), commit [`c511374`](https://github.com/ShivamP0077/Library-Management-Software/commit/c511374)).
  When a student was admitted, the payment was saved a moment before the student, so the receipt check found no phone number and quietly gave up. The server now waits up to about 15 seconds for the student, and saving new students also sends any receipt still waiting for them (never twice). Every skipped message is now logged with a reason (no student, no phone, disabled, no consent, invalid number).
- **WhatsApp settings: clear sign-in message in Local Offline Mode** ([PR #22](https://github.com/ShivamP0077/Library-Management-Software/pull/22), commit [`b18a822`](https://github.com/ShivamP0077/Library-Management-Software/commit/b18a822)).
  The WhatsApp card showed a red "Authentication required" error with a Retry button and never offered a QR code. The app was running in Local Offline Mode, which has no cloud session token, so the backend rejected the WhatsApp call with 401. The Evolution API itself works. The card now tells the user to tap "Connect / Sign In" and sign in first, instead of calling the API and showing a confusing error.
