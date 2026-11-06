# Library OS — simple live-site test guide

Use this only after Shivam approves merging and deployment. Use a test library, not a real student's personal data or real money until specifically approved. Test one item at a time and write down what happened. If a screen disagrees with this guide, stop that item and send its screenshot.

## 1. My Profile and registration confirmation

1. Log in as the library owner. Open your profile menu.
2. Open **My Profile**. Check your name, library, email and phone.
3. Find **Registration confirmation** and download it. Open the file. Check the library name, registration date and confirmation number.
4. Change a non-sensitive profile field and save. Refresh the page and make sure it stayed saved.
5. Check that **My Software Plan** is a separate menu option.

**Pass:** you can always get the registration file from your profile even if email delivery failed. You do not need to register again.

## 2. My Software Plan

1. Open **My Software Plan**. Note your plan, included seats, expiry, wallet balance and bonus expiry explanation.
2. Open an invoice. Check the total, wallet share, gateway share and GST clearly shown.
3. Download the invoice receipt. Repeat with a browser refresh to ensure it still downloads.
4. Before any real paid payment, a reviewer must verify both provider names and the deliberate selection of Razorpay or PayPal in Super Admin. Do not try a real payment casually.

**Pass:** no payment is deducted twice after a retry. Your plan does not unlock before the payment is properly confirmed. The owner and Super Admin histories agree on the same invoice and payment state.

## 3. Top-up, referral and promotion

1. In an approved test, add a small tested wallet amount. Verify wallet history and a receipt.
2. Check promotional balance first, added-money balance second. Bonus expiry must be visible before redemption.
3. Use a valid referral/promotion code and verify the displayed price before paying.
4. Try a second time: it must not make an extra discount, referral credit or payment.

**Pass:** the invoice shows how the price was calculated. Wallet money cannot be withdrawn, and a zero-priced/free/trial step is not treated as the first paid sign-up.

## 4. Student documents and receipt

1. Open a test student. Add the three document types. Save and refresh.
2. Download each file and compare its content with the file you uploaded.
3. Replace a document if the edit option is available. Only then check its restricted-retention status; do not expect ordinary users to delete records permanently.
4. Record a test fee payment and open its receipt. Download it and verify the student ID, amount, payment date and receipt number.
5. In Messages/delivery status, check whether WhatsApp was actually sent or failed. A failed delivery may be retried; it must never be labelled successful just because a receipt was created.

**Pass:** the right files open for the right student, files do not disappear after refresh, receipt details match the fee record and the real delivery result is visible.

## 5. Support and notices

1. Open Support. Create a ticket using a test message and at least two small safe attachment files. Attachments must not exceed 5 MB each or 8 MB total together.
2. Send an identical reply once; do not repeatedly press send if the screen is waiting. Refresh and check only one message exists.
3. From a test Super Admin account, reply. Log in as the owner again and confirm the reply and ticket number appear.
4. If old tickets exist, search using their old ticket identifier as well as the new global number.
5. Add a staff notice with several attachments. Confirm the owner and test staff receive the same attached files.

**Pass:** no duplicate message, ticket or attachment is made; users see only their own library tickets except authorised support staff; old aliases remain searchable.

## 6. Exact-name deletion and permissions

Do not use a real library without separate approval. Use a temporary test library. The confirmation field must match exactly; incorrect names must not delete. Owner-only profile and billing actions must be rejected for ordinary staff and read-only Super Admin inspection sessions.

## Before approving any production migration

Take and inspect a database backup. The support ticket numbering migration must first be dry-run and its report reviewed, following `docs/support-ticket-numbering-migration.md`. Local fixture tests are not a reason to skip this step.
