import nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';
import { MailError, normalizeProviderError } from '../errors.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

export function createSmtpProvider(options: SmtpOptions): MailProvider {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    ...(options.port === 587 && !options.secure ? { requireTLS: true } : {}),
    connectionTimeout: options.connectionTimeout,
    greetingTimeout: options.greetingTimeout,
    socketTimeout: options.socketTimeout,
    ...(options.user && options.password ? { auth: { user: options.user, pass: options.password } } : {}),
  });
  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.idempotencyKey || input.metadata) {
          throw new MailError('SMTP does not support idempotency keys or provider metadata.', 'unsupported', 'smtp', false);
        }
        const result = await (transport.sendMail({
          from: input.from,
          to: [...input.to],
          subject: input.subject,
          ...(input.messageId ? { messageId: input.messageId } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.html !== undefined ? { html: input.html } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.cc ? { cc: [...input.cc] } : {}),
          ...(input.bcc ? { bcc: [...input.bcc] } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
          ...(input.attachments ? { attachments: input.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: typeof attachment.content === 'string' ? attachment.content : Buffer.from(attachment.content),
            ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
            ...(attachment.contentId ? { cid: attachment.contentId } : {}),
          })) } : {}),
        }) as Promise<{ messageId?: string }>);
        if (!result.messageId) throw new MailError('SMTP returned no message identifier.', 'provider', 'smtp', false);
        return { messageId: result.messageId };
      } catch (error) {
        throw normalizeProviderError(error, 'smtp');
      }
    },
    async verifyConnection() {
      try {
        await transport.verify();
      } catch (error) {
        throw normalizeProviderError(error, 'smtp');
      }
    },
    async close() {
      transport.close();
    },
  };
}
