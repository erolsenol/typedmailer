export type MailAddress = string | { readonly email: string; readonly name?: string | undefined };

export interface MailAttachment {
  readonly filename: string;
  readonly content: string | Uint8Array;
  readonly contentType?: string;
  readonly contentId?: string;
}

export interface SendMailInput {
  readonly from?: MailAddress;
  readonly to: MailAddress | readonly MailAddress[];
  readonly subject: string;
  readonly messageId?: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: MailAddress;
  readonly cc?: MailAddress | readonly MailAddress[];
  readonly bcc?: MailAddress | readonly MailAddress[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly attachments?: readonly MailAttachment[];
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type ProviderName = 'resend' | 'brevo' | 'smtp' | 'postmark' | 'sendgrid' | 'mailgun' | 'ses';

export interface SendMailResult<TProvider extends string = ProviderName | 'test'> {
  readonly provider: TProvider;
  readonly messageId: string;
  /** Time when the provider accepted the request. This does not confirm inbox delivery. */
  readonly acceptedAt: Date;
}

export interface Mailer<TProvider extends string = ProviderName | 'test'> {
  send(input: SendMailInput): Promise<SendMailResult<TProvider>>;
  verifyConnection(): Promise<void>;
  /** Rejects new operations, waits for active operations, and closes the provider at most once. */
  close(): Promise<void>;
}

export interface ProviderAdapter<TProvider extends string = string> {
  readonly name: TProvider;
  send(input: NormalizedMailInput): Promise<ProviderSendResult>;
  verifyConnection?(): Promise<void>;
  close?(): Promise<void> | void;
}

export interface CustomMailerOptions<TProvider extends string = string> {
  readonly provider: ProviderAdapter<TProvider>;
  readonly from: MailAddress;
  readonly maxAttachmentBytes?: number;
}

export interface NormalizedMailInput extends Omit<SendMailInput, 'from' | 'to' | 'cc' | 'bcc' | 'replyTo'> {
  readonly from: MailAddress;
  readonly to: readonly MailAddress[];
  readonly cc?: readonly MailAddress[];
  readonly bcc?: readonly MailAddress[];
  readonly replyTo?: MailAddress;
}

export interface ProviderSendResult {
  readonly messageId: string;
}

export interface MailProvider {
  send(input: NormalizedMailInput): Promise<ProviderSendResult>;
  verifyConnection(): Promise<void>;
  close(): Promise<void>;
}
