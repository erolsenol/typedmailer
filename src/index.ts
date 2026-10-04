import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { MailError, normalizeProviderError } from './errors.js';
import { mailInputSchema, normalizeAddresses } from './config.js';
import {
  loadProvider,
  mailerBaseOptionsSchema,
  mailerOptionsSchema,
  type MailerOptions as BuiltInMailerOptions,
} from './providers/registry.js';
import type {
  CustomMailerOptions,
  Mailer,
  MailProvider,
  MailSendEvent,
  NormalizedMailInput,
  ProviderAdapter,
  SendMailInput,
  SendMailResult,
} from './types.js';

export type MailerOptions = BuiltInMailerOptions | CustomMailerOptions;

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  if (typeof value !== 'object' || value === null) return false;
  const adapter = value as Record<string, unknown>;
  return (
    typeof adapter.name === 'string' &&
    adapter.name.length > 0 &&
    adapter.name.trim() === adapter.name &&
    typeof adapter.send === 'function' &&
    (adapter.verifyConnection === undefined || typeof adapter.verifyConnection === 'function') &&
    (adapter.close === undefined || typeof adapter.close === 'function')
  );
}

const customMailerOptionsSchema = mailerBaseOptionsSchema
  .extend({ provider: z.custom<ProviderAdapter>(isProviderAdapter, 'Invalid custom provider adapter.') })
  .strict();

function isCustomOptions(input: MailerOptions): input is CustomMailerOptions {
  return typeof input.provider !== 'string';
}

function createCustomProvider(adapter: ProviderAdapter): MailProvider {
  return {
    send: (input) => adapter.send(input),
    async verifyConnection() {
      if (!adapter.verifyConnection) {
        throw new MailError(
          `Connection verification is not supported by the custom provider "${adapter.name}".`,
          'unsupported',
          adapter.name,
          false,
        );
      }
      await adapter.verifyConnection();
    },
    async close() {
      await adapter.close?.();
    },
  };
}

export function createMailer<const TProvider extends string>(input: CustomMailerOptions<TProvider>): Mailer<TProvider>;
export function createMailer<const TOptions extends BuiltInMailerOptions>(
  input: TOptions,
): Mailer<TOptions['provider']>;
export function createMailer(input: MailerOptions): Mailer<string>;
export function createMailer(input: MailerOptions): Mailer<string> {
  let providerPromise: Promise<MailProvider> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let activeOperations = 0;
  let resolveOperationsIdle: (() => void) | undefined;
  const parsedOptions = isCustomOptions(input)
    ? customMailerOptionsSchema.parse(input)
    : mailerOptionsSchema.parse(input);
  const providerName =
    typeof parsedOptions.provider === 'string' ? parsedOptions.provider : parsedOptions.provider.name;
  const notify = (event: MailSendEvent): void => {
    try {
      // Telemetry must never alter delivery or produce an unhandled rejection.
      void Promise.resolve(parsedOptions.onSend?.(event)).catch(() => undefined);
    } catch {
      // A synchronous observer failure is isolated as well.
    }
  };
  const assertOpen = (): void => {
    if (closed) throw new MailError('Mailer has been closed.', 'configuration', providerName, false);
  };
  const getProvider = (): Promise<MailProvider> => {
    assertOpen();
    providerPromise ??=
      typeof parsedOptions.provider === 'string'
        ? loadProvider(parsedOptions)
        : Promise.resolve(createCustomProvider(parsedOptions.provider));
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
    async send(input: SendMailInput): Promise<SendMailResult<string>> {
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
          providerName,
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
      const startedAt = performance.now();
      notify({ type: 'started', provider: providerName });
      try {
        const result = await runWithProvider((provider) => provider.send(normalized));
        if (typeof result?.messageId !== 'string' || result.messageId.trim().length === 0) {
          throw new MailError('The provider returned no message identifier.', 'provider', providerName, false, {
            deliveryUnknown: true,
          });
        }
        for (const recipients of [result.accepted, result.rejected]) {
          if (
            recipients !== undefined &&
            (!Array.isArray(recipients) ||
              recipients.some((recipient: unknown) => typeof recipient !== 'string' || !recipient.trim()))
          ) {
            throw new MailError(
              'The provider returned an invalid recipient receipt.',
              'provider',
              providerName,
              false,
              { deliveryUnknown: true },
            );
          }
        }
        const receipt: SendMailResult<string> = {
          ...(result.accepted ? { accepted: [...result.accepted] } : {}),
          ...(result.rejected ? { rejected: [...result.rejected] } : {}),
          provider: providerName,
          messageId: result.messageId,
          acceptedAt: new Date(),
        };
        notify({ type: 'succeeded', provider: providerName, durationMs: performance.now() - startedAt });
        return receipt;
      } catch (error) {
        const normalizedError = normalizeProviderError(error, providerName, 'send');
        notify({
          type: 'failed',
          provider: providerName,
          durationMs: performance.now() - startedAt,
          code: normalizedError.code,
          retryable: normalizedError.retryable,
          deliveryUnknown: normalizedError.deliveryUnknown,
        });
        throw normalizedError;
      }
    },
    async verifyConnection(): Promise<void> {
      try {
        await runWithProvider((provider) => provider.verifyConnection());
      } catch (error) {
        throw normalizeProviderError(error, providerName);
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
  CustomMailerOptions,
  MailAddress,
  MailAttachment,
  Mailer,
  MailSendEvent,
  MailSendObserver,
  NormalizedMailInput,
  ProviderAdapter,
  ProviderName,
  ProviderSendResult,
  SendMailInput,
  SendMailResult,
} from './types.js';
