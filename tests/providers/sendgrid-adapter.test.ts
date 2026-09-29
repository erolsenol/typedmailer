import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer, MailError } from '../../src/index.js';

const mocks = getProviderMocks();

describe('SendGrid adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses an isolated client, maps common message fields, and extracts the message ID', async () => {
    mocks.sendGridSend.mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'sendgrid-message-1' } }, {}]);
    const mailer = createMailer({
      provider: 'sendgrid',
      apiKey: 'sendgrid-key',
      from: { email: 'sender@example.com', name: 'Sender' },
    });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      bcc: 'copy@example.com',
      subject: 'Hello',
      text: 'Plain text',
      replyTo: { email: 'reply@example.com', name: 'Reply' },
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      attachments: [{ filename: 'hello.txt', content: new Uint8Array([72, 105]), contentId: 'hello' }],
    });

    expect(mocks.sendGridSetApiKey).toHaveBeenCalledWith('sendgrid-key');
    expect(mocks.sendGridSend).toHaveBeenCalledWith({
      from: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      bcc: [{ email: 'copy@example.com' }],
      subject: 'Hello',
      text: 'Plain text',
      replyTo: { email: 'reply@example.com', name: 'Reply' },
      headers: { 'X-Trace': 'trace-1' },
      customArgs: { tenant: 'tenant-1' },
      attachments: [{ filename: 'hello.txt', content: 'SGk=', contentId: 'hello', disposition: 'inline' }],
    });
    expect(result).toMatchObject({ provider: 'sendgrid', messageId: 'sendgrid-message-1' });
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('rejects unsupported options, reports unsupported verification, and normalizes errors', async () => {
    const mailer = createMailer({ provider: 'sendgrid', apiKey: 'sendgrid-key', from: 'sender@example.com' });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', messageId: '<custom@example.com>' }),
    ).rejects.toBeInstanceOf(MailError);
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'sendgrid' });
    expect(mocks.sendGridSend).not.toHaveBeenCalled();

    mocks.sendGridSend.mockRejectedValue(Object.assign(new Error('limited'), { code: 429 }));
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      provider: 'sendgrid',
      code: 'rate_limit',
      retryable: true,
    });
  });

  it('fails if the SDK response does not include a message ID', async () => {
    mocks.sendGridSend.mockResolvedValue([{ statusCode: 202, headers: {} }, {}]);
    const mailer = createMailer({ provider: 'sendgrid', apiKey: 'sendgrid-key', from: 'sender@example.com' });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'provider',
      provider: 'sendgrid',
      retryable: false,
      deliveryUnknown: true,
    });
  });
});
