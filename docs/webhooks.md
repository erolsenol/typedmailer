# Verifying and normalizing email webhooks

TypedMailer exposes `verifyWebhook()` from `typedmailer/webhooks`. It authenticates a raw HTTP webhook request before returning normalized event records. It does not start an HTTP server, acknowledge requests, persist event IDs, or perform application actions. Your route owns HTTP responses, durable deduplication, and business logic.

## Raw request bodies

Pass the exact bytes received by your HTTP framework. Parsing JSON and serializing it again changes the signed input and causes verification to fail. `rawBody` accepts a string or `Uint8Array`; `headers` is a case-insensitive record of request header names and values.

## Authentication configuration

| Provider   | Verification input                                 | Provider requirements                                                                                                                                         |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend     | `webhookSecret`                                    | The endpoint `whsec_...` signing secret; Svix headers are checked and timestamps older than five minutes are rejected by default.                             |
| Mailgun    | `signingKey`                                       | The account webhook signing key; the signed timestamp and token are checked with HMAC-SHA256 and a five-minute default freshness window.                      |
| SendGrid   | `publicKey`                                        | The Event Webhook ECDSA public key; signature and timestamp headers are verified against the exact raw body.                                                  |
| Brevo      | `authorization` and optional `authorizationHeader` | Configure a custom header or bearer token in Brevo. Brevo does not sign event payloads cryptographically.                                                     |
| Postmark   | `authorization` and optional `authorizationHeader` | Configure HTTPS Basic Authentication for the webhook URL. Postmark does not sign webhook payloads.                                                            |
| Amazon SES | `topicArn`                                         | SNS Notification envelope signatures and expected topic ARN are checked. SNS signing certificates are fetched only from the matching regional SNS HTTPS host. |

For providers without signed payloads, protect the endpoint with HTTPS and the provider's configured authentication. Do not treat an IP allowlist as the only control unless you can keep it current. SMTP has no provider webhook adapter.

## Example: Resend

```ts
import { verifyWebhook } from 'typedmailer/webhooks';

const events = await verifyWebhook({
  provider: 'resend',
  rawBody: requestBody, // exact bytes or string from the incoming request
  headers: requestHeaders,
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
});

for (const event of events) {
  if (event.type === 'bounced' && event.messageId) {
    await markMessageBounced(event.messageId);
  }
}
```

## Normalized event shape

Each event includes `provider`, provider `eventType`, a normalized `type`, and the original provider payload in `raw`. When available, it also includes a provider event ID, message ID, recipient, and event timestamp. `raw` may contain personal data and provider metadata; avoid logging it without review. Unknown provider event names map to `type: 'other'` and retain their original `eventType`.

Normalized types are `accepted`, `delivered`, `bounced`, `complained`, `delayed`, `opened`, `clicked`, `unsubscribed`, `rejected`, `failed`, and `other`.

## Delivery, retries, and deduplication

Providers retry webhook delivery. `verifyWebhook()` verifies authenticity but does not prevent the same authentic event from being processed twice. Persist event IDs (or a stable provider/message/event key when the provider has no event ID) with a unique constraint before applying side effects. Acknowledge only after durable acceptance by your application. Do not log secrets or full event payloads by default.

## Provider references

- [Resend webhook verification](https://resend.com/docs/webhooks/introduction)
- [Mailgun securing webhooks](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks)
- [SendGrid signed Event Webhooks](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)
- [Brevo secure webhook calls](https://developers.brevo.com/docs/secured-webhooks)
- [Postmark webhooks](https://postmarkapp.com/developer/webhooks/webhooks-overview)
- [Amazon SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html)
