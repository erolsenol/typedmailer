import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from '../provider-adapter-mocks.js';

import { createMailer } from '../../src/index.js';

const mocks = getProviderMocks();

describe('SMTP adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('configures authenticated STARTTLS, maps message IDs and inline attachments, and closes the transport', async () => {
    mocks.smtpSendMail.mockResolvedValue({ messageId: '<smtp-message-1>' });
    const mailer = createMailer({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'smtp-user',
      password: 'smtp-password',
      from: 'Sender <sender@example.com>',
    });

    const result = await mailer.send({
      to: 'reader@example.com',
      subject: 'Hello',
      text: 'Plain text',
      messageId: '<custom@example.com>',
      attachments: [{ filename: 'logo.png', content: new Uint8Array([1, 2]), contentId: 'logo' }],
    });

    expect(mocks.smtpTransportOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: 'smtp-user', pass: 'smtp-password' },
      }),
    );
    expect(mocks.smtpSendMail).toHaveBeenCalledWith({
      from: 'Sender <sender@example.com>',
      to: ['reader@example.com'],
      subject: 'Hello',
      messageId: '<custom@example.com>',
      text: 'Plain text',
      attachments: [{ filename: 'logo.png', content: Buffer.from([1, 2]), cid: 'logo' }],
    });
    expect(result).toMatchObject({ provider: 'smtp', messageId: '<smtp-message-1>' });

    mocks.smtpVerify.mockResolvedValue(undefined);
    await mailer.verifyConnection();
    await mailer.close();
    await mailer.close();
    expect(mocks.smtpVerify).toHaveBeenCalledOnce();
    expect(mocks.smtpClose).toHaveBeenCalledOnce();
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Again', text: 'Hi' })).rejects.toMatchObject({
      code: 'configuration',
      provider: 'smtp',
    });
  });

  it('waits for an in-flight send before closing and rejects later operations', async () => {
    let resolveSend: ((value: { messageId: string }) => void) | undefined;
    mocks.smtpSendMail.mockImplementation(
      () =>
        new Promise<{ messageId: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const mailer = createMailer({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: 'sender@example.com',
    });

    const sending = mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' });
    await vi.waitFor(() => expect(mocks.smtpSendMail).toHaveBeenCalledOnce());
    const closing = mailer.close();

    expect(mocks.smtpClose).not.toHaveBeenCalled();
    await expect(mailer.verifyConnection()).rejects.toMatchObject({ code: 'configuration', provider: 'smtp' });
    resolveSend?.({ messageId: '<in-flight-message>' });
    await expect(sending).resolves.toMatchObject({ messageId: '<in-flight-message>' });
    await closing;

    expect(mocks.smtpClose).toHaveBeenCalledOnce();
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Later', text: 'Hi' })).rejects.toMatchObject({
      code: 'configuration',
      provider: 'smtp',
    });
  });

  it('maps named address objects to Nodemailer address shapes', async () => {
    mocks.smtpSendMail.mockResolvedValue({ messageId: '<named-message>' });
    const mailer = createMailer({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: { email: 'sender@example.com', name: 'Sender' },
    });

    await mailer.send({
      to: { email: 'reader@example.com', name: 'Reader' },
      replyTo: { email: 'reply@example.com', name: 'Support' },
      subject: 'Hello',
      text: 'Hi',
    });

    expect(mocks.smtpSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { address: 'sender@example.com', name: 'Sender' },
        to: [{ address: 'reader@example.com', name: 'Reader' }],
        replyTo: { address: 'reply@example.com', name: 'Support' },
      }),
    );
    await mailer.close();
  });

  it('rejects unsupported metadata and normalizes transport errors', async () => {
    const mailer = createMailer({
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: 'sender@example.com',
    });

    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi', metadata: { tenant: 'tenant-1' } }),
    ).rejects.toMatchObject({ code: 'unsupported', provider: 'smtp' });

    mocks.smtpSendMail.mockRejectedValue(Object.assign(new Error('auth failed'), { code: 'EAUTH' }));
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'authentication',
      provider: 'smtp',
      retryable: false,
    });
  });
});
