import { Buffer } from 'node:buffer';
import { MailError, normalizeProviderError } from './errors.js';
import { mailInputSchema, normalizeAddresses } from './config.js';
import { loadProvider, mailerOptionsSchema, type MailerOptions } from './providers/registry.js';
import type { Mailer, MailProvider, NormalizedMailInput, SendMailInput, SendMailResult } from './types.js';

export type { MailerOptions };

export function createMailer(input: MailerOptions): Mailer {
  let providerPromise: Promise<MailProvider> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let activeOperations = 0;
  let resolveOperationsIdle: (() => void) | undefined;
  const parsedOptions = mailerOptionsSchema.parse(input);
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
      const attachmentBytes =
        parsed.attachments?.reduce(
          (total, attachment) =>
            total +
            (typeof attachment.content === 'string'
              ? Buffer.byteLength(attachment.content)
              : attachment.content.byteLength),
          0,
        ) ?? 0;
      if (parsedOptions.maxAttachmentBytes !== undefined && attachmentBytes > parsedOptions.maxAttachmentBytes) {
        throw new MailError(
          `Attachment content exceeds the configured limit of ${parsedOptions.maxAttachmentBytes} bytes.`,
          'configuration',
          parsedOptions.provider,
          false,
        );
      }
      const cc = normalizeAddresses(parsed.cc);
      const bcc = normalizeAddresses(parsed.bcc);
      const normalized: NormalizedMailInput = {
        from: parsed.from ?? parsedOptions.from,
        to: normalizeAddresses(parsed.to) ?? [],
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
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(parsed.replyTo ? { replyTo: parsed.replyTo } : {}),
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
