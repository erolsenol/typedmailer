import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('Amazon SES adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the AWS credential chain and maps content, tags, headers, and attachments', async () => {
    mocks.sesSend.mockResolvedValue({ MessageId: 'ses-message-1' });
    const mailer = createMailer({ provider: 'ses', region: 'eu-west-1', from: 'Sender <sender@example.com>' });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      cc: 'copy@example.com',
      subject: 'Hello',
      text: 'Plain text',
      html: '<p>Hello</p>',
      replyTo: 'reply@example.com',
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      attachments: [
        { filename: 'report.txt', content: 'Report', contentType: 'text/plain' },
        { filename: 'logo.png', content: new Uint8Array([1, 2]), contentId: 'logo.png', contentType: 'image/png' },
      ],
    });

    expect(mocks.sesConfig).toHaveBeenCalledWith({ region: 'eu-west-1' });
    const command = mocks.sesSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      FromEmailAddress: 'Sender <sender@example.com>',
      Destination: { ToAddresses: ['reader@example.com'], CcAddresses: ['copy@example.com'] },
      ReplyToAddresses: ['reply@example.com'],
      EmailTags: [{ Name: 'tenant', Value: 'tenant-1' }],
      Content: {
        Simple: {
          Subject: { Data: 'Hello', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Plain text', Charset: 'UTF-8' }, Html: { Data: '<p>Hello</p>', Charset: 'UTF-8' } },
          Headers: [{ Name: 'X-Trace', Value: 'trace-1' }],
          Attachments: [
            {
              RawContent: new TextEncoder().encode('Report'),
              FileName: 'report.txt',
              ContentType: 'text/plain',
              ContentDisposition: 'ATTACHMENT',
              ContentTransferEncoding: 'BASE64',
            },
            {
              RawContent: new Uint8Array([1, 2]),
              FileName: 'logo.png',
              ContentType: 'image/png',
              ContentDisposition: 'INLINE',
              ContentTransferEncoding: 'BASE64',
              ContentId: 'logo.png',
            },
          ],
        },
      },
    });
    expect(result).toMatchObject({ provider: 'ses', messageId: 'ses-message-1' });
    await mailer.close();
    expect(mocks.sesDestroy).toHaveBeenCalledOnce();
  });

  it('normalizes AWS throttling and rejects unsupported idempotency', async () => {
    const mailer = createMailer({ provider: 'ses', region: 'us-east-1', from: 'sender@example.com' });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', idempotencyKey: 'key-1' }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'ses' });
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'ses' });
    mocks.sesSend.mockRejectedValue(
      Object.assign(new Error('throttled'), { name: 'ThrottlingException', $metadata: { httpStatusCode: 400 } }),
    );
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'rate_limit',
      provider: 'ses',
      retryable: true,
    });
  });
});
