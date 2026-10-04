# Reliable application delivery

TypedMailer reports provider acceptance, not inbox delivery. It performs no automatic retry, queueing, database migration, or failover. Version 2.1 adds optional SMTP recipient results, structured provider errors, authenticated webhook notification IDs, and isolated send observers.

## SMTP partial acceptance

```ts
const result = await mailer.send(message);
if (result.rejected?.length) {
  await recordPartialAcceptance(result);
}
```

SMTP `accepted` and `rejected` contain envelope recipient addresses reported by the relay, including CC/BCC. A send with some rejected recipients still resolves when the relay accepts the remaining recipients. Do not retry the entire original message: recipients already accepted could receive duplicates. When every recipient is rejected, the SMTP adapter rejects. These fields are optional for other and custom providers. Treat the recipient lists as personal data.

## Error diagnostics and observations

`MailError.status` contains the HTTP or SMTP response status when the SDK exposes it. `retryAfterSeconds` contains an optional parsed `Retry-After` delay, rounded up to whole seconds; unsupported/malformed delays remain undefined. These values do not override `deliveryUnknown` or make a retry safe. The original SDK error remains in `cause` and can contain sensitive information.

```ts
const mailer = createMailer({
  provider: 'resend',
  apiKey,
  from: 'sender@example.test',
  onSend(event) {
    if (event.type === 'started') return;
    metrics.record(event.provider, event.type, event.durationMs);
    if (event.type === 'failed') metrics.recordFailure(event.code);
  },
});
```

`onSend` emits `started` followed by `succeeded` or `failed` for a validated send that reaches provider execution. Payloads contain provider, duration, and safe error classifications, never addresses, subject, content, headers, credentials, or arbitrary SDK errors. Construction/message validation failures and calls after close do not emit send events. Observer exceptions and rejected promises are ignored deliberately. Async observers are not awaited by `send()` or `close()`; applications own flushing and error reporting for their telemetry. Keep synchronous callbacks short. No telemetry dependency is installed by the package.

## Durable webhook inbox

Copy [`durable-mail.ts`](../examples/reliability/durable-mail.ts) and [`schema.sql`](../examples/reliability/schema.sql) into your application. Supply a `SqlDatabase` adapter for your PostgreSQL client. `acceptWebhookDelivery` inserts one complete notification with a unique `(provider, delivery_id)` constraint. Use it from the framework handler's `acceptEvents` callback and resolve only after database commit. A storage failure must return a retryable HTTP failure, not an acknowledgment.

For Resend and SES, `verifyWebhook()` provides an authenticated `deliveryId`. It identifies the whole notification; SES can produce multiple recipient events sharing this ID. Store the complete event array once, then apply business changes in a transaction with an inbox processing marker. Do not deduplicate each recipient separately using only `deliveryId`. For other providers, use genuine `eventId` values where present, or an application-defined provider-specific key. The legacy `id` can equal a message ID and must not be assumed unique across delivery/open/bounce events. Do not invent an unsigned delivery ID from a request header.

The supplied inbox schema stores normalized events including `raw`. Define retention, access controls, encryption, and any payload redaction in your application. Processing markers and business transactions depend on your domain and are not implemented by this example.

## Transactional outbox

`enqueueMail` uses a stable business-operation ID to prevent duplicate queue entries. Validate the message first and call it in the same database transaction as the business change. Apply `schema.sql` using your application's migration process. The adapter passed to enqueue can represent an open transaction; worker and inbox adapters must commit before reporting success. Binary attachments are encoded explicitly for JSON storage and restored as `Uint8Array`.

`createSqlOutboxStore` claims one queued row with `FOR UPDATE SKIP LOCKED`, committing `sending` before network I/O. `processNextMail` sends once and records one of these states:

| State      | Meaning and next action                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `accepted` | Provider accepted the request. Follow delivery webhooks separately.                                  |
| `partial`  | SMTP rejected some recipients. Reconcile the rejected subset.                                        |
| `failed`   | Classified rejection with no uncertain acceptance. Application policy decides whether to requeue.    |
| `unknown`  | Acceptance cannot be established. Reconcile with the provider before resending.                      |
| `sending`  | Claimed, but no outcome persisted yet. A worker crash or failed receipt commit can leave this state. |

The example deliberately does not reclaim stale `sending` rows automatically. Reconcile them and move to `unknown` when acceptance cannot be proven. A failed receipt commit propagates to the worker; it never reclassifies an accepted send as a failure. Use provider idempotency only where supported and keep the key stable across retries. Never resend the whole partial/unknown job automatically.

Tests run the SQL against embedded PostgreSQL (PGlite), verify deduplication and state transitions, and exercise database failure paths. Production database concurrency, migrations, worker deployment, provider delivery, and operational recovery require application-level verification.
