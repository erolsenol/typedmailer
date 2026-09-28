import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postmarkSendEmail: vi.fn(),
  sendGridSetApiKey: vi.fn(),
  sendGridSend: vi.fn(),
}));

vi.mock('postmark', () => ({
  ServerClient: class {
    constructor(...args: unknown[]) {
      void args;
    }

    sendEmail(...args: unknown[]) {
      return mocks.postmarkSendEmail(...args);
    }
  },
}));

vi.mock('@sendgrid/mail', () => ({
  MailService: class {
    setApiKey(...args: unknown[]) {
      return mocks.sendGridSetApiKey(...args);
    }

    send(...args: unknown[]) {
      return mocks.sendGridSend(...args);
    }
  },
}));

import { createMailer, MailError } from '../src/index.js';

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
});

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
    });
  });
});
