# Changelog

## Unreleased

## 1.3.0 - 2026-09-29

- Added the public `ProviderAdapter` API so applications can integrate custom email services with typed provider-name results.
- Split built-in provider adapter contract tests into per-provider files and added sanitized error-shape fixtures.
- Added an optional `maxBodyBytes` check that rejects oversized webhook payloads before JSON parsing.
- Aligned `MailAddress` optional-name typing with the runtime schema and removed redundant address casts.

## 1.2.0 - 2026-09-29

- Added an optional aggregate `maxAttachmentBytes` guard that measures UTF-8 text and binary attachment bytes before loading the provider.
- Moved provider schemas and lazy adapter loading into a dedicated registry module to make provider additions easier to maintain.
- Split webhook contracts, signature verification, shared parsing helpers, and event normalization into focused modules.
- Made CI derive minimum provider SDK install versions from `peerDependencies`, with a check that development and peer ranges match.

## 1.1.0 - 2026-09-29

- Removed the non-English README section for a consistent English-language package experience.
- Added provider webhook authentication and normalized event types for Resend, Mailgun, SendGrid, Brevo, Postmark, and Amazon SES/SNS.
- Added release-time verification that the published npm package has a provenance attestation.
- Added a non-blocking Node.js 26 compatibility canary.
- Added a first-message Mailpit quick start and CI integration coverage that verifies the captured message through Mailpit's API.
- Added positive and tampered-message SES/SNS signature verification coverage.

## 1.0.0 - 2026-09-29

- Corrected provider result types for all supported sending adapters and test adapter results.
- Added matching runtime validation to the test mailer and defined close lifecycle behavior.
- Distinguished retry guidance from uncertain message acceptance and documented normalized errors.
- Added minimum SDK compatibility checks, release version preflight, boundary tests, and runnable examples.

## 0.1.0 - 2026-09-28

- Initial development release with Resend, Brevo, SMTP, and in-memory test adapters.
- Added Postmark and SendGrid email providers.
- Added Mailgun and Amazon SES providers.
