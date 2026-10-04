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
  /** Legacy provider identifier; may fall back to the email message ID. */
  readonly id?: string;
  /** Provider event ID, without a message-ID fallback. */
  readonly eventId?: string;
  /** Authenticated transport notification ID (Resend/SNS). Shared by events in one notification. */
  readonly deliveryId?: string;
  readonly type: EmailWebhookEventType;
  readonly eventType: string;
  readonly messageId?: string;
  readonly recipient?: string;
  /** All Resend recipients; recipient retains the first address for compatibility. */
  readonly recipients?: readonly string[];
  readonly occurredAt?: Date;
  /** Original provider data. It can contain message metadata and personal information. */
  readonly raw: unknown;
}

export type WebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

interface RawWebhookInput {
  readonly rawBody: string | Uint8Array;
  readonly headers: WebhookHeaders;
  readonly maxBodyBytes?: number;
  readonly maxEvents?: number;
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
