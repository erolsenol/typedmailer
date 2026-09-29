import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('Postmark adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps common message fields and attachments and returns the provider message ID', async () => {
    mocks.postmarkSendEmail.mockResolvedValue({ MessageID: 'postmark-message-1' });
    const mailer = createMailer({
      provider: 'postmark',
      apiKey: 'postmark-token',
      from: { email: 'sender@example.com', name: 'Sender' },
    });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      cc: 'copy@example.com',
      subject: 'Hello',
      text: 'Plain text',
      html: '<p>Hello</p>',
      replyTo: 'reply@example.com',
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      attachments: [{ filename: 'hello.txt', content: 'Hello', contentType: 'text/plain' }],
    });

    expect(mocks.postmarkSendEmail).toHaveBeenCalledWith({
      From: 'Sender <sender@example.com>',
      To: 'Reader <reader@example.com>',
      Cc: 'copy@example.com',
      Subject: 'Hello',
      TextBody: 'Plain text',
      HtmlBody: '<p>Hello</p>',
      ReplyTo: 'reply@example.com',
      Headers: [{ Name: 'X-Trace', Value: 'trace-1' }],
      Metadata: { tenant: 'tenant-1' },
      Attachments: [{ Name: 'hello.txt', Content: 'SGVsbG8=', ContentType: 'text/plain', ContentID: null }],
    });
    expect(result).toMatchObject({ provider: 'postmark', messageId: 'postmark-message-1' });
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('rejects unsupported options and reports unsupported connection verification', async () => {
    const mailer = createMailer({ provider: 'postmark', apiKey: 'postmark-token', from: 'sender@example.com' });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', idempotencyKey: 'key-1' }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'postmark' });
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'postmark' });
    expect(mocks.postmarkSendEmail).not.toHaveBeenCalled();
  });

  it('normalizes provider failures', async () => {
    mocks.postmarkSendEmail.mockRejectedValue(Object.assign(new Error('bad token'), { statusCode: 401 }));
    const mailer = createMailer({ provider: 'postmark', apiKey: 'postmark-token', from: 'sender@example.com' });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'authentication',
      provider: 'postmark',
      retryable: false,
    });
  });

  it('marks an accepted response without a message ID as delivery-unknown', async () => {
    mocks.postmarkSendEmail.mockResolvedValue({});
    const mailer = createMailer({ provider: 'postmark', apiKey: 'postmark-token', from: 'sender@example.com' });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      provider: 'postmark',
      deliveryUnknown: true,
    });
  });
});
