import express, { type ErrorRequestHandler, type Router } from 'express';
import { verifyWebhook } from 'typedmailer/webhooks';
import { assertWebhookOptions, MAX_BODY_BYTES, webhookErrorStatus, type ResendWebhookOptions } from './shared.js';

/** Mount before express.json() so signed requests retain their exact bytes. */
export function createResendWebhookRouter(options: ResendWebhookOptions): Router {
  assertWebhookOptions(options);
  const router = express.Router();
  router.post(
    '/',
    express.raw({ type: 'application/json', limit: MAX_BODY_BYTES, inflate: false }),
    async (request, response) => {
      const body: unknown = request.body;
      if (!Buffer.isBuffer(body)) {
        response.sendStatus(415);
        return;
      }
      try {
        const events = await verifyWebhook({
          provider: 'resend',
          rawBody: body,
          headers: request.headers,
          webhookSecret: options.webhookSecret,
          maxBodyBytes: MAX_BODY_BYTES,
        });
        // Signature verification above requires and authenticates this delivery ID.
        await options.acceptEvents(events, { deliveryId: request.get('svix-id')! });
        response.sendStatus(204);
      } catch (error) {
        response.sendStatus(webhookErrorStatus(error));
      }
    },
  );
  const handleBodyError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.too.large') {
        response.sendStatus(413);
        return;
      }
      if (error.type === 'encoding.unsupported') {
        response.sendStatus(415);
        return;
      }
    }
    next(error);
  };
  router.use(handleBodyError);
  return router;
}
