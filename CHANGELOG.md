# Changelog

## 2026-11-05 (IST)

- **Issue #15 (part 1): Change Password inside the account** (branch `fix/15-change-password`, merged into `release/21-issues` only).
  - A key button in the top bar opens a Change password form: current password, new password, and confirm.
  - Checks: at least 8 characters, the two new passwords must match, and the new one must differ from the current one.
  - Google-only accounts can set a first password without entering a current one.
  - Server: after 5 wrong current-password tries the user waits 15 minutes.
  - Server: a wrong current password now returns 400 instead of 401. Before, a wrong entry signed the user out; this also fixes the Partner portal.
  - Every change is audited (already existed).
  - Forgot Password and Google login are unchanged. Signup comes later with #14.

- **Issue #20: support replies confirm when sent** (branch `fix/20-support-confirm`, merged into `release/21-issues` only).
  - Owner and Super Admin replies show "Reply sent" only after the server saves the reply, and the thread updates with it.
  - If sending fails, the typed text is kept and a "Not sent" line with a Retry button appears.
  - The Send button shows "Sending…" and can't be pressed twice.
  - Long dropdown options are now cut with "…" instead of overlapping on mobile.
  - Owner notifications for Super Admin replies already existed; no change.

- **Issue #21: mobile bottom bar no longer hides the last item** (branch `fix/21-bottom-bar`, merged into `release/21-issues` only).
  The bottom padding (bar height plus the phone's safe area) now sits on the box that actually scrolls. The app height now uses `100dvh`, so it fits the visible screen on mobile browsers, with `100vh` as a fallback. The 5-button bar itself is unchanged.

- **Issue #7: close (X) buttons are easy to tap on mobile** (branch `fix/07-close-buttons`, merged into `release/21-issues` only).
  One shared style in `responsive.css` gives every icon-only X button the same 20px icon and a tap area of at least 44×44px, in all 30+ modals and panels, with no change to their look or layout. Buttons with an X plus text (like "Exit Setup") are not affected.

- **Issue #4: one way to select students** (branch `fix/04-bulk-select`, merged into `release/21-issues` only).
  The separate sticky "N selected · Send WhatsApp" bar from PR #28 is gone, and Send WhatsApp is now in the old Bulk Actions bar next to Renew Selected and Remove Selected. Checkboxes still show on every row. Ticking one, or Select all, opens Select Students mode, so the menu's Select Students and a direct tick both lead to the same bar. Cancel Selection clears everything. Renew Selected now shows only for staff who can manage students, the same rule as the Select Students menu item.

- **Issue #17: WhatsApp Templates and Auto reminders tabs now work** (branch `feat/17-templates-reminders`, merged into `release/21-issues` only).
  - **Templates:** edit the fee reminder, renewal reminder, fee receipt and seat info messages. Variables are {name}, {amount}, {dueDate}, {library} and {seat}, with a live preview. Reset to default is available. Templates are saved per library. The send window uses them, and automatic reminders use the fee and renewal templates. Until a template is saved, the old wording is used.
  - **Auto reminders:** up to 10 rules, each with days before, on or after the due date, a send time (9 AM–7 PM), on/off, and "only if unpaid". Each message is sent once and is cancelled when the student renews or pays. With no rules, the old single expiry timing still applies. Fee repeat timing moved to this tab. Quiet hours stay 9 AM–8 PM. No existing data is changed.

- **Issue #18: WhatsApp Login copes with a sleeping WhatsApp server and never shows raw HTML** (branch `fix/18-whatsapp-login-429`, merged into `release/21-issues` only).
  The WhatsApp Login page could show an HTTP 429 error full of HTML/CSS text. Its status and connect calls did not wake the sleeping free-plan WhatsApp (Evolution) server and did not retry. Now:
  - These calls wake the server and retry on 429/5xx.
  - An HTML error page is replaced by plain text: "WhatsApp service is starting up. Please try again in a minute."
  - The app handles a non-JSON reply safely.
  - The page retries by itself up to 3 times while it shows "WhatsApp service is waking up".
  - Sending (PR #26) is unchanged.

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
