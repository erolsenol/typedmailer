import { Buffer } from 'node:buffer';
import { MailService, type MailDataRequired } from '@sendgrid/mail';
import { addressWithName } from '../config.js';
import { MailError, normalizeProviderError } from '../errors.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

export function createSendGridProvider(options: { apiKey: string }): MailProvider {
  const client = new MailService();
  client.setApiKey(options.apiKey);

  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.messageId || input.idempotencyKey) {
          throw new MailError(
            'SendGrid does not support custom message IDs or idempotency keys through this adapter.',
            'unsupported',
            'sendgrid',
            false,
          );
        }

        const content =
          input.text !== undefined
            ? { text: input.text, ...(input.html !== undefined ? { html: input.html } : {}) }
            : input.html !== undefined
              ? { html: input.html }
              : undefined;
        if (!content) {
          throw new MailError('Provide text or HTML content.', 'configuration', 'sendgrid', false);
        }

        const payload: MailDataRequired = {
          from: addressWithName(input.from),
          to: input.to.map(addressWithName),
          subject: input.subject,
          ...content,
          ...(input.replyTo ? { replyTo: addressWithName(input.replyTo) } : {}),
          ...(input.cc ? { cc: input.cc.map(addressWithName) } : {}),
          ...(input.bcc ? { bcc: input.bcc.map(addressWithName) } : {}),
          ...(input.headers ? { headers: { ...input.headers } } : {}),
          ...(input.metadata ? { customArgs: { ...input.metadata } } : {}),
          ...(input.attachments
            ? {
                attachments: input.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  content: Buffer.from(attachment.content).toString('base64'),
                  ...(attachment.contentType ? { type: attachment.contentType } : {}),
                  ...(attachment.contentId ? { contentId: attachment.contentId, disposition: 'inline' } : {}),
                })),
              }
            : {}),
        };
        const [response] = await client.send(payload);

        const messageId = getHeader(response.headers, 'x-message-id');
        if (!messageId) {
          throw new MailError('SendGrid accepted no message identifier.', 'provider', 'sendgrid', false, {
            deliveryUnknown: true,
          });
        }
        return { messageId };
      } catch (error) {
        throw normalizeProviderError(error, 'sendgrid');
      }
    },
    async verifyConnection() {
      throw new MailError(
        'SendGrid does not support connection verification. Send a provider test message instead.',
        'unsupported',
        'sendgrid',
        false,
      );
    },
    async close() {},
  };
}

function getHeader(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const header = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  if (typeof header === 'string') return header;
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0];
  return undefined;
}
