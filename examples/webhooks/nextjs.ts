import { verifyWebhook } from 'typedmailer/webhooks';
import { assertWebhookOptions, MAX_BODY_BYTES, webhookErrorStatus, type ResendWebhookOptions } from './shared.js';

class BodyTooLargeError extends Error {}

async function readRawBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Use as POST in a Next.js App Router route with runtime = 'nodejs'. */
export function createResendWebhookHandler(options: ResendWebhookOptions): (request: Request) => Promise<Response> {
  assertWebhookOptions(options);
  return async (request) => {
    try {
      const events = await verifyWebhook({
        provider: 'resend',
        rawBody: await readRawBody(request),
        headers: Object.fromEntries(request.headers),
        webhookSecret: options.webhookSecret,
        maxBodyBytes: MAX_BODY_BYTES,
      });
      // Signature verification above requires and authenticates this delivery ID.
      await options.acceptEvents(events, { deliveryId: request.headers.get('svix-id')! });
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(null, { status: error instanceof BodyTooLargeError ? 413 : webhookErrorStatus(error) });
    }
  };
}
