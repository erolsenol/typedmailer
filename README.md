<p align="center">
  <img src="assets/typedmailer-mark.svg" alt="TypedMailer" width="72" height="72" />
</p>

<h1 align="center">TypedMailer: TypeScript Email Sending for Node.js</h1>

<p align="center"><strong>One typed API for sending Node.js email with seven providers.</strong></p>

<p align="center">
  <a href="https://github.com/erolsenol/typedmailer/actions/workflows/ci.yml"><img src="https://github.com/erolsenol/typedmailer/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://www.npmjs.com/package/typedmailer"><img src="https://img.shields.io/npm/v/typedmailer" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/typedmailer"><img src="https://img.shields.io/npm/dm/typedmailer" alt="monthly npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

TypedMailer is a type-safe email library for Node.js and TypeScript applications. It gives server-side code one API for sending transactional email with Resend, Brevo, Postmark, SendGrid, Mailgun, Amazon SES, or SMTP. Your application keeps ownership of templates, queues, retries, and business rules.

Use TypedMailer when you want to switch email providers without coupling application code to a provider SDK. Provider SDKs are optional peer dependencies, and only the selected adapter is loaded.

## Install

Install the `typedmailer` npm package with the provider SDK you plan to use:

```sh
npm install typedmailer resend
# or
npm install typedmailer @getbrevo/brevo
# or
npm install typedmailer nodemailer
# or
npm install typedmailer postmark
# or
npm install typedmailer @sendgrid/mail
# or
npm install typedmailer mailgun.js form-data
# or
npm install typedmailer @aws-sdk/client-sesv2
```

Requires Node.js 22 or newer. Provider SDKs are optional peers and are loaded only when their adapter is selected.

Supported runtime and release guarantees are documented in [`SUPPORT.md`](SUPPORT.md). Provider behavior guarantees and their test coverage are described in [`docs/provider-contracts.md`](docs/provider-contracts.md). The scheduled and manual provider smoke workflow is documented in [`docs/integration-testing.md`](docs/integration-testing.md).

TypedMailer is for trusted server-side Node.js runtimes. It is not intended for browser or mobile client bundles.

## Quick start

```ts
import { createMailer } from 'typedmailer';

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

TypedMailer supports these email providers through the same `createMailer` and `send` API:

- **Resend** for API-based email delivery.
- **Brevo** for API-based email delivery.
- **Postmark** for API-based email delivery.
- **SendGrid** for API-based email delivery.
- **Mailgun** for API-based email delivery in US or EU regions.
- **Amazon SES** for API-based email delivery using AWS credentials.
- **SMTP** for compatible SMTP services and local development servers such as Mailpit.

### Brevo

```ts
const mailer = createMailer({
  provider: 'brevo',
  apiKey: process.env.BREVO_API_KEY!,
  from: { email: 'hello@example.com', name: 'Example App' },
});
```

### Postmark

Use your Postmark server token as `apiKey`:

```ts
const mailer = createMailer({
  provider: 'postmark',
  apiKey: process.env.POSTMARK_SERVER_TOKEN!,
  from: 'Example App <noreply@example.com>',
});
```

### SendGrid

```ts
const mailer = createMailer({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY!,
  from: 'Example App <noreply@example.com>',
});
```

### Mailgun

Mailgun requires a sending domain and API key. Set `region` to `'eu'` for an EU account; it defaults to `'us'`.

```ts
const mailer = createMailer({
  provider: 'mailgun',
  apiKey: process.env.MAILGUN_API_KEY!,
  domain: process.env.MAILGUN_DOMAIN!,
  region: 'eu',
  from: 'Example App <noreply@example.com>',
});
```

### Amazon SES

SES requires a region and uses the AWS SDK credential provider chain, such as environment credentials, a shared profile, or an IAM role.

```ts
const mailer = createMailer({
  provider: 'ses',
  region: process.env.AWS_REGION!,
  from: 'Example App <noreply@example.com>',
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

`to` accepts an email string, a `{ email, name }` object, or an array. Provide `text` or `html` (or both). Optional fields include `from`, `replyTo`, `cc`, `bcc`, `headers`, `attachments`, `metadata`, and `idempotencyKey`; `messageId` is SMTP-only. Attachments may include `contentId` for inline images with Resend, Postmark, SendGrid, Mailgun, Amazon SES, and SMTP. Attachment content accepts strings or `Uint8Array`; the provider adapters buffer it for SDK requests, so use an application-managed upload or streaming workflow for large files.

Subjects and attachment filenames cannot be blank. Supplied content types and inline content IDs must be non-empty. The library does not impose a fixed attachment-size limit.

Provider capabilities differ. Unsupported fields return a `MailError` with code `unsupported` instead of being silently ignored.

| Provider   | Custom `messageId` | `idempotencyKey` | Metadata | Inline attachments | `verifyConnection()` |
| ---------- | ------------------ | ---------------- | -------- | ------------------ | -------------------- |
| Resend     | No                 | Yes              | Yes      | Yes                | Unsupported          |
| Brevo      | No                 | No               | Yes      | No                 | Unsupported          |
| Postmark   | No                 | No               | Yes      | Yes                | Unsupported          |
| SendGrid   | No                 | No               | Yes      | Yes                | Unsupported          |
| Mailgun    | No                 | No               | Yes      | Yes                | Unsupported          |
| Amazon SES | No                 | No               | Yes      | Yes                | Unsupported          |
| SMTP       | Yes                | No               | No       | Yes                | Yes                  |

```ts
await mailer.send({
  to: [{ email: 'person@example.com', name: 'Sam' }],
  subject: 'Your receipt',
  text: 'Receipt attached.',
  attachments: [{ filename: 'receipt.txt', content: 'Receipt 123' }],
  idempotencyKey: 'receipt/order-123',
});
```

TypedMailer does not retry sends automatically: after a network timeout the provider may already have accepted the message. Apply retries only when you understand the provider's idempotency guarantees.

## Test your application flow

Use the in-memory adapter to exercise mail flows without contacting a provider:

```ts
import { createTestMailer } from 'typedmailer/testing';

const mailer = createTestMailer({ from: 'Test <test@example.test>' });
await mailer.send({ to: 'person@example.test', subject: 'Hello', text: 'Hi' });
console.log(mailer.sent[0]);
```

Messages captured by `createTestMailer` return `provider: 'test'` so test results are not mistaken for SMTP deliveries.

## Runnable examples

The repository includes complete Resend, Amazon SES, and local SMTP/Mailpit examples in [`examples/`](examples/). From a clone, copy `examples/.env.example` to `.env`, replace the example sender and recipient with addresses valid for your account, then install the SDK for the chosen provider:

```sh
npm install typedmailer resend
node --env-file=.env examples/resend.mjs
```

For Amazon SES, run `npm install typedmailer @aws-sdk/client-sesv2 && node --env-file=.env examples/ses.mjs`; credentials come from the standard AWS SDK credential provider chain. For local SMTP, start Mailpit with `docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit`, then run `npm install typedmailer nodemailer && node --env-file=.env examples/smtp-mailpit.mjs`. View captured messages at `http://127.0.0.1:8025`.

## Errors and delivery

Provider and transport failures are normalized as `MailError`, with `code`, `provider`, `retryable`, `deliveryUnknown`, and the original error in `cause`. Codes mean:

| Code             | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `configuration`  | Invalid setup, missing optional SDK, or use after close.              |
| `authentication` | The provider rejected credentials or access.                          |
| `rate_limit`     | The provider throttled the request.                                   |
| `network`        | A recognized connection or timeout failure occurred.                  |
| `provider`       | The provider returned another failure or an invalid response.         |
| `unsupported`    | The selected adapter cannot represent a requested field or operation. |

`retryable` is guidance from the normalized failure: recognized network failures and rate limits are retryable; API provider 5xx failures are retryable; authentication, configuration, unsupported, and SMTP 5xx failures are not. `deliveryUnknown` is separate: it is true when a send timeout/socket interruption, a provider 5xx, or an accepted response without a message ID means the provider may have accepted the message without returning a clear result. It stays false for verification failures, DNS lookup failures, authentication errors, rate limits, and SMTP response errors. This does not guarantee that retrying is safe. Use provider-supported idempotency where available and apply retry policy in your application. `cause` retains the original SDK error for diagnostics and can contain provider details; avoid logging it without reviewing your data handling policy.

A successful `send()` means the provider accepted the request; it does not confirm inbox delivery. Verify delivery, bounce, and complaint callbacks with [`typedmailer/webhooks`](docs/webhooks.md).

`verifyConnection()` currently supports SMTP. API provider adapters report `unsupported` because they do not expose a side-effect-free credential check through this API; verify credentials with a controlled provider test message.

`close()` is idempotent. It rejects new sends and verification calls, waits for operations already in progress, and closes the provider transport at most once. Reuse requires creating a new mailer.

## Security

- Use TypedMailer only in trusted server-side Node.js code. Never expose provider keys in browser or mobile bundles.
- Keep secrets in environment variables or secret managers, not source control.
- TypedMailer does not log message content or credentials.
- See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and contribution guidelines.

After cloning, run `npm ci` to install dependencies and enable the local Git hooks. Commits run staged-file lint and format checks plus unit tests. Pushes run the full `npm run check` quality gate, including an isolated npm tarball consumer smoke test; GitHub Actions runs it on Node.js 22 and 24 and audits dependencies before merge and publish.

## License

MIT © 2026 Erol Senol
