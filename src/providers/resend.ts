import { Resend } from 'resend';
import { Buffer } from 'node:buffer';
import type { CreateEmailOptions } from 'resend';
import { MailError, normalizeProviderError } from '../errors.js';
import { emailOf } from '../config.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

export function createResendProvider(options: { apiKey: string }): MailProvider {
  const client = new Resend(options.apiKey);
  const formatFrom = (address: NormalizedMailInput['from']): string => {
    if (typeof address === 'string') return address;
    return address.name ? `${address.name} <${address.email}>` : address.email;
  };
  return {
    async send(input: NormalizedMailInput) {
      if (input.messageId) {
        throw new MailError(
          'Custom message IDs are only supported by the SMTP adapter.',
          'unsupported',
          'resend',
          false,
        );
      }
      const payload = {
        from: formatFrom(input.from),
        to: input.to.map(emailOf),
        subject: input.subject,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.replyTo ? { replyTo: emailOf(input.replyTo) } : {}),
        ...(input.cc ? { cc: input.cc.map(emailOf) } : {}),
        ...(input.bcc ? { bcc: input.bcc.map(emailOf) } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.attachments
          ? {
              attachments: input.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: typeof attachment.content === 'string' ? attachment.content : Buffer.from(attachment.content),
                ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
                ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
              })),
            }
          : {}),
        ...(input.metadata ? { tags: Object.entries(input.metadata).map(([name, value]) => ({ name, value })) } : {}),
      };
      const options = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;
      const response = options
        ? await client.emails.send(payload as unknown as CreateEmailOptions, options)
        : await client.emails.send(payload as unknown as CreateEmailOptions);
      const { data, error } = response;
      if (error) throw normalizeProviderError(error, 'resend');
      if (!data?.id) throw new MailError('Resend accepted no message identifier.', 'provider', 'resend', false);
      return { messageId: data.id };
    },
    async verifyConnection() {
      // Resend does not expose a side-effect-free credential check in its SDK.
      throw new MailError(
        'Resend does not support connection verification. Send a provider test message instead.',
        'unsupported',
        'resend',
        false,
      );
    },
    async close() {},
  };
}
