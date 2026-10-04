# Next.js and Express webhook routes

The repository includes TypeScript Resend webhook examples in `examples/webhooks/`. Copy the appropriate adapter and `shared.ts` into your application. These files are examples, not new package exports; they depend on `typedmailer/webhooks`, and the Express adapter additionally needs `express` and its TypeScript types.

Both examples preserve the exact signed request bytes, limit the raw body to 1 MiB, authenticate with the endpoint signing secret, and await `acceptEvents()` before returning HTTP 204. Implement that callback with a durable inbox or queue: store a stable provider event key under a unique constraint and commit atomically. Duplicate deliveries should resolve successfully after confirming the prior durable acceptance. The callback's second argument supplies `deliveryId` from Resend's authenticated `svix-id` header; use it with the provider name as an inbox uniqueness key. Normalized event IDs are optional. Keep business processing in your worker.

The examples return 400 for malformed event payloads, 401 for failed signatures, 413 for oversized bodies, and 503 for acceptance failures. The Express adapter also returns 415 for unsupported content types or compressed requests. Upstream proxies and hosting platforms should enforce matching request-size and timeout limits.

## Next.js App Router

Copy `nextjs.ts` and `shared.ts` into `lib/webhooks/`, then create `app/api/webhooks/resend/route.ts`:

```ts
import { createResendWebhookHandler } from '@/lib/webhooks/nextjs';
import { acceptEmailEvents } from '@/lib/email-event-inbox';

export const runtime = 'nodejs';

const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error('RESEND_WEBHOOK_SECRET is required.');

export const POST = createResendWebhookHandler({
  webhookSecret,
  acceptEvents: acceptEmailEvents,
});
```

`acceptEmailEvents` is your application's durable ingestion function. It receives `readonly EmailWebhookEvent[]` and `{ deliveryId: string }`, and resolves after the transaction or durable queue write succeeds. The adapter uses a standard Web `Request` and `Response`, so it does not need to import Next.js. Its streaming reader checks actual received bytes even when `Content-Length` is absent or inaccurate.

## Express

Copy `express.ts` and `shared.ts` into your application, then mount the router before the global JSON parser:

```ts
import express from 'express';
import { createResendWebhookRouter } from './webhooks/express.js';
import { acceptEmailEvents } from './email-event-inbox.js';

const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error('RESEND_WEBHOOK_SECRET is required.');

const app = express();
app.use(
  '/webhooks/resend',
  createResendWebhookRouter({
    webhookSecret,
    acceptEvents: acceptEmailEvents,
  }),
);
app.use(express.json());
app.listen(3000);
```

Do not mount `express.json()` before the webhook router. Parsed and reserialized JSON does not preserve the signed bytes. The route uses `express.raw()` with a finite byte limit and disables decompression to retain the exact raw input.

## Verification

`tests/webhook-examples.test.ts` exercises signed and tampered requests, body limits, invalid JSON, and failed durable acceptance. Express tests use an ephemeral local HTTP server. SDK and webhook tests never send real emails. CI separately verifies SMTP through Mailpit.

References: [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [Express raw parser](https://expressjs.com/en/5x/api.html#express.raw), and [Resend webhook verification](https://resend.com/docs/webhooks/introduction).
