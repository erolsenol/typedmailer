import { WebhookVerificationError } from './types.js';
import type { EmailWebhookEvent, EmailWebhookEventType } from './types.js';
import {
  asId,
  asOptionalRecord,
  asRecord,
  asString,
  asStringArray,
  firstString,
  isString,
  parseDate,
} from './shared.js';

export function normalizeResend(payload: unknown): readonly EmailWebhookEvent[] {
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

export function normalizeMailgun(payload: unknown): readonly EmailWebhookEvent[] {
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

export function normalizeSendGrid(payload: unknown): readonly EmailWebhookEvent[] {
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

export function normalizeSes(payload: unknown): readonly EmailWebhookEvent[] {
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

export function normalizeProviderEvents(
  provider: 'brevo' | 'postmark',
  payload: unknown,
): readonly EmailWebhookEvent[] {
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
