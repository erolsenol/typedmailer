import { createHmac } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createResendWebhookHandler } from '../examples/webhooks/nextjs.js';
import { createResendWebhookRouter } from '../examples/webhooks/express.js';
import { MAX_BODY_BYTES } from '../examples/webhooks/shared.js';

// Exercise the example package imports against the current source before packaging.
vi.mock('typedmailer/webhooks', () => import('../src/webhooks.js'));

const secret = Buffer.from('local-webhook-secret');
const webhookSecret = `whsec_${secret.toString('base64')}`;
const body =
  '{ "type": "email.delivered", "created_at": "2026-10-04T10:00:00Z", "data": { "email_id": "mail-1", "to": ["reader@example.test"] } }';

function signedHeaders(payload: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`event-1.${timestamp}.${payload}`).digest('base64');
  return {
    'content-type': 'application/json',
    'svix-id': 'event-1',
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

describe('Next.js webhook example', () => {
  it('verifies the exact raw body and awaits durable acceptance before acknowledging', async () => {
    const acceptEvents = vi.fn(async () => undefined);
    const handler = createResendWebhookHandler({ webhookSecret, acceptEvents });
    const response = await handler(
      new Request('https://example.test/api/webhooks/resend', { method: 'POST', body, headers: signedHeaders(body) }),
    );
    expect(response.status).toBe(204);
    expect(acceptEvents).toHaveBeenCalledWith([expect.objectContaining({ type: 'delivered', messageId: 'mail-1' })], {
      deliveryId: 'event-1',
    });
  });

  it('rejects tampered signatures without invoking the event consumer', async () => {
    const acceptEvents = vi.fn(async () => undefined);
    const response = await createResendWebhookHandler({ webhookSecret, acceptEvents })(
      new Request('https://example.test', {
        method: 'POST',
        body: body.replace('mail-1', 'mail-2'),
        headers: signedHeaders(body),
      }),
    );
    expect(response.status).toBe(401);
    expect(acceptEvents).not.toHaveBeenCalled();
  });

  it('rejects oversized streamed bodies even when Content-Length understates the size', async () => {
    const acceptEvents = vi.fn(async () => undefined);
    const response = await createResendWebhookHandler({ webhookSecret, acceptEvents })(
      new Request('https://example.test', {
        method: 'POST',
        body: 'a'.repeat(MAX_BODY_BYTES + 1),
        headers: { 'content-length': '1' },
      }),
    );
    expect(response.status).toBe(413);
    expect(acceptEvents).not.toHaveBeenCalled();
  });

  it('returns a retryable HTTP failure when durable acceptance fails', async () => {
    const response = await createResendWebhookHandler({
      webhookSecret,
      acceptEvents: async () => {
        throw new Error('Inbox unavailable');
      },
    })(new Request('https://example.test', { method: 'POST', body, headers: signedHeaders(body) }));
    expect(response.status).toBe(503);
  });

  it('rejects invalid JSON and invalid signing configuration', async () => {
    const acceptEvents = vi.fn(async () => undefined);
    const response = await createResendWebhookHandler({ webhookSecret, acceptEvents })(
      new Request('https://example.test', {
        method: 'POST',
        body: '{',
        headers: signedHeaders('{'),
      }),
    );
    expect(response.status).toBe(400);
    expect(() => createResendWebhookHandler({ webhookSecret: '', acceptEvents })).toThrow();
  });
});

describe('Express webhook example', () => {
  let server: Server;
  let url: string;
  const acceptEvents = vi.fn(async () => undefined);
  beforeAll(async () => {
    const app = express();
    app.use('/webhooks/resend', createResendWebhookRouter({ webhookSecret, acceptEvents }));
    app.use(express.json());
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
    url = `http://127.0.0.1:${address.port}/webhooks/resend`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('verifies a signed HTTP request before express.json() can reserialize it', async () => {
    acceptEvents.mockClear();
    const response = await fetch(url, { method: 'POST', body, headers: signedHeaders(body) });
    expect(response.status).toBe(204);
    expect(acceptEvents).toHaveBeenCalledOnce();
  });

  it('rejects invalid signatures, excessive bodies, and unsupported content types', async () => {
    acceptEvents.mockClear();
    expect((await fetch(url, { method: 'POST', body: body + ' ', headers: signedHeaders(body) })).status).toBe(401);
    expect(
      (await fetch(url, { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES + 1), headers: signedHeaders(body) })).status,
    ).toBe(413);
    expect((await fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect(acceptEvents).not.toHaveBeenCalled();
  });

  it('returns 503 when the durable inbox is unavailable', async () => {
    acceptEvents.mockRejectedValueOnce(new Error('Inbox unavailable'));
    expect((await fetch(url, { method: 'POST', body, headers: signedHeaders(body) })).status).toBe(503);
  });
});
