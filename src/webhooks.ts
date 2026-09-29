import { createHmac, createVerify, timingSafeEqual, X509Certificate } from 'node:crypto';
import type { ProviderName } from './types.js';

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

const defaultTimestampToleranceSeconds = 300;

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

function verifyResend(input: Extract<VerifyWebhookInput, { provider: 'resend' }>, rawBody: Uint8Array): void {
  const messageId = getHeader(input.headers, 'svix-id');
  const timestamp = getHeader(input.headers, 'svix-timestamp');
  const signatures = getHeader(input.headers, 'svix-signature');
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!messageId || !signatures || !input.webhookSecret.startsWith('whsec_')) {
    throw new WebhookVerificationError('invalid_signature');
  }
  let key: Buffer;
  try {
    key = Buffer.from(input.webhookSecret.slice('whsec_'.length), 'base64');
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (key.length === 0) throw new WebhookVerificationError('invalid_signature');
  const expected = createHmac('sha256', key).update(`${messageId}.${timestamp}.`).update(rawBody).digest();
  const matches = signatures
    .split(' ')
    .some((item) => item.startsWith('v1,') && safeEqual(expected, decodeBase64(item.slice(3))));
  if (!matches) throw new WebhookVerificationError('invalid_signature');
}

function verifyMailgun(input: Extract<VerifyWebhookInput, { provider: 'mailgun' }>, payload: unknown): void {
  const root = asRecord(payload);
  const signature = asRecord(root.signature);
  const timestamp = asString(signature.timestamp);
  const token = asString(signature.token);
  const received = asString(signature.signature);
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!timestamp || !token || !received || !input.signingKey) {
    throw new WebhookVerificationError('invalid_signature');
  }
  const expected = createHmac('sha256', input.signingKey).update(`${timestamp}${token}`).digest('hex');
  if (!safeEqual(Buffer.from(expected, 'hex'), decodeHex(received))) {
    throw new WebhookVerificationError('invalid_signature');
  }
}

function verifySendGrid(input: Extract<VerifyWebhookInput, { provider: 'sendgrid' }>, rawBody: Uint8Array): void {
  const timestamp = getHeader(input.headers, 'x-twilio-email-event-webhook-timestamp');
  const signature = getHeader(input.headers, 'x-twilio-email-event-webhook-signature');
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!timestamp || !signature || !input.publicKey) throw new WebhookVerificationError('invalid_signature');
  try {
    const verifier = createVerify('sha256');
    verifier.update(timestamp);
    verifier.update(rawBody);
    verifier.end();
    if (!verifier.verify(input.publicKey, signature, 'base64')) {
      throw new WebhookVerificationError('invalid_signature');
    }
  } catch (error) {
    if (error instanceof WebhookVerificationError) throw error;
    throw new WebhookVerificationError('invalid_signature');
  }
}

function verifyAuthorization(
  input: Extract<VerifyWebhookInput, { provider: 'brevo' | 'postmark' }>,
  headerName: string,
): void {
  const received = getHeader(input.headers, headerName);
  if (!received || !input.authorization || !safeEqual(Buffer.from(received), Buffer.from(input.authorization))) {
    throw new WebhookVerificationError('invalid_signature');
  }
}

async function verifySnsNotification(
  input: Extract<VerifyWebhookInput, { provider: 'ses' }>,
  payload: unknown,
): Promise<unknown> {
  const envelope = asRecord(payload);
  const topicArn = asString(envelope.TopicArn);
  const signingCertUrl = asString(envelope.SigningCertURL);
  const signature = asString(envelope.Signature);
  const signatureVersion = asString(envelope.SignatureVersion);
  if (
    envelope.Type !== 'Notification' ||
    topicArn !== input.topicArn ||
    !signingCertUrl ||
    !signature ||
    (signatureVersion !== '1' && signatureVersion !== '2')
  ) {
    throw new WebhookVerificationError('invalid_signature');
  }

  let certificateUrl: URL;
  try {
    certificateUrl = new URL(signingCertUrl);
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  const topicMatch = /^arn:(aws|aws-us-gov|aws-cn):sns:([a-z0-9-]+):\d{12}:[^:]+$/.exec(input.topicArn);
  const expectedHost = topicMatch
    ? topicMatch[1] === 'aws-cn'
      ? `sns.${topicMatch[2]}.amazonaws.com.cn`
      : `sns.${topicMatch[2]}.amazonaws.com`
    : undefined;
  if (
    certificateUrl.protocol !== 'https:' ||
    certificateUrl.username ||
    certificateUrl.password ||
    certificateUrl.port ||
    certificateUrl.search ||
    certificateUrl.hash ||
    certificateUrl.hostname !== expectedHost ||
    !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(certificateUrl.pathname)
  ) {
    throw new WebhookVerificationError('invalid_signature');
  }

  let response: Response;
  try {
    response = await fetch(certificateUrl, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (!response.ok) throw new WebhookVerificationError('invalid_signature');
  let certificateBody: string;
  try {
    certificateBody = await response.text();
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (certificateBody.length > 32_768) throw new WebhookVerificationError('invalid_signature');

  try {
    const certificate = new X509Certificate(certificateBody);
    const now = input.now ?? new Date();
    if (
      !certificate.subject.split('\n').some((line) => line === 'CN=Amazon SNS') ||
      now < new Date(certificate.validFrom) ||
      now > new Date(certificate.validTo)
    ) {
      throw new WebhookVerificationError('invalid_signature');
    }
    const fields = snsFields(envelope);
    const verifier = createVerify(signatureVersion === '2' ? 'sha256' : 'sha1');
    verifier.update(fields);
    verifier.end();
    if (!verifier.verify(certificate.publicKey, signature, 'base64')) {
      throw new WebhookVerificationError('invalid_signature');
    }
  } catch (error) {
    if (error instanceof WebhookVerificationError) throw error;
    throw new WebhookVerificationError('invalid_signature');
  }

  try {
    const message = JSON.parse(asString(envelope.Message) ?? '');
    return message;
  } catch {
    throw new WebhookVerificationError('invalid_payload');
  }
}

function snsFields(envelope: Record<string, unknown>): string {
  const fields = ['Message', 'MessageId'];
  if (envelope.Subject !== undefined) fields.push('Subject');
  fields.push('Timestamp', 'TopicArn', 'Type');
  return fields.map((field) => `${field}\n${asString(envelope[field]) ?? ''}\n`).join('');
}

function normalizeResend(payload: unknown): readonly EmailWebhookEvent[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  return [
    makeEvent('resend', root, {
      id: asString(root.id),
      eventType: asString(root.type),
      type: mapEventType(asString(root.type)),
      messageId: asString(data.email_id),
      recipient: firstString(data.to),
      occurredAt: parseDate(root.created_at),
    }),
  ];
}

function normalizeMailgun(payload: unknown): readonly EmailWebhookEvent[] {
  const root = asRecord(payload);
  const event = asRecord(root['event-data']);
  const message = asRecord(event.message);
  const headers = asRecord(message.headers);
  const eventName = asString(event.event);
  return [
    makeEvent('mailgun', event, {
      id: asId(event.id),
      eventType: eventName,
      type: mapEventType(eventName),
      messageId: asString(headers['message-id']),
      recipient: asString(event.recipient),
      occurredAt: parseDate(event.timestamp),
    }),
  ];
}

function normalizeSendGrid(payload: unknown): readonly EmailWebhookEvent[] {
  if (!Array.isArray(payload)) throw new WebhookVerificationError('invalid_payload');
  return payload.map((item) => {
    const event = asRecord(item);
    const eventName = asString(event.event);
    return makeEvent('sendgrid', event, {
      id: asString(event.sg_event_id),
      eventType: eventName,
      type: mapEventType(eventName),
      messageId: asString(event.sg_message_id),
      recipient: asString(event.email),
      occurredAt: parseDate(event.timestamp),
    });
  });
}

function normalizeSes(payload: unknown): readonly EmailWebhookEvent[] {
  const message = asRecord(payload);
  const eventName = asString(message.eventType) ?? asString(message.notificationType);
  const mail = asRecord(message.mail);
  const bounce = asOptionalRecord(message.bounce);
  const complaint = asOptionalRecord(message.complaint);
  const delivery = asOptionalRecord(message.delivery);
  const recipients = Array.isArray(bounce?.bouncedRecipients)
    ? bounce.bouncedRecipients
    : Array.isArray(complaint?.complainedRecipients)
      ? complaint.complainedRecipients
      : [];
  const to = recipients.map((recipient) => asString(asRecord(recipient).emailAddress)).filter(isString);
  const emails = to.length > 0 ? to : asStringArray(mail.destination);
  return emails.length > 0
    ? emails.map((recipient) =>
        makeEvent('ses', message, {
          id: asString(message.messageId),
          eventType: eventName,
          type: mapEventType(eventName),
          messageId: asString(mail.messageId),
          recipient,
          occurredAt: parseDate(delivery?.timestamp) ?? parseDate(bounce?.timestamp),
        }),
      )
    : [
        makeEvent('ses', message, {
          id: asString(message.messageId),
          eventType: eventName,
          type: mapEventType(eventName),
          messageId: asString(mail.messageId),
          occurredAt: parseDate(asRecord(message.delivery).timestamp),
        }),
      ];
}

function normalizeProviderEvents(provider: 'brevo' | 'postmark', payload: unknown): readonly EmailWebhookEvent[] {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) => {
    const event = asRecord(item);
    const eventName = provider === 'brevo' ? asString(event.event) : asString(event.RecordType);
    return makeEvent(provider, event, {
      id:
        provider === 'brevo'
          ? (asId(event.id) ?? asString(event['message-id']))
          : (asId(event.ID) ?? asString(event.MessageID)),
      eventType: eventName,
      type: mapEventType(eventName),
      messageId: provider === 'brevo' ? asString(event['message-id']) : asString(event.MessageID),
      recipient: provider === 'brevo' ? asString(event.email) : asString(event.Recipient),
      occurredAt: parseDate(
        provider === 'brevo' ? (event.ts_epoch ?? event.date) : (event.DeliveredAt ?? event.BouncedAt),
      ),
    });
  });
}

function makeEvent(
  provider: EmailWebhookEvent['provider'],
  raw: unknown,
  fields: {
    readonly id?: string | undefined;
    readonly type: EmailWebhookEventType;
    readonly eventType: string | undefined;
    readonly messageId?: string | undefined;
    readonly recipient?: string | undefined;
    readonly occurredAt?: Date | undefined;
  },
): EmailWebhookEvent {
  if (!fields.eventType) throw new WebhookVerificationError('invalid_payload');
  return {
    provider,
    raw,
    eventType: fields.eventType,
    type: fields.type,
    ...(fields.id ? { id: fields.id } : {}),
    ...(fields.messageId ? { messageId: fields.messageId } : {}),
    ...(fields.recipient ? { recipient: fields.recipient } : {}),
    ...(fields.occurredAt ? { occurredAt: fields.occurredAt } : {}),
  };
}

function mapEventType(eventType: string | undefined): EmailWebhookEventType {
  const event = eventType?.toLowerCase().replaceAll(/[._ -]/g, '') ?? '';
  const mappings: Readonly<Record<string, EmailWebhookEventType>> = {
    accepted: 'accepted',
    sent: 'accepted',
    request: 'accepted',
    emailsent: 'accepted',
    delivery: 'delivered',
    delivered: 'delivered',
    emaildelivered: 'delivered',
    bounce: 'bounced',
    bounced: 'bounced',
    emailbounced: 'bounced',
    hardbounce: 'bounced',
    softbounce: 'bounced',
    spamcomplaint: 'complained',
    complaint: 'complained',
    complained: 'complained',
    emailcomplained: 'complained',
    spamreport: 'complained',
    deferred: 'delayed',
    deliverydelayed: 'delayed',
    deliverydelay: 'delayed',
    emaildeliverydelayed: 'delayed',
    open: 'opened',
    opened: 'opened',
    emailopened: 'opened',
    click: 'clicked',
    clicked: 'clicked',
    emailclicked: 'clicked',
    unsubscribed: 'unsubscribed',
    groupunsubscribe: 'unsubscribed',
    reject: 'rejected',
    rejected: 'rejected',
    dropped: 'failed',
    failed: 'failed',
    emailfailed: 'failed',
    renderingfailure: 'failed',
  };
  return mappings[event] ?? 'other';
}

function assertRecentTimestamp(
  value: string | undefined,
  now: Date | undefined,
  toleranceSeconds: number | undefined,
): void {
  if (!value || !/^\d+$/.test(value)) throw new WebhookVerificationError('invalid_signature');
  const timestamp = Number(value);
  const tolerance = toleranceSeconds ?? defaultTimestampToleranceSeconds;
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(tolerance) || tolerance < 1) {
    throw new WebhookVerificationError('invalid_signature');
  }
  const seconds = Math.floor((now ?? new Date()).getTime() / 1000);
  if (Math.abs(seconds - timestamp) > tolerance) throw new WebhookVerificationError('invalid_signature');
}

function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return typeof entry === 'string' ? entry : Array.isArray(entry) ? entry.join(' ') : undefined;
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, 'base64');
}

function decodeHex(value: string): Buffer {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, 'hex');
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const result = new Date(milliseconds);
    return Number.isNaN(result.getTime()) ? undefined : result;
  }
  if (typeof value === 'string' && value.length > 0) {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? undefined : result;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebhookVerificationError('invalid_payload');
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asId(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function firstString(value: unknown): string | undefined {
  return asString(value) ?? asStringArray(value)[0];
}
