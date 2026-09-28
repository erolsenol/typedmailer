import { Buffer } from 'node:buffer';
import { ServerClient } from 'postmark';
import { addressWithName } from '../config.js';
import { MailError, normalizeProviderError } from '../errors.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

export function createPostmarkProvider(options: { apiKey: string }): MailProvider {
  const client = new ServerClient(options.apiKey);

  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.messageId || input.idempotencyKey) {
          throw new MailError(
            'Postmark does not support custom message IDs or idempotency keys through this adapter.',
            'unsupported',
            'postmark',
            false,
          );
        }

        const response = await client.sendEmail({
          From: formatAddress(input.from),
          To: input.to.map(formatAddress).join(','),
          Subject: input.subject,
          ...(input.text !== undefined ? { TextBody: input.text } : {}),
          ...(input.html !== undefined ? { HtmlBody: input.html } : {}),
          ...(input.replyTo ? { ReplyTo: formatAddress(input.replyTo) } : {}),
          ...(input.cc ? { Cc: input.cc.map(formatAddress).join(',') } : {}),
          ...(input.bcc ? { Bcc: input.bcc.map(formatAddress).join(',') } : {}),
          ...(input.headers
            ? { Headers: Object.entries(input.headers).map(([Name, Value]) => ({ Name, Value })) }
            : {}),
          ...(input.metadata ? { Metadata: input.metadata } : {}),
          ...(input.attachments
            ? {
                Attachments: input.attachments.map((attachment) => ({
                  Name: attachment.filename,
                  Content: Buffer.from(attachment.content).toString('base64'),
                  ContentType: attachment.contentType ?? 'application/octet-stream',
                  ...(attachment.contentId ? { ContentID: attachment.contentId } : {}),
                })),
              }
            : {}),
        });

        if (!response.MessageID) {
          throw new MailError('Postmark accepted no message identifier.', 'provider', 'postmark', false);
        }
        return { messageId: response.MessageID };
      } catch (error) {
        throw normalizeProviderError(error, 'postmark');
      }
    },
    async verifyConnection() {
      throw new MailError(
        'Postmark does not support connection verification. Send a provider test message instead.',
        'unsupported',
        'postmark',
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
