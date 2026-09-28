import { z } from 'zod';
import { MailError, normalizeProviderError } from './errors.js';
import { mailInputSchema, normalizeAddresses } from './config.js';
import type { Mailer, MailProvider, NormalizedMailInput, SendMailInput, SendMailResult } from './types.js';

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
  postmark: baseOptions.extend({ provider: z.literal('postmark'), apiKey: z.string().min(1) }),
  sendgrid: baseOptions.extend({ provider: z.literal('sendgrid'), apiKey: z.string().min(1) }),
  mailgun: baseOptions.extend({
    provider: z.literal('mailgun'),
    apiKey: z.string().min(1),
    domain: z.string().min(1),
    region: z.enum(['us', 'eu']).default('us'),
  }),
  ses: baseOptions.extend({ provider: z.literal('ses'), region: z.string().min(1) }),
  smtp: baseOptions
    .extend({
      provider: z.literal('smtp'),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      user: z.string().min(1).optional(),
      password: z.string().min(1).optional(),
      connectionTimeout: z.number().int().positive().default(8_000),
      greetingTimeout: z.number().int().positive().default(8_000),
      socketTimeout: z.number().int().positive().default(15_000),
    })
    .refine((options) => Boolean(options.user) === Boolean(options.password), {
      message: 'SMTP user and password must be configured together.',
      path: ['user'],
    }),
} as const;

export type MailerOptions =
  | z.input<typeof providerOptions.resend>
  | z.input<typeof providerOptions.brevo>
  | z.input<typeof providerOptions.postmark>
  | z.input<typeof providerOptions.sendgrid>
  | z.input<typeof providerOptions.mailgun>
  | z.input<typeof providerOptions.ses>
  | z.input<typeof providerOptions.smtp>;

async function loadProvider(
  options: z.output<(typeof providerOptions)[keyof typeof providerOptions]>,
): Promise<MailProvider> {
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
      case 'postmark': {
        const { createPostmarkProvider } = await import('./providers/postmark.js');
        return createPostmarkProvider(options);
      }
      case 'sendgrid': {
        const { createSendGridProvider } = await import('./providers/sendgrid.js');
        return createSendGridProvider(options);
      }
      case 'mailgun': {
        const { createMailgunProvider } = await import('./providers/mailgun.js');
        return createMailgunProvider(options);
      }
      case 'ses': {
        const { createSesProvider } = await import('./providers/ses.js');
        return createSesProvider(options);
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
      const dependencies = {
        brevo: '@getbrevo/brevo',
        mailgun: 'mailgun.js and form-data',
        postmark: 'postmark',
        resend: 'resend',
        sendgrid: '@sendgrid/mail',
        ses: '@aws-sdk/client-sesv2',
        smtp: 'nodemailer',
      } as const;
      const dependency = dependencies[options.provider];
      throw new MailError(
        `Install the optional provider package "${dependency}" to use ${options.provider}.`,
        'configuration',
        options.provider,
        false,
        { cause: error },
      );
    }
    throw error;
  }
}

export function createMailer(input: MailerOptions): Mailer {
  let providerPromise: Promise<MailProvider> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let activeOperations = 0;
  let resolveOperationsIdle: (() => void) | undefined;
  const parsedOptions = z
    .discriminatedUnion('provider', [
      providerOptions.resend,
      providerOptions.brevo,
      providerOptions.postmark,
      providerOptions.sendgrid,
      providerOptions.mailgun,
      providerOptions.ses,
      providerOptions.smtp,
    ])
    .parse(input);
  const assertOpen = (): void => {
    if (closed) throw new MailError('Mailer has been closed.', 'configuration', parsedOptions.provider, false);
  };
  const getProvider = (): Promise<MailProvider> => {
    assertOpen();
    providerPromise ??= loadProvider(parsedOptions);
    return providerPromise;
  };
  const runWithProvider = async <T>(operation: (provider: MailProvider) => Promise<T>): Promise<T> => {
    assertOpen();
    activeOperations += 1;
    try {
      return await operation(await getProvider());
    } finally {
      activeOperations -= 1;
      if (activeOperations === 0) {
        resolveOperationsIdle?.();
        resolveOperationsIdle = undefined;
      }
    }
  };

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      assertOpen();
      const parsed = mailInputSchema.parse(input);
      const normalized: NormalizedMailInput = {
        from: (parsed.from ?? parsedOptions.from) as NormalizedMailInput['from'],
        to: (normalizeAddresses(parsed.to) ?? []) as NormalizedMailInput['to'],
        subject: parsed.subject,
        ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
        ...(parsed.text !== undefined ? { text: parsed.text } : {}),
        ...(parsed.html !== undefined ? { html: parsed.html } : {}),
        ...(parsed.headers ? { headers: parsed.headers } : {}),
        ...(parsed.attachments
          ? {
              attachments: parsed.attachments.map((item) => ({
                filename: item.filename,
                content: item.content,
                ...(item.contentType ? { contentType: item.contentType } : {}),
                ...(item.contentId ? { contentId: item.contentId } : {}),
              })),
            }
          : {}),
        ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
        ...(normalizeAddresses(parsed.cc)
          ? { cc: normalizeAddresses(parsed.cc) as NonNullable<NormalizedMailInput['cc']> }
          : {}),
        ...(normalizeAddresses(parsed.bcc)
          ? { bcc: normalizeAddresses(parsed.bcc) as NonNullable<NormalizedMailInput['bcc']> }
          : {}),
        ...(parsed.replyTo ? { replyTo: parsed.replyTo as NonNullable<NormalizedMailInput['replyTo']> } : {}),
      };
      try {
        const result = await runWithProvider((provider) => provider.send(normalized));
        return {
          provider: parsedOptions.provider,
          messageId: result.messageId,
          acceptedAt: new Date(),
        };
      } catch (error) {
        throw normalizeProviderError(error, parsedOptions.provider, 'send');
      }
    },
    async verifyConnection(): Promise<void> {
      try {
        await runWithProvider((provider) => provider.verifyConnection());
      } catch (error) {
        throw normalizeProviderError(error, parsedOptions.provider);
      }
    },
    async close(): Promise<void> {
      closed = true;
      closePromise ??= (async () => {
        if (activeOperations > 0) {
          await new Promise<void>((resolve) => {
            resolveOperationsIdle = resolve;
          });
        }
        const provider = await providerPromise?.catch(() => undefined);
        await provider?.close();
      })();
      await closePromise;
    },
  };
}

export { MailError } from './errors.js';
export type { MailErrorCode, MailErrorOperation, MailErrorOptions } from './errors.js';
export type {
  MailAddress,
  MailAttachment,
  Mailer,
  NormalizedMailInput,
  ProviderName,
  SendMailInput,
  SendMailResult,
} from './types.js';
