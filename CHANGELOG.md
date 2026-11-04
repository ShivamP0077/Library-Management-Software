# Changelog

## 2026-11-04 (IST)

- **WhatsApp admission receipts no longer skipped for new students** ([PR #23](https://github.com/ShivamP0077/Library-Management-Software/pull/23), commit [`c511374`](https://github.com/ShivamP0077/Library-Management-Software/commit/c511374)).
  When a student was admitted, the payment was saved a moment before the student, so the receipt check found no phone number and quietly gave up. The server now waits up to about 15 seconds for the student, and saving new students also sends any receipt still waiting for them (never twice). Every skipped message is now logged with a reason (no student, no phone, disabled, no consent, invalid number).
- **WhatsApp settings: clear sign-in message in Local Offline Mode** ([PR #22](https://github.com/ShivamP0077/Library-Management-Software/pull/22), commit [`b18a822`](https://github.com/ShivamP0077/Library-Management-Software/commit/b18a822)).
  The WhatsApp card showed a red "Authentication required" error with a Retry button and never offered a QR code. The app was running in Local Offline Mode, which has no cloud session token, so the backend rejected the WhatsApp call with 401. The Evolution API itself works. The card now tells the user to tap "Connect / Sign In" and sign in first, instead of calling the API and showing a confusing error.
