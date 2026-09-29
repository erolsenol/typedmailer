import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('Brevo adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps common fields, metadata, attachments, and the provider message ID', async () => {
    mocks.brevoSend.mockResolvedValue({ messageId: 'brevo-message-1' });
    const mailer = createMailer({
      provider: 'brevo',
      apiKey: 'brevo-token',
      from: { email: 'sender@example.com', name: 'Sender' },
    });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      subject: 'Hello',
      text: 'Plain text',
      replyTo: 'reply@example.com',
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      attachments: [{ filename: 'hello.txt', content: 'Hello', contentType: 'text/plain' }],
    });

    expect(mocks.brevoApiKey).toHaveBeenCalledWith({ apiKey: 'brevo-token' });
    expect(mocks.brevoSend).toHaveBeenCalledWith({
      sender: { email: 'sender@example.com', name: 'Sender' },
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      subject: 'Hello',
      textContent: 'Plain text',
      replyTo: { email: 'reply@example.com' },
      headers: { 'X-Trace': 'trace-1' },
      tags: ['tenant=tenant-1'],
      attachment: [{ name: 'hello.txt', content: Buffer.from('Hello').toString('base64') }],
    });
    expect(result).toMatchObject({ provider: 'brevo', messageId: 'brevo-message-1' });
  });

  it('rejects unsupported options and connection verification', async () => {
    const mailer = createMailer({ provider: 'brevo', apiKey: 'brevo-token', from: 'sender@example.com' });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', idempotencyKey: 'key-1' }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'brevo' });
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'brevo' });
    expect(mocks.brevoSend).not.toHaveBeenCalled();
  });

  it('marks an accepted response without a message ID as delivery-unknown', async () => {
    mocks.brevoSend.mockResolvedValue({});
    const mailer = createMailer({ provider: 'brevo', apiKey: 'brevo-token', from: 'sender@example.com' });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      provider: 'brevo',
      deliveryUnknown: true,
    });
  });
});
