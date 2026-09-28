export type MailAddress = string | { readonly email: string; readonly name?: string };

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

export type ProviderName = 'resend' | 'brevo' | 'smtp';

export interface SendMailResult {
  readonly provider: ProviderName;
  readonly messageId: string;
  /** Time when the provider accepted the request. This does not confirm inbox delivery. */
  readonly acceptedAt: Date;
}

export interface Mailer {
  send(input: SendMailInput): Promise<SendMailResult>;
  verifyConnection(): Promise<void>;
  close(): Promise<void>;
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
