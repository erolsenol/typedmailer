import { z } from 'zod';
import { MailError, normalizeProviderError } from './errors.js';
import { mailInputSchema, normalizeAddresses } from './config.js';
import type { Mailer, MailProvider, NormalizedMailInput, ProviderName, SendMailInput, SendMailResult } from './types.js';

const baseOptions = z.object({
  from: z.union([
    z.string().email(),
    z.string().regex(/^.+ <[^<>\s]+@[^<>\s]+>$/, 'Use a valid email address or "Name <email@example.com>".'),
    z.object({ email: z.string().email(), name: z.string().optional() }).strict(),
  ]),
});

const providerOptions = {
  resend: baseOptions.extend({ provider: z.literal('resend'), apiKey: z.string().min(1) }),
  brevo: baseOptions.extend({ provider: z.literal('brevo'), apiKey: z.string().min(1) }),
  smtp: baseOptions.extend({
    provider: z.literal('smtp'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    connectionTimeout: z.number().int().positive().default(8_000),
    greetingTimeout: z.number().int().positive().default(8_000),
    socketTimeout: z.number().int().positive().default(15_000),
  }).refine((options) => Boolean(options.user) === Boolean(options.password), {
    message: 'SMTP user and password must be configured together.',
    path: ['user'],
  }),
} as const;

export type MailerOptions =
  | z.input<typeof providerOptions.resend>
  | z.input<typeof providerOptions.brevo>
  | z.input<typeof providerOptions.smtp>;

async function loadProvider(options: z.output<typeof providerOptions[keyof typeof providerOptions]>): Promise<MailProvider> {
  try {
    switch (options.provider) {
    case 'resend': {
      const { createResendProvider } = await import('./providers/resend.js');
      return createResendProvider(options);
    }
    case 'brevo': {
      const { createBrevoProvider } = await import('./providers/brevo.js');
      return createBrevoProvider(options);
    }
    case 'smtp': {
      const { createSmtpProvider } = await import('./providers/smtp.js');
      return createSmtpProvider({
        host: options.host,
        port: options.port,
        secure: options.secure,
        ...(options.user ? { user: options.user } : {}),
        ...(options.password ? { password: options.password } : {}),
        connectionTimeout: options.connectionTimeout,
        greetingTimeout: options.greetingTimeout,
        socketTimeout: options.socketTimeout,
      });
    }
    }
  } catch (error) {
    const moduleNotFound = error as { code?: unknown };
    if (moduleNotFound?.code === 'ERR_MODULE_NOT_FOUND') {
      const dependency = options.provider === 'brevo' ? '@getbrevo/brevo' : options.provider === 'resend' ? 'resend' : 'nodemailer';
      throw new MailError(`Install the optional provider package "${dependency}" to use ${options.provider}.`, 'configuration', options.provider, false, { cause: error });
    }
    throw error;
  }
}

export function createMailer(input: MailerOptions): Mailer {
  let providerPromise: Promise<MailProvider> | undefined;
  let closed = false;
  const parsedOptions = z.discriminatedUnion('provider', [providerOptions.resend, providerOptions.brevo, providerOptions.smtp]).parse(input);
  const getProvider = (): Promise<MailProvider> => {
    if (closed) throw new MailError('Mailer has been closed.', 'configuration', parsedOptions.provider, false);
    providerPromise ??= loadProvider(parsedOptions);
    return providerPromise;
  };

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      const parsed = mailInputSchema.parse(input);
      const normalized: NormalizedMailInput = {
        from: (parsed.from ?? parsedOptions.from) as NormalizedMailInput['from'],
        to: (normalizeAddresses(parsed.to) ?? []) as NormalizedMailInput['to'],
        subject: parsed.subject,
        ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
        ...(parsed.text !== undefined ? { text: parsed.text } : {}),
        ...(parsed.html !== undefined ? { html: parsed.html } : {}),
        ...(parsed.headers ? { headers: parsed.headers } : {}),
        ...(parsed.attachments ? { attachments: parsed.attachments.map((item) => ({
          filename: item.filename,
          content: item.content,
          ...(item.contentType ? { contentType: item.contentType } : {}),
          ...(item.contentId ? { contentId: item.contentId } : {}),
        })) } : {}),
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
        ...(normalizeAddresses(parsed.cc) ? { cc: normalizeAddresses(parsed.cc) as NonNullable<NormalizedMailInput['cc']> } : {}),
        ...(normalizeAddresses(parsed.bcc) ? { bcc: normalizeAddresses(parsed.bcc) as NonNullable<NormalizedMailInput['bcc']> } : {}),
        ...(parsed.replyTo ? { replyTo: parsed.replyTo as NonNullable<NormalizedMailInput['replyTo']> } : {}),
      };
      try {
        const result = await (await getProvider()).send(normalized);
        return { provider: parsedOptions.provider as ProviderName, messageId: result.messageId, acceptedAt: new Date() };
      } catch (error) {
        throw normalizeProviderError(error, parsedOptions.provider);
      }
    },
    async verifyConnection(): Promise<void> {
      try {
        await (await getProvider()).verifyConnection();
      } catch (error) {
        throw normalizeProviderError(error, parsedOptions.provider);
      }
    },
    async close(): Promise<void> {
      closed = true;
      if (providerPromise) await (await providerPromise).close();
    },
  };
}

export { MailError } from './errors.js';
export type { MailAddress, MailAttachment, Mailer, NormalizedMailInput, ProviderName, SendMailInput, SendMailResult } from './types.js';
