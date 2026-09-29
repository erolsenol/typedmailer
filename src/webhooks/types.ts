export type ProviderName = import('../types.js').ProviderName;

export type EmailWebhookEventType =
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'delayed'
  | 'opened'
  | 'clicked'
  | 'unsubscribed'
  | 'rejected'
  | 'failed'
  | 'other';

export interface EmailWebhookEvent {
  readonly provider: Exclude<ProviderName, 'smtp'>;
  readonly id?: string;
  readonly type: EmailWebhookEventType;
  readonly eventType: string;
  readonly messageId?: string;
  readonly recipient?: string;
  readonly occurredAt?: Date;
  /** Original provider data. It can contain message metadata and personal information. */
  readonly raw: unknown;
}

export type WebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

interface RawWebhookInput {
  readonly rawBody: string | Uint8Array;
  readonly headers: WebhookHeaders;
  readonly now?: Date;
  readonly toleranceSeconds?: number;
}

export type VerifyWebhookInput =
  | (RawWebhookInput & { readonly provider: 'resend'; readonly webhookSecret: string })
  | (RawWebhookInput & { readonly provider: 'mailgun'; readonly signingKey: string })
  | (RawWebhookInput & { readonly provider: 'sendgrid'; readonly publicKey: string })
  | (RawWebhookInput & {
      readonly provider: 'brevo' | 'postmark';
      readonly authorization: string;
      readonly authorizationHeader?: string;
    })
  | (RawWebhookInput & { readonly provider: 'ses'; readonly topicArn: string });

export class WebhookVerificationError extends Error {
  constructor(readonly code: 'invalid_signature' | 'invalid_payload' | 'unsupported_event') {
    super(
      code === 'invalid_signature'
        ? 'The webhook request could not be authenticated.'
        : code === 'unsupported_event'
          ? 'The provider webhook event is not supported.'
          : 'The provider webhook payload is invalid.',
    );
    this.name = 'WebhookVerificationError';
  }
}

export const defaultTimestampToleranceSeconds = 300;
