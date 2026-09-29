import { vi } from 'vitest';

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

export function getProviderMocks() {
  return mocks;
}
