# Migrating from v1 to v2

TypedMailer 2 retains the shared `createMailer()` / `send()` API, lazy optional SDK loading, Node.js 22+ support, and AWS credential chain. It tightens configuration contracts and corrects provider attachment serialization.

## Provider SDKs

Amazon SES now requires `@aws-sdk/client-sesv2 >=3.797.0 <4`. Older versions can silently omit `Simple.Headers` and `Simple.Attachments` when serializing requests. Upgrade your installed SDK and lockfile:

```sh
npm install typedmailer@^2 @aws-sdk/client-sesv2@^3.797.0
```

Other provider SDK peer ranges are unchanged. Install only the SDKs your application uses.

## Configuration validation

Built-in provider options now reject unknown keys, matching custom provider configuration and message validation. Pass only the documented fields rather than spreading an application-wide configuration object. For example, a misspelled `apiToken` is rejected rather than ignored.

Named senders such as `App <sender@example.com>` validate the enclosed email address using the same validation as plain and object addresses. `App <a@b>`, blank display names in named strings, and line breaks in display names are rejected. The configured sender is validated immediately in `createTestMailer()` as well as `createMailer()`. Valid email strings and `{ email, name }` objects remain supported. Validation failures remain Zod errors; transport failures remain `MailError` instances.

## Attachments

Attachment strings represent UTF-8 file content for every adapter; `Uint8Array` represents raw bytes. The Resend adapter now Base64-encodes both forms before calling its SDK. If you worked around the v1 Resend behavior by supplying a Base64 string, pass the original text or `Buffer.from(encodedContent, 'base64')` instead. Pre-encoded strings would otherwise be encoded a second time.

`maxAttachmentBytes` still measures original content bytes, before provider Base64 encoding. Attachments remain buffered; streaming, upload storage, and concurrency budgets belong to the application.

## Result types and custom adapters

`createMailer({ provider: 'resend', ... })` now returns `Mailer<'resend'>`. A union of provider options preserves that union. Built-in results no longer include the impossible `'test'` provider; `createTestMailer()` still returns `Mailer<'test'>`. Broader explicit `Mailer` / `SendMailResult` annotations remain valid.

Every successful send must have a non-blank provider message ID. Custom adapters must return `{ messageId: 'provider-id' }`. Blank, missing, or invalid IDs reject with `MailError`, code `provider`, and `deliveryUnknown: true`, matching built-in adapters. Do not blindly retry such sends: the provider may already have accepted the email.

## Webhook routes

The webhook API is unchanged. New [Next.js and Express examples](framework-webhooks.md) demonstrate raw-body preservation, bounded reads, and acknowledging only after the application durably accepts events. They do not install a database or implement business side effects.
