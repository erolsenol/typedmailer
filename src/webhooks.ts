import { WebhookVerificationError } from './webhooks/types.js';
import type { EmailWebhookEvent, VerifyWebhookInput } from './webhooks/types.js';
import {
  verifyAuthorization,
  verifyMailgun,
  verifyResend,
  verifySendGrid,
  verifySnsNotification,
} from './webhooks/signatures.js';
import {
  normalizeMailgun,
  normalizeProviderEvents,
  normalizeResend,
  normalizeSendGrid,
  normalizeSes,
} from './webhooks/normalize.js';

export type { EmailWebhookEvent, EmailWebhookEventType, VerifyWebhookInput, WebhookHeaders } from './webhooks/types.js';
export { WebhookVerificationError } from './webhooks/types.js';

/** Authenticates a provider webhook before returning normalized, typed email events. */
export async function verifyWebhook(input: VerifyWebhookInput): Promise<readonly EmailWebhookEvent[]> {
  const rawBody = Buffer.from(input.rawBody);
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new WebhookVerificationError('invalid_payload');
  }

  switch (input.provider) {
    case 'resend':
      verifyResend(input, rawBody);
      return normalizeResend(payload);
    case 'mailgun':
      verifyMailgun(input, payload);
      return normalizeMailgun(payload);
    case 'sendgrid':
      verifySendGrid(input, rawBody);
      return normalizeSendGrid(payload);
    case 'brevo':
    case 'postmark':
      verifyAuthorization(input, input.authorizationHeader ?? 'authorization');
      return normalizeProviderEvents(input.provider, payload);
    case 'ses':
      return normalizeSes(await verifySnsNotification(input, payload));
  }
}
