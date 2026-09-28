import { Buffer } from 'node:buffer';
import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import type { MailgunMessageData } from 'mailgun.js/definitions';
import { addressWithName } from '../config.js';
import { MailError, normalizeProviderError } from '../errors.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

interface MailgunOptions {
  apiKey: string;
  domain: string;
  region: 'us' | 'eu';
}

export function createMailgunProvider(options: MailgunOptions): MailProvider {
  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({
    username: 'api',
    key: options.apiKey,
    url: options.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net',
  });

  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.messageId || input.idempotencyKey) {
          throw new MailError(
            'Mailgun does not support custom message IDs or idempotency keys through this adapter.',
            'unsupported',
            'mailgun',
            false,
          );
        }

        const message: MailgunMessageData = {
          from: formatAddress(input.from),
          to: input.to.map(formatAddress),
          subject: input.subject,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.html !== undefined ? { html: input.html } : {}),
          ...(input.cc ? { cc: input.cc.map(formatAddress) } : {}),
          ...(input.bcc ? { bcc: input.bcc.map(formatAddress) } : {}),
          ...(input.replyTo ? { 'h:Reply-To': formatAddress(input.replyTo) } : {}),
          ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([key, value]) => [`h:${key}`, value])),
          ...Object.fromEntries(Object.entries(input.metadata ?? {}).map(([key, value]) => [`v:${key}`, value])),
          ...(input.attachments?.length
            ? {
                attachment: input.attachments
                  .filter((attachment) => !attachment.contentId)
                  .map((attachment) => ({
                    data: Buffer.from(attachment.content),
                    filename: attachment.filename,
                    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
                  })),
                inline: input.attachments
                  .filter((attachment) => Boolean(attachment.contentId))
                  .map((attachment) => ({
                    data: Buffer.from(attachment.content),
                    filename: attachment.contentId,
                    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
                  })),
              }
            : {}),
        };
        const response = await client.messages.create(options.domain, message);
        if (!response.id) {
          throw new MailError('Mailgun accepted no message identifier.', 'provider', 'mailgun', false);
        }
        return { messageId: response.id };
      } catch (error) {
        throw normalizeProviderError(error, 'mailgun');
      }
    },
    async verifyConnection() {
      throw new MailError(
        'Mailgun does not support connection verification. Send a provider test message instead.',
        'unsupported',
        'mailgun',
        false,
      );
    },
    async close() {},
  };
}

function formatAddress(address: NormalizedMailInput['from']): string {
  const normalized = addressWithName(address);
  return normalized.name ? `${normalized.name} <${normalized.email}>` : normalized.email;
}
