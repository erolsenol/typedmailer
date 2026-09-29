# Changelog

## 1.1.0 - Unreleased

- Removed the non-English README section for a consistent English-language package experience.
- Added provider webhook authentication and normalized event types for Resend, Mailgun, SendGrid, Brevo, Postmark, and Amazon SES/SNS.
- Added release-time verification that the published npm package has a provenance attestation.
- Added a non-blocking Node.js 26 compatibility canary.

## 1.0.0 - 2026-09-29

- Corrected provider result types for all supported sending adapters and test adapter results.
- Added matching runtime validation to the test mailer and defined close lifecycle behavior.
- Distinguished retry guidance from uncertain message acceptance and documented normalized errors.
- Added minimum SDK compatibility checks, release version preflight, boundary tests, and runnable examples.

## 0.1.0 - 2026-09-28

- Initial development release with Resend, Brevo, SMTP, and in-memory test adapters.
- Added Postmark and SendGrid email providers.
- Added Mailgun and Amazon SES providers.
