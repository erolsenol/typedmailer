# Provider behavior contracts

The adapters provide one `createMailer(...).send(...)` interface, while provider APIs differ. This page records the behavior callers may rely on. The capability table in the README is the quick reference; built-in adapter contract tests are organized by provider under `tests/providers/`.

## Shared guarantees

- Provider SDKs are optional peers. Only the selected adapter is loaded, and a missing selected SDK becomes a `MailError` with code `configuration`.
- `send()` resolves when the provider reports that it accepted the request. It does not prove inbox delivery.
- A successful result includes the selected provider, provider message ID, and local acceptance timestamp. If the provider gives no ID, `messageId` is an empty string.
- TypedMailer does not retry automatically. `retryable` and `deliveryUnknown` are diagnostic signals, not a safe retry instruction. A timeout or ambiguous provider response can mean the provider accepted the message.
- Unsupported fields or operations fail with `MailError` code `unsupported`; adapters must not silently discard caller data.
- `close()` is safe to call repeatedly, stops new work, waits for in-flight operations, and closes the underlying transport at most once.

## Capability map

| Provider   | Custom message ID | Idempotency key | Metadata | Inline attachments | Connection verification |
| ---------- | ----------------- | --------------- | -------- | ------------------ | ----------------------- |
| Resend     | No                | Yes             | Yes      | Yes                | Unsupported             |
| Brevo      | No                | No              | Yes      | No                 | Unsupported             |
| Postmark   | No                | No              | Yes      | Yes                | Unsupported             |
| SendGrid   | No                | No              | Yes      | Yes                | Unsupported             |
| Mailgun    | No                | No              | Yes      | Yes                | Unsupported             |
| Amazon SES | No                | No              | Yes      | Yes                | Unsupported             |
| SMTP       | Yes               | No              | No       | Yes                | SMTP connection check   |

Attachments are buffered for provider SDK requests. Configure `maxAttachmentBytes` on `createMailer()` to enforce an aggregate byte cap over all attachment content; strings are counted as UTF-8 bytes and `Uint8Array` content by `byteLength`. The option has no default cap to preserve existing behavior. Large-file streaming belongs in the application. `contentId` is supported by the providers listed as supporting inline attachments. `verifyConnection()` is only available for SMTP because the API providers do not offer a side-effect-free check through this interface.

## Updating a provider adapter

When changing an adapter, add its configuration schema and lazy loader in `src/providers/registry.ts`, keep its implementation in `src/providers/<provider>.ts`, and update the README capability table and this contract if caller-visible behavior changes. Add or adjust adapter tests for the provider payload, unsupported fields, returned message ID, and error normalization. Keep provider SDK versions within the declared peer range and verify both the locked SDK and minimum supported SDK set. CI derives the minimum-version install list from each peer range's explicit lower bound so the support metadata and compatibility check stay aligned.

## Custom adapters

Applications can provide a `ProviderAdapter<TName>` directly to `createMailer()` without adding a built-in provider. Its `send()` method receives `NormalizedMailInput`: `from` is always set, and `to`, `cc`, and `bcc` are arrays when present. Resolve with `{ messageId }` after the SDK accepts the message. `verifyConnection()` and `close()` are optional; verification rejects with `unsupported` when omitted, while close is a no-op. TypedMailer normalizes thrown errors and tags results with the adapter's name. The generic adapter name is preserved in `SendMailResult<TName>` for TypeScript callers. Custom adapters are responsible for documenting and enforcing unsupported message fields.
