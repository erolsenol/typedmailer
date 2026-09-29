import { BrevoClient } from '@getbrevo/brevo';
import { Buffer } from 'node:buffer';
import { MailError, normalizeProviderError } from '../errors.js';
import { addressWithName } from '../config.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

export function createBrevoProvider(options: { apiKey: string }): MailProvider {
  const client = new BrevoClient({ apiKey: options.apiKey });
  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.messageId) {
          throw new MailError(
            'Custom message IDs are only supported by the SMTP adapter.',
            'unsupported',
            'brevo',
            false,
          );
        }
        if (input.idempotencyKey) {
          throw new MailError(
            'Brevo idempotency keys are not supported by this adapter.',
            'unsupported',
            'brevo',
            false,
          );
        }
        if (input.attachments?.some((attachment) => attachment.contentId)) {
          throw new MailError(
            'Inline attachment content IDs are not supported by the Brevo adapter.',
            'unsupported',
            'brevo',
            false,
          );
        }
        const result = await client.transactionalEmails.sendTransacEmail({
          sender: addressWithName(input.from),
          to: input.to.map(addressWithName),
          subject: input.subject,
          ...(input.text !== undefined ? { textContent: input.text } : {}),
          ...(input.html !== undefined ? { htmlContent: input.html } : {}),
          ...(input.replyTo ? { replyTo: addressWithName(input.replyTo) } : {}),
          ...(input.cc ? { cc: input.cc.map(addressWithName) } : {}),
          ...(input.bcc ? { bcc: input.bcc.map(addressWithName) } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
          ...(input.metadata ? { tags: Object.entries(input.metadata).map(([key, value]) => `${key}=${value}`) } : {}),
          ...(input.attachments
            ? {
                attachment: input.attachments.map((attachment) => ({
                  name: attachment.filename,
                  content: Buffer.from(
                    typeof attachment.content === 'string' ? attachment.content : Buffer.from(attachment.content),
                  ).toString('base64'),
                })),
              }
            : {}),
        });
        if (!result.messageId) {
          throw new MailError('Brevo accepted no message identifier.', 'provider', 'brevo', false, {
            deliveryUnknown: true,
          });
        }
        return { messageId: result.messageId };
      } catch (error) {
        throw normalizeProviderError(error, 'brevo', 'send');
      }
    },
    async verifyConnection() {
      throw new MailError(
        'Brevo connection verification is not exposed by this adapter yet.',
        'unsupported',
        'brevo',
        false,
      );
    },
    async close() {},
  };
}
