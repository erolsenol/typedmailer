import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('Mailgun adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('configures the EU endpoint and maps messages, metadata, and inline files', async () => {
    mocks.mailgunCreate.mockResolvedValue({ id: '<mailgun-message-1>' });
    const mailer = createMailer({
      provider: 'mailgun',
      apiKey: 'mailgun-key',
      domain: 'mg.example.com',
      region: 'eu',
      from: { email: 'sender@example.com', name: 'Sender' },
    });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      subject: 'Hello',
      html: '<img src="cid:logo.png">',
      replyTo: 'reply@example.com',
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      attachments: [
        { filename: 'report.txt', content: 'Report' },
        { filename: 'logo.png', content: new Uint8Array([1, 2]), contentId: 'logo.png', contentType: 'image/png' },
      ],
    });

    expect(mocks.mailgunClient).toHaveBeenCalledWith({
      username: 'api',
      key: 'mailgun-key',
      url: 'https://api.eu.mailgun.net',
    });
    expect(mocks.mailgunCreate).toHaveBeenCalledWith(
      'mg.example.com',
      expect.objectContaining({
        from: 'Sender <sender@example.com>',
        to: ['Reader <reader@example.com>'],
        subject: 'Hello',
        html: '<img src="cid:logo.png">',
        'h:Reply-To': 'reply@example.com',
        'h:X-Trace': 'trace-1',
        'v:tenant': 'tenant-1',
        attachment: [{ data: expect.any(Buffer), filename: 'report.txt' }],
        inline: [{ data: expect.any(Buffer), filename: 'logo.png', contentType: 'image/png' }],
      }),
    );
    expect(result).toMatchObject({ provider: 'mailgun', messageId: '<mailgun-message-1>' });
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('defaults to the US endpoint and rejects unsupported options', async () => {
    const mailer = createMailer({
      provider: 'mailgun',
      apiKey: 'mailgun-key',
      domain: 'mg.example.com',
      from: 'sender@example.com',
    });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', idempotencyKey: 'key-1' }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'mailgun' });
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'mailgun' });
    await mailer.close();
    expect(mocks.mailgunClient).toHaveBeenCalledWith({
      username: 'api',
      key: 'mailgun-key',
      url: 'https://api.mailgun.net',
    });
  });

  it('marks an accepted response without a message ID as delivery-unknown', async () => {
    mocks.mailgunCreate.mockResolvedValue({});
    const mailer = createMailer({
      provider: 'mailgun',
      apiKey: 'mailgun-key',
      domain: 'mg.example.com',
      from: 'sender@example.com',
    });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      provider: 'mailgun',
      deliveryUnknown: true,
    });
  });
});
