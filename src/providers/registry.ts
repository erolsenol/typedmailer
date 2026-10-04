import { z } from 'zod';
import { MailError } from '../errors.js';
import type { MailProvider, MailSendObserver } from '../types.js';
import { senderSchema } from '../config.js';

export const mailerBaseOptionsSchema = z
  .object({
    from: senderSchema,
    /** Optional aggregate in-memory attachment cap. No default preserves existing behavior. */
    maxAttachmentBytes: z.number().int().positive().optional(),
    onSend: z
      .custom<MailSendObserver>((value) => typeof value === 'function', 'Expected an observer function.')
      .optional(),
  })
  .strict();

export const providerOptions = {
  resend: mailerBaseOptionsSchema.extend({ provider: z.literal('resend'), apiKey: z.string().min(1) }),
  brevo: mailerBaseOptionsSchema.extend({ provider: z.literal('brevo'), apiKey: z.string().min(1) }),
  postmark: mailerBaseOptionsSchema.extend({ provider: z.literal('postmark'), apiKey: z.string().min(1) }),
  sendgrid: mailerBaseOptionsSchema.extend({ provider: z.literal('sendgrid'), apiKey: z.string().min(1) }),
  mailgun: mailerBaseOptionsSchema.extend({
    provider: z.literal('mailgun'),
    apiKey: z.string().min(1),
    domain: z.string().min(1),
    region: z.enum(['us', 'eu']).default('us'),
  }),
  ses: mailerBaseOptionsSchema.extend({ provider: z.literal('ses'), region: z.string().min(1) }),
  smtp: mailerBaseOptionsSchema
    .extend({
      provider: z.literal('smtp'),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      requireTLS: z.boolean().optional(),
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

export const mailerOptionsSchema = z.discriminatedUnion('provider', [
  providerOptions.resend,
  providerOptions.brevo,
  providerOptions.postmark,
  providerOptions.sendgrid,
  providerOptions.mailgun,
  providerOptions.ses,
  providerOptions.smtp,
]);

export type MailerOptions = z.input<typeof mailerOptionsSchema>;
export type ParsedMailerOptions = z.output<typeof mailerOptionsSchema>;

export async function loadProvider(options: ParsedMailerOptions): Promise<MailProvider> {
  try {
    switch (options.provider) {
      case 'resend': {
        const { createResendProvider } = await import('./resend.js');
        return createResendProvider(options);
      }
      case 'brevo': {
        const { createBrevoProvider } = await import('./brevo.js');
        return createBrevoProvider(options);
      }
      case 'postmark': {
        const { createPostmarkProvider } = await import('./postmark.js');
        return createPostmarkProvider(options);
      }
      case 'sendgrid': {
        const { createSendGridProvider } = await import('./sendgrid.js');
        return createSendGridProvider(options);
      }
      case 'mailgun': {
        const { createMailgunProvider } = await import('./mailgun.js');
        return createMailgunProvider(options);
      }
      case 'ses': {
        const { createSesProvider } = await import('./ses.js');
        return createSesProvider(options);
      }
      case 'smtp': {
        const { createSmtpProvider } = await import('./smtp.js');
        return createSmtpProvider({
          host: options.host,
          port: options.port,
          secure: options.secure,
          ...(options.requireTLS !== undefined ? { requireTLS: options.requireTLS } : {}),
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
