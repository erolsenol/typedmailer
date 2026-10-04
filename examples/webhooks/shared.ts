import { WebhookVerificationError, type EmailWebhookEvent } from 'typedmailer/webhooks';

export const MAX_BODY_BYTES = 1_048_576;

export interface ResendWebhookDelivery {
  readonly deliveryId: string;
}

export interface ResendWebhookOptions {
  readonly webhookSecret: string;
  /** Resolve only after committing the events to a durable, deduplicating inbox or queue. */
  readonly acceptEvents: (events: readonly EmailWebhookEvent[], delivery: ResendWebhookDelivery) => Promise<void>;
}

export function assertWebhookOptions(options: ResendWebhookOptions): void {
  if (!options.webhookSecret.startsWith('whsec_') || options.webhookSecret.length <= 6) {
    throw new Error('Configure a Resend endpoint signing secret.');
  }
}

export function webhookErrorStatus(error: unknown): number {
  if (error instanceof WebhookVerificationError) return error.code === 'invalid_payload' ? 400 : 401;
  return 503;
}
