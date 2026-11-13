# Changelog

## 2026-11-13 (IST)

- **PR 2: payment reference, payment receipts switch, plan duration type, Skip / Later, Super Admin WhatsApp, phone sign-up by WhatsApp** — 20:50 IST. Builds on the renewal/payment-date change (PR #68). (A) UPI, card, bank transfer, net banking and cheque payments need a "Reference / UTR number" (trimmed, up to 64 characters) at admission, renewal, bulk renew, split parts and seat-change collections; cash does not. The server checks it only for new payments, so old payments stay valid. It shows in payment history, the printed receipt and the WhatsApp receipt as "Ref: …". Expense payments show the field but it is optional. (B) WhatsApp preferences have one "Payment receipts" switch for the automatic receipt after an admission or renewal payment. It is stored as `paymentReceipts`; libraries that never set it follow the old "Admission & renewal receipts" value, so nothing changes until someone flips it. (C) A fee plan can have its own duration type (Anniversary, Calendar month, Every N days, Yearly). New plans start on the library's default. Plans without one keep using the library default. Admission, renewal, bulk renew and the server price check use the plan's type. (D) Dashboard Action Required items have Later (hidden until tomorrow) and Skip (hidden for this occurrence), plus "Show hidden (N)" to restore. Stored per library on the server (`/api/dashboard/action-dismissals`), with a local copy if the server can't be reached; saving library settings never wipes it. (E) Super Admin has a WhatsApp tab to connect a separate system number (Evolution instance `libos-system`) by QR, see its status and disconnect. No library can use that instance name. (F) Phone sign-up sends the 6-digit code from that system WhatsApp. The Mobile tab is shown only when it is connected (`mobileSignupAvailable`). Rate limits, expiry and code hashing are the same as before, and a failed send leaves no usable code. Not deployed; no live data or messages touched.

- **Renewals, payment dates, and the blank screen** — Renewing a test student could turn the whole app white because some students had no payment history and the screen tried to copy a list that was not there. That copy is now safe, and a crash shows a short message with a Reload button instead of a blank page. A renewal now starts the day after the previous end date, even when the student pays late or early. Example: a plan that ended on 30 Nov, paid on 7 Dec, runs 1 Dec–31 Dec. If the payment is more than a month late, you can keep that continuation or start fresh from a date you pick. The end date keeps the original day of the month (a 31st stays on the 31st or the last day of a short month; 29 Feb does the same in a normal year). Bulk renew uses the same dates as renewing one student. Admission and renewal have a Payment date (not in the future, and not more than 60 days ago) that is separate from the period. Receipts and WhatsApp say "Paid on" that date and show the service period. Reminders are still not created for days that have already passed. No live data was changed.

- **Fix Razorpay Test connection button.** The Super Admin Payments page has a Test connection button. It failed because the server used `paymentProvider` without importing it, so the button showed an error even when Razorpay was connected. That import is now in place. After this is deployed, Super Admin → Payments → Razorpay → Test connection should show Verified. File: `server/src/paymentConfig.js`. Test mode only; no live payments and no customer data changed.

- **Brand: rename to My Library OS and use the new logo** (`e09555d`). The live site and app still said "Library OS" or "Library Management OS", and the landing used an old gold-book mark (the apple-touch icon was a broken error-page image). Customer-facing text now says "My Library OS" — landing, app tab title, login, header subtitle, support, receipts, emails, SMS and payment labels. The new book-and-circuit logo is used for favicons, the apple-touch icon, the social preview image, the landing wordmark and the login screen. Each library's own header/receipt logo is unchanged. Cookies, localStorage keys, `LIB-`/`REG-` codes, backup file format (`LOSB1`, `library-os-*.bak`), package names and Vercel project names are unchanged. The WhatsApp linked-device name is left to a later Evolution setting. Files: `index.html`, `public/`, `src/auth/LoginScreen.jsx`, `src/components/Header.jsx`, `landing/index.html`, `landing/public/`, `landing/src/`, `server/src/` emails, receipts and payment providers.

## 2026-11-10 (IST)

- **#15 Google signup fix** — 21:55 IST. Cause: the signup page's Continue with Google button used the relative link `/api/auth/google/start?signup=1`, which on Vercel opened the website itself instead of the API, so no Google signup started and the user landed back on sign in. Fix: it now uses the same API address as the sign-in Google button (`api.googleStartUrl()`) with `?signup=1`. File: `src/auth/SignupPanel.jsx`.

## 2026-11-06 (IST)

- **Expanded issues #3, #12, #15, #16, #18, #19, #20 and #22, implemented on `feat/expanded-eight-issues`.** Students can keep several documents and download them. Student receipts and WhatsApp delivery have clearer states. Owners can download their registration confirmation even when delivery fails. My Profile and My Software Plan are separate, while existing navigation stays in place. The plan page includes wallet history, referral information and clear invoice totals. Super Admin can verify Razorpay or PayPal and see the same owner billing history. Support ticket numbers have a chronological global sequence, with old aliases still searchable; the included migration is dry-run by default. Support and notices accept multiple attachments, with size checks. No production data was migrated, no live payments were made, and deployment has not happened. Live-provider delivery and payment verification still require configured production credentials and explicit approval.

- **Student profile: personal WhatsApp message** — 12:50 IST. The profile **WhatsApp** tab now has a small "Personal message" box above the sent / not-sent list. It shows the student's WhatsApp number, sends through the same server route and checks as every other manual send (`type: custom`: signed-in tenant only, read-only blocked, active subscription, WhatsApp plan feature, connection status). The number always comes from the student record on the server. Success or error shows in the box and the list refreshes; you stay on the profile. Files: `src/components/WhatsAppSendModal.jsx` (`WhatsAppPersonalSend`), `src/components/StudentManager.jsx`.
- **Students: one selection flow (WhatsApp merged into Select Students)** — 12:30 IST. Cause: the WhatsApp work added an always-visible tick-box column on every student row, next to the original **Select Students** mode, so there were two ways to select. Now the boxes appear only after **Select Students** (as in the original design); in that mode tapping a row ticks it, and the one Bulk Actions bar holds Renew Selected, Send WhatsApp and Remove Selected. Outside the mode a row tap opens the profile. The single-student WhatsApp icon on each row stays. File: `src/components/StudentManager.jsx`.
- **#16 Delete permanently fix** — 12:05 IST. Cause: the type-the-name check compared text exactly, on both the app and the server. iPhone typing changes text (auto capital letter, curly ’ instead of ', extra or non-breaking spaces), so the button stayed greyed out with no reason shown, or the server refused with an error that appeared as a toast behind the full-screen dialog. Fix: one shared rule (`src/utils/confirmName.js`, copy in `server/src/confirmName.js`) ignores capital letters, quote style and extra spaces but still needs the full name. Input has auto-capital/auto-correct off. The dialog shows "Name matches" / "does not match yet" and any server error inside the dialog; error text says "Nothing was deleted". Server error codes unchanged.
- **#21 iPhone scroll lock fix** — 11:40 IST. Cause: on phones `html`, `body` and `#root` had `overflow-x: hidden`, which makes each of them a scroll box, and the page content scrolled inside a second 100dvh `overflow: hidden` shell. iOS Safari hands the swipe to the outer boxes, which have nothing to scroll, so screens felt locked. The More drawer also grew under the fixed bottom bar inside that clipped shell, so its lower options could not be scrolled to or tapped. Fix (mobile ≤767px only, `src/responsive.css`): the page now scrolls as one normal document (`overflow-x: clip`, shells `height: auto`), header is sticky, the five bottom buttons stay `position: fixed` unchanged, and the open More drawer is capped above the bottom bar and scrolls inside. Tapping a More item now always closes the drawer (`Header.jsx`). Desktop layout unchanged.

## 2026-11-05 (IST)

- **Release: merge `release/21-issues` → main** — 22:05 IST. Ships all 21 PDF issues plus #9 server price lock, #11 voided history kept, #14 subscription enforcement, #15 Google signup hooks, #19 Razorpay/PayPal provider config, #2 dry-run report script, and log redaction (PRs #30–#58). Public signup and live payments stay off until configured. No customer data deleted; no DB migration. Rollback: previous main `8bfcbaf`, Render `dep-dblj6og473hc73b9jur0`, Vercel `dpl_CBn2yBVCCdQRsoHJY1Pq83PLggtp`.

- **Security: log redaction** — 22:00 IST. New `server/src/redact.js`: masks URL credentials, Bearer/Basic tokens, password/secret/key fields and values of sensitive env vars; console output is redacted at startup. `db.js` re-exports it. Tests added.

- **#2 copied-data dry-run script + changelog PR #30 fix** — 18:35 IST. Added `server/scripts/copied-data-dry-run.mjs` (read-only pairwise fingerprint compare; never deletes). Changelog now correctly notes Issue #2 / PR #30 is merged into `release/21-issues`. Production overlap report still needs Atlas IP allow-list or a machine that can reach Mongo.

- **#19 Payment providers (Razorpay + PayPal)** — 18:20 IST. Super Admin **Payments** tab stores Razorpay/PayPal keys encrypted (AES-256-GCM). Active provider powers `POST /subscription/checkout` (Payment Links / PayPal Orders), signature-verified webhooks, software invoices, AutoPay helpers (Razorpay subscriptions), lock-at-expiry via existing #14 statuses (`past_due` on failed charge). Deletion requests email Super Admins and appear under Payments for acknowledge/dismiss.

- **#15 Google signup + payment step hooks** — 17:55 IST. Owner signup (still gated by `OWNER_SIGNUP_ENABLED`) can continue with Google (`?signup=1` OAuth → pending token → `/auth/signup/complete-google`). Config exposes `googleSignup` and `paymentsConfigured`. Signup responses include `needsPayment` + `paymentHook` pointing at `POST /api/subscription/checkout` (402 until a provider is registered in #19). UI shows a payment step after creating a paid library.

- **#14 Subscription enforcement** — 17:40 IST. Libraries with a subscription that is awaiting payment, expired (including ended trials), cancelled or past-due can still read data and manage their plan, but writes are blocked (402). Plan feature lists gate WhatsApp when the plan does not include it (empty list = all features). Staff limits apply on invites, invite accept, and POST /users. `/auth/me` returns `subscriptionAccess` and the app shows a lock banner.

- **#11 Voided payments kept in history** — 17:25 IST. Voiding a renewal (or admission) no longer deletes the payment. The row stays visible as **Voided**, is struck through in the ledger and student profile, and is excluded from income totals and P&L. Admission void still frees the seat.

- **#9 Server-side payment price lock** — 17:10 IST. Staff without amount-edit permission can no longer bypass the lock by omitting `amountEdited`. The server recomputes the fee from the seat plan (and approved pro-rate maths) and rejects any custom amount or discount. Client flags are ignored for the decision. Matching plan prices still work for Librarians. Owner/Admin always; Manager on by default.

- **#19 My Subscription (owners)** — 15:10 IST. New "Plan" button for owners: current plan, status, renewal/trial dates, usage against limits, change plan (free/cheaper plans; downgrades during a paid period are scheduled for period end; blocked if usage exceeds the new plan's limits), cancel at period end / resume, invoices list (empty until a payment provider exists), and a deletion *request* (exact library name; nothing is deleted — Super Admin reviews and uses the existing delete flow). Paid upgrades reply "Online payments are not set up yet". Super Admin's business table now shows real plan/status/renewal and a "Deletion requested" flag.

- **#15 Owner self-signup (off by default)** — 14:40 IST. New owners can create a library from the sign-in screen: email → 6-digit code (15 min, 5 tries, single use) → plan choice (monthly/yearly) → name, library name, password. Only visible when the server sets `OWNER_SIGNUP_ENABLED=true`. Plans with a trial start as trialing; paid plans without a trial are recorded as `pending_payment` (no payment provider is connected yet — provider interface only). Existing emails get a notice email, never a second account.

- **#14 Super Admin plan builder** (4:10 PM IST): new "Software plans" tab. Super Admin can create, edit and archive plans with a monthly/yearly price, student, staff and branch limits, a free-trial length, a feature list, and whether the plan is offered at signup. Each library can be put on a plan. The server enforces the plan's limits (only when adding more; existing data is never locked). A library's own student limit still wins over the plan's. No payment provider is connected.

- **#16 Delete library** (3:45 PM IST): Super Admin has a separate Delete button (Disable is unchanged). You must type the exact library name; the server checks it again, removes only that library's data (students, payments, settings, staff logins, invites, WhatsApp settings and log, and the rest), logs out its WhatsApp instance if possible, and keeps an audit entry. Other libraries are never touched. No library was deleted on the live system.

- **#13 Staff invite and login** (3:20 PM IST): checked Render (read-only): FRONTEND_URL is set to https://library-os-app.vercel.app, so invite links are correct. Tested the whole flow end to end (invite, open link on mobile, set password, join, sign in, single use, expiry, revoke, other library blocked). Added the missing part: an invited person can now also join with Google, only with the invited email; the account gets the invited library, role and staff link, and the invite is still single-use.

- **#9 Billing cycles & fee changes** (2:55 PM IST): library-wide cycle modes (anniversary, calendar month, every N days, yearly). New joiners get a pro-rated first payment option (calendar days, final amount rounded to the rupee). Seat/shift moves to a different-priced plan charge the pro-rated difference (separate receipt) or add a credit to the student; logged in seat history. Renewals can optionally be aligned to the library cycle with a bridge payment; existing students keep their stored dates otherwise (no data migration). Amount-edit permission: Admin always, Manager on by default, other staff off; owner-only setting, enforced on the server and every change audited.

- **#8 Recurring bill schedule** — New recurring bills use a clear **First due date** and **Repeat every N days / months / years**. Month and year steps keep the original day and use the last day of short months (Jan 31 → Feb 28/29 → Mar 31; Feb 29 → Feb 28 in normal years). Payment date stays separate; reminders unchanged. Old bills keep their old due-day schedule and dates (no data changed).

- **#11 Void admission frees the seat** — Voiding the first admission (History tab > Void) now ends the plan, frees the seat (server releases it) and marks the record "Voided" instead of deleting it. An audit entry is saved in the student's voidHistory. Renewal voids and Cancel Admission work as before. Refunds stay separate.

- **#6 Shifts grouped by section** — Settings > Operating Shifts now lists shifts under the section whose plans use them. Shifts not used by a section plan go under "All sections". Derived only, no data or schema change.

- **#5 Seat types grouped by section** — Settings > Seat Types now shows types under each section heading (Hall A, Hall B…) and an "All sections" group for shared ones. Section comes from the type's own section or its seats. No data change.

- **Issue #10: Student Profile layout** (branch `fix/10-profile-layout`, merged into `release/21-issues` only).
  - Header: the student's photo (or their initial when there is none), their name, and a 44px close button.
  - Details in pairs: ID | Gender, Desk | Shift, Expiry | Status. Mobile and Emergency each take a full row.
  - Two columns on phones, one column below 300px width.
  - Fixed: on phones the 5 tabs (History, Relocations, Payments, Documents, WhatsApp) were squashed to 1px tall and couldn't be seen or tapped. They now always show.
  - All actions are unchanged.

- **Issue #3: camera capture and document preview** (branch `fix/03-camera-preview`, merged into `release/21-issues` only).
  - A Camera button next to Attach/Upload opens the phone camera directly in three places: New Admission, the student profile Documents tab (custom and each required document), and new notices.
  - On computers it opens the normal file picker.
  - New Admission has a Preview button that opens the file full screen with Retake (the same camera or picker) and Remove.
  - New notices also get a full-screen preview with Remove.
  - Back closes the preview only.
  - Pending documents, "Skip for now", and the photo-required setting are unchanged.
  - The photo on receipts was done in #12.

- **Issue #1: browser Back / Forward inside the library** (branch `fix/01-back-forward`, merged into `release/21-issues` only).
  - Each screen change adds a history entry like `#/students`, so Back and Forward move between library screens.
  - Back closes an open window first: student profile, new admission, receipt, change password, and the renew, relocate, extend, edit, bulk renew, WhatsApp send and document preview windows.
  - Back on the first screen no longer leaves the library or lands on the login page. It stays and shows "Use Sign out to leave".
  - A reload keeps the current screen.
  - Menu, tabs, login and logout are unchanged. No new library was added.

- **Issue #12: receipt print layout** (branch `fix/12-receipt-print`, merged into `release/21-issues` only).
  - Printing now gives one A4 page split into two A5 halves, a "Student copy" and a "Library copy", with a dashed cut line.
  - Each copy is shrunk to fit its half (never enlarged), so nothing is cut off and it no longer sits in the top-left corner.
  - The student's photo shows on the receipt (on screen and in print) when they have an uploaded "Photograph" image document.
  - Receipt content and the WhatsApp receipt are unchanged.

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

- **Issue #2: each library now has its own browser cache, so data can no longer leak between libraries** ([PR #30](https://github.com/ShivamP0077/Library-Management-Software/pull/30), branch `fix/tenant-cache-isolation`, merged into `release/21-issues` only — not deployed to main).
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
