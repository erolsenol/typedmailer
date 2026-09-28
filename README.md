# Mailbridge

**One small TypeScript API for sending server-side email through Resend, Brevo, or SMTP.**

Mailbridge standardizes message input, configuration errors, and provider results. Your application keeps ownership of templates, queues, retries, and business rules.

> Early development: `0.1.0`. The public API may change before `1.0.0`.
>
> **npm publication is pending.** Until the first npm release, install from GitHub with `npm install github:erolsenol/mailbridge#main resend` (or replace `resend` with `@getbrevo/brevo` or `nodemailer`).

## Install (after npm publication)

Install Mailbridge and the adapter you plan to use:

```sh
npm install @erolsenol/mailbridge resend
# or
npm install @erolsenol/mailbridge @getbrevo/brevo
# or
npm install @erolsenol/mailbridge nodemailer
```

## Quick start: Resend

```ts
import { createMailer } from '@erolsenol/mailbridge';

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

### SMTP (including Mailpit for local development)

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

Start Mailpit with `docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit`. Messages appear in its local web inbox at `http://127.0.0.1:8025`.

## Sending options

`to` accepts an email string, a `{ email, name }` object, or an array. `text` or `html` is required. Optional fields include `from`, `replyTo`, `cc`, `bcc`, `headers`, `attachments`, `metadata`, and `idempotencyKey`. Attachments may include `contentId` for inline images with Resend and SMTP.

```ts
await mailer.send({
  to: [{ email: 'person@example.com', name: 'Sam' }],
  subject: 'Your receipt',
  text: 'Receipt attached.',
  attachments: [{ filename: 'receipt.txt', content: 'Receipt 123' }],
  idempotencyKey: 'receipt/order-123',
});
```

Provider capabilities differ. Unsupported fields are not guaranteed to have identical behavior across adapters. Mailbridge does not automatically retry sends: after a network timeout the provider may already have accepted the message. Use application-level retry only when you understand the provider's idempotency guarantees.

## Testing application flows

```ts
import { createTestMailer } from '@erolsenol/mailbridge/testing';

const mailer = createTestMailer({ from: 'Test <test@example.test>' });
await mailer.send({ to: 'person@example.test', subject: 'Hello', text: 'Hi' });
console.log(mailer.sent[0]);
```

The test mailer stores messages in memory and never connects to a provider.

## Errors and delivery semantics

Provider and transport failures are normalized as `MailError`, with `code`, `provider`, and `retryable` fields. `send()` returning means the provider accepted the request; it does **not** prove inbox delivery. Delivery, bounce, and complaint events require provider webhooks and are outside this package's current scope.

`verifyConnection()` currently supports SMTP. Resend and Brevo do not expose a side-effect-free credential check through these adapters and report an `unsupported` error; verify those credentials by sending a controlled provider test message.

## Security

- Use only in trusted server-side Node.js code. Never expose provider keys in browser or mobile bundles.
- Keep secrets in environment/secret managers, not source control.
- Mailbridge does not log message content or credentials.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Türkçe kısa başlangıç

Mailbridge, Node.js sunucu uygulamalarında Resend, Brevo veya SMTP üzerinden e-posta göndermek için ortak ve tip güvenli bir API sunar. Şablonlar, kuyruklar ve tekrar deneme politikaları uygulamanızda kalır. Kurulum için kullanacağınız sağlayıcının SDK'sını Mailbridge ile birlikte yükleyin. API anahtarlarını yalnızca sunucu ortamında tutun.

## License

MIT
