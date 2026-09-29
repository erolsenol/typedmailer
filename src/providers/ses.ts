import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { addressWithName, emailOf } from '../config.js';
import { MailError, normalizeProviderError } from '../errors.js';
import type { MailProvider, NormalizedMailInput } from '../types.js';

interface SesOptions {
  region: string;
}

export function createSesProvider(options: SesOptions): MailProvider {
  const client = new SESv2Client({ region: options.region });

  return {
    async send(input: NormalizedMailInput) {
      try {
        if (input.messageId || input.idempotencyKey) {
          throw new MailError(
            'Amazon SES does not support custom message IDs or idempotency keys through this adapter.',
            'unsupported',
            'ses',
            false,
          );
        }

        const response = await client.send(
          new SendEmailCommand({
            FromEmailAddress: formatAddress(input.from),
            Destination: {
              ToAddresses: input.to.map(emailOf),
              ...(input.cc ? { CcAddresses: input.cc.map(emailOf) } : {}),
              ...(input.bcc ? { BccAddresses: input.bcc.map(emailOf) } : {}),
            },
            ...(input.replyTo ? { ReplyToAddresses: [emailOf(input.replyTo)] } : {}),
            ...(input.metadata
              ? { EmailTags: Object.entries(input.metadata).map(([Name, Value]) => ({ Name, Value })) }
              : {}),
            Content: {
              Simple: {
                Subject: { Data: input.subject, Charset: 'UTF-8' },
                Body: {
                  ...(input.text !== undefined ? { Text: { Data: input.text, Charset: 'UTF-8' } } : {}),
                  ...(input.html !== undefined ? { Html: { Data: input.html, Charset: 'UTF-8' } } : {}),
                },
                ...(input.headers
                  ? { Headers: Object.entries(input.headers).map(([Name, Value]) => ({ Name, Value })) }
                  : {}),
                ...(input.attachments
                  ? {
                      Attachments: input.attachments.map((attachment) => ({
                        RawContent:
                          typeof attachment.content === 'string'
                            ? new TextEncoder().encode(attachment.content)
                            : attachment.content,
                        FileName: attachment.filename,
                        ContentType: attachment.contentType ?? 'application/octet-stream',
                        ContentDisposition: attachment.contentId ? 'INLINE' : 'ATTACHMENT',
                        ContentTransferEncoding: 'BASE64',
                        ...(attachment.contentId ? { ContentId: attachment.contentId } : {}),
                      })),
                    }
                  : {}),
              },
            },
          }),
        );

        if (!response.MessageId) {
          throw new MailError('Amazon SES accepted no message identifier.', 'provider', 'ses', false, {
            deliveryUnknown: true,
          });
        }
        return { messageId: response.MessageId };
      } catch (error) {
        throw normalizeProviderError(error, 'ses', 'send');
      }
    },
    async verifyConnection() {
      throw new MailError(
        'Amazon SES does not support connection verification. Send a provider test message instead.',
        'unsupported',
        'ses',
        false,
      );
    },
    async close() {
      client.destroy();
    },
  };
}

function formatAddress(address: NormalizedMailInput['from']): string {
  const normalized = addressWithName(address);
  return normalized.name ? `${normalized.name} <${normalized.email}>` : normalized.email;
}
