import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('Resend adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps common fields, binary attachments, idempotency, and the accepted message ID', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-message-1' }, error: null });
    const mailer = createMailer({ provider: 'resend', apiKey: 'resend-token', from: 'Sender <sender@example.com>' });

    const result = await mailer.send({
      to: [{ email: 'reader@example.com', name: 'Reader' }],
      cc: 'copy@example.com',
      subject: 'Hello',
      text: 'Plain text',
      html: '<p>Hello</p>',
      headers: { 'X-Trace': 'trace-1' },
      metadata: { tenant: 'tenant-1' },
      idempotencyKey: 'send-1',
      attachments: [{ filename: 'hello.txt', content: new Uint8Array([72, 105]), contentId: 'hello' }],
    });

    expect(mocks.resendApiKey).toHaveBeenCalledWith('resend-token');
    expect(mocks.resendSend).toHaveBeenCalledWith(
      {
        from: 'Sender <sender@example.com>',
        to: ['reader@example.com'],
        cc: ['copy@example.com'],
        subject: 'Hello',
        text: 'Plain text',
        html: '<p>Hello</p>',
        headers: { 'X-Trace': 'trace-1' },
        tags: [{ name: 'tenant', value: 'tenant-1' }],
        attachments: [{ filename: 'hello.txt', content: Buffer.from([72, 105]), contentId: 'hello' }],
      },
      { idempotencyKey: 'send-1' },
    );
    expect(result).toMatchObject({ provider: 'resend', messageId: 'resend-message-1' });
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('rejects custom message IDs and connection verification', async () => {
    const mailer = createMailer({ provider: 'resend', apiKey: 'resend-token', from: 'sender@example.com' });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', messageId: '<custom@example.com>' }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'resend' });
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'unsupported', provider: 'resend' });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('preserves large binary attachments, content types, and inline IDs', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-large-message' }, error: null });
    const largeContent = Uint8Array.from({ length: 1024 * 1024 }, (_, index) => index % 256);
    const mailer = createMailer({ provider: 'resend', apiKey: 'resend-token', from: 'sender@example.com' });

    await mailer.send({
      to: 'reader@example.com',
      subject: 'Attachment',
      text: 'Attached',
      attachments: [
        { filename: 'large.bin', content: largeContent, contentType: 'application/octet-stream' },
        { filename: 'logo.png', content: new Uint8Array([1, 2]), contentType: 'image/png', contentId: 'logo' },
      ],
    });

    const sent = mocks.resendSend.mock.calls[0]?.[0] as {
      attachments: Array<{ content: Buffer; contentType?: string; contentId?: string }>;
    };
    expect(sent.attachments[0]?.content.equals(Buffer.from(largeContent))).toBe(true);
    expect(sent.attachments[0]?.contentType).toBe('application/octet-stream');
    expect(sent.attachments[1]).toMatchObject({ contentType: 'image/png', contentId: 'logo' });
  });

  it('normalizes SDK errors and rejects a response without an ID', async () => {
    mocks.resendSend.mockResolvedValue({ data: null, error: { statusCode: 401, message: 'secret token rejected' } });
    const mailer = createMailer({ provider: 'resend', apiKey: 'resend-token', from: 'sender@example.com' });

    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'authentication',
      retryable: false,
      message: 'The email provider rejected the configured credentials.',
    });

    mocks.resendSend.mockResolvedValue({ data: {}, error: null });
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'provider',
      provider: 'resend',
      deliveryUnknown: true,
    });
  });
});
