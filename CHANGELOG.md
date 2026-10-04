# Changelog

## Unreleased

## 2.1.0 - 2026-10-04

- Preserve authenticated Resend/SNS webhook `deliveryId`, genuine provider `eventId`, and all Resend `recipients` without changing event cardinality or legacy identifiers.
- Correct SES complaint/delay timestamps and enforce recipient limits after fallback; stream SNS certificates with a finite byte limit.
- Deep-copy test mailer captures and keep message IDs unique after clearing captures.
- Expose SMTP accepted/rejected envelope recipients and provider response `status`/`retryAfterSeconds` diagnostics.
- Add optional privacy-safe send observers whose failures do not change delivery results.
- Correct SendGrid inline attachment serialization to use the HTTP `content_id` field.
- Add real SDK serialization and error decoding coverage for every provider, real SMTP partial-rejection tests, and minimum SDK compatibility checks.
- Add PostgreSQL durable webhook inbox/outbox examples with binary attachment storage, tested state transitions, and conservative uncertain-delivery recovery.
- Pin published consumer checks to an exact version and source commit after successful publication, with bounded registry propagation polling.

## 2.0.0 - 2026-10-04

- **Breaking:** Reject unknown built-in provider configuration fields and validate named sender email addresses consistently across production and test mailers.
- **Breaking:** Require `@aws-sdk/client-sesv2 >=3.797.0 <4` so custom headers and attachments survive SDK serialization.
- Encode Resend text and binary attachment content as Base64 before calling its SDK.
- Preserve literal built-in provider names and provider unions in mailer result types.
- Reject blank custom provider message IDs with `deliveryUnknown: true` and correct the documented acceptance contract.
- Add real SDK HTTP serialization regression tests for Resend and SES, including minimum supported SDKs.
- Add tested Next.js App Router and Express webhook examples with raw-body limits and durable acceptance callbacks.
- Add a v2 migration guide describing configuration, attachment encoding, SDK, and type changes.

## 1.4.0 - 2026-09-29

- Preserve `deliveryUnknown` when provider adapters normalize send responses that omit a message ID.
- Add default 1 MiB webhook body and 1,000 event limits, with finite per-request overrides.
- Allow SMTP STARTTLS to be required on any port and document production TLS settings.
- Extend npm provenance polling for registry propagation and report actionable errors after publication.

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
