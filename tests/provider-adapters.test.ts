import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resendApiKey: vi.fn(),
  resendSend: vi.fn(),
  brevoApiKey: vi.fn(),
  brevoSend: vi.fn(),
  smtpTransportOptions: vi.fn(),
  smtpSendMail: vi.fn(),
  smtpVerify: vi.fn(),
  smtpClose: vi.fn(),
  postmarkSendEmail: vi.fn(),
  sendGridSetApiKey: vi.fn(),
  sendGridSend: vi.fn(),
  mailgunCreate: vi.fn(),
  mailgunClient: vi.fn(),
  sesConfig: vi.fn(),
  sesSend: vi.fn(),
  sesDestroy: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    readonly emails = { send: (...args: unknown[]) => mocks.resendSend(...args) };

    constructor(apiKey: string) {
      mocks.resendApiKey(apiKey);
    }
  },
}));

vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: class {
    readonly transactionalEmails = { sendTransacEmail: (...args: unknown[]) => mocks.brevoSend(...args) };

    constructor(options: unknown) {
      mocks.brevoApiKey(options);
    }
  },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport(options: unknown) {
      mocks.smtpTransportOptions(options);
      return {
        sendMail: (...args: unknown[]) => mocks.smtpSendMail(...args),
        verify: (...args: unknown[]) => mocks.smtpVerify(...args),
        close: (...args: unknown[]) => mocks.smtpClose(...args),
      };
    },
  },
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

vi.mock('form-data', () => ({ default: class FormDataMock {} }));

vi.mock('mailgun.js', () => ({
  default: class {
    constructor(...args: unknown[]) {
      void args;
    }

    client(...args: unknown[]) {
      mocks.mailgunClient(...args);
      return { messages: { create: (...createArgs: unknown[]) => mocks.mailgunCreate(...createArgs) } };
    }
  },
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    constructor(config: unknown) {
      mocks.sesConfig(config);
    }

    send(command: { input: unknown }) {
      return mocks.sesSend(command);
    }

    destroy() {
      return mocks.sesDestroy();
    }
  },
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

import { createMailer, MailError } from '../src/index.js';

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
    });
  });
});

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
});

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
    expect(mocks.smtpVerify).toHaveBeenCalledOnce();
    expect(mocks.smtpClose).toHaveBeenCalledOnce();
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Again', text: 'Hi' })).rejects.toMatchObject({
      code: 'configuration',
      provider: 'smtp',
    });
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
});

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
