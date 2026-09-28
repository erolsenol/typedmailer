<p align="center">
  <img src="assets/typedpost-mark.svg" alt="TypedPost" width="72" height="72" />
</p>

<h1 align="center">TypedPost</h1>

<p align="center"><strong>One typed API for sending Node.js email with Resend, Brevo, or SMTP.</strong></p>

<p align="center">
  <a href="https://github.com/erolsenol/typedpost/actions/workflows/ci.yml"><img src="https://github.com/erolsenol/typedpost/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://www.npmjs.com/package/typedpost"><img src="https://img.shields.io/npm/v/typedpost" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/typedpost"><img src="https://img.shields.io/npm/dm/typedpost" alt="monthly npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

TypedPost gives server-side Node.js applications one small, type-safe interface for sending email through Resend, Brevo, or SMTP. Your application keeps ownership of templates, queues, retries, and business rules.

## Install

Install TypedPost and the adapter you plan to use:

```sh
npm install typedpost resend
# or
npm install typedpost @getbrevo/brevo
# or
npm install typedpost nodemailer
```

Requires Node.js 22 or newer. Provider SDKs are optional peers and are loaded only when their adapter is selected.

## Quick start

```ts
import { createMailer } from 'typedpost';

const mailer = createMailer({
  provider: 'resend',
  apiKey: process.env.RESEND_API_KEY!,
  from: 'Example App <noreply@example.com>',
});

const result = await mailer.send({
  to: 'person@example.com',
  subject: 'Welcome',
  text: 'Your account is ready.',
  html: '<p>Your account is ready.</p>',
});

console.log(result.messageId);
await mailer.close();
```

## Providers

### Brevo

```ts
const mailer = createMailer({
  provider: 'brevo',
  apiKey: process.env.BREVO_API_KEY!,
  from: { email: 'hello@example.com', name: 'Example App' },
});
```

### SMTP

```ts
const mailer = createMailer({
  provider: 'smtp',
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: process.env.SMTP_SECURE === 'true',
  ...(process.env.SMTP_USER ? { user: process.env.SMTP_USER } : {}),
  ...(process.env.SMTP_PASSWORD ? { password: process.env.SMTP_PASSWORD } : {}),
  from: 'Local App <local@example.test>',
});
```

For local development, start Mailpit with `docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit`. Messages appear at `http://127.0.0.1:8025`.

## Message options

`to` accepts an email string, a `{ email, name }` object, or an array. Provide `text` or `html` (or both). Optional fields include `from`, `replyTo`, `cc`, `bcc`, `headers`, `attachments`, `metadata`, and `idempotencyKey`; `messageId` is SMTP-only. Attachments may include `contentId` for inline images with Resend and SMTP.

```ts
await mailer.send({
  to: [{ email: 'person@example.com', name: 'Sam' }],
  subject: 'Your receipt',
  text: 'Receipt attached.',
  attachments: [{ filename: 'receipt.txt', content: 'Receipt 123' }],
  idempotencyKey: 'receipt/order-123',
});
```

Provider capabilities differ, so unsupported fields may not behave identically across adapters. TypedPost does not retry sends automatically: after a network timeout the provider may already have accepted the message. Apply retries only when you understand the provider's idempotency guarantees.

## Test your application flow

Use the in-memory adapter to exercise mail flows without contacting a provider:

```ts
import { createTestMailer } from 'typedpost/testing';

const mailer = createTestMailer({ from: 'Test <test@example.test>' });
await mailer.send({ to: 'person@example.test', subject: 'Hello', text: 'Hi' });
console.log(mailer.sent[0]);
```

## Errors and delivery

Provider and transport failures are normalized as `MailError`, with `code`, `provider`, and `retryable` fields. A successful `send()` means the provider accepted the request; it does not confirm inbox delivery. Delivery, bounce, and complaint events require provider webhooks and are outside this package's current scope.

`verifyConnection()` currently supports SMTP. Resend and Brevo do not expose a side-effect-free credential check through these adapters and report an `unsupported` error; verify those credentials with a controlled provider test message.

## Security

- Use TypedPost only in trusted server-side Node.js code. Never expose provider keys in browser or mobile bundles.
- Keep secrets in environment variables or secret managers, not source control.
- TypedPost does not log message content or credentials.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and contribution guidelines.

## Türkçe kısa başlangıç

TypedPost, Node.js sunucu uygulamalarında Resend, Brevo veya SMTP üzerinden e-posta göndermek için ortak ve tip güvenli bir API sunar. Şablonlar, kuyruk ve tekrar deneme politikaları uygulamanızda kalır. Kurulumda kullanacağınız sağlayıcının SDK'sını TypedPost ile birlikte yükleyin. API anahtarlarını yalnızca sunucu ortamında tutun.

## License

MIT © 2026 Erol Senol
