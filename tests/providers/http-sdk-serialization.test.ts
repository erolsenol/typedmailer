import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { createMailer } from '../../src/index.js';
import type { ProviderName, SendMailInput } from '../../src/types.js';

// Disable SDK retry delays in this transport test; serialization and error decoding stay real.
vi.mock('@getbrevo/brevo', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@getbrevo/brevo')>();
  return {
    ...sdk,
    BrevoClient: class extends sdk.BrevoClient {
      constructor(options: ConstructorParameters<typeof sdk.BrevoClient>[0]) {
        super({ ...options, maxRetries: 0 });
      }
    },
  };
});

const cases = [
  {
    provider: 'brevo',
    origin: 'https://api.brevo.com',
    path: '/v3/smtp/email',
    status: 201,
    body: { messageId: 'brevo-real' },
  },
  {
    provider: 'postmark',
    origin: 'https://api.postmarkapp.com',
    path: '/email',
    status: 200,
    body: { MessageID: 'postmark-real', ErrorCode: 0 },
  },
  { provider: 'sendgrid', origin: 'https://api.sendgrid.com', path: '/v3/mail/send', status: 202, body: {} },
  {
    provider: 'mailgun',
    origin: 'https://api.mailgun.net',
    path: '/v3/example.test/messages',
    status: 200,
    body: { id: 'mailgun-real', message: 'Queued' },
  },
] as const;

const input: SendMailInput = {
  to: { email: 'reader@example.test', name: 'Reader' },
  cc: 'cc@example.test',
  bcc: 'bcc@example.test',
  replyTo: { email: 'support@example.test', name: 'Support' },
  subject: 'İstanbul 🌍',
  text: 'UTF-8 İstanbul',
  html: '<p>İstanbul</p>',
  headers: { 'X-Trace': 'trace' },
  attachments: [
    { filename: 'utf8.txt', content: 'İstanbul 🌍', contentType: 'text/plain' },
    { filename: 'binary.bin', content: new Uint8Array([0, 127, 128, 255]), contentType: 'application/octet-stream' },
  ],
};
const apiKey = 'SG.local-test-key.local-test-secret';
function mailer(provider: Exclude<ProviderName, 'resend' | 'ses' | 'smtp'>) {
  const from = { email: 'sender@example.test', name: 'Sender' };
  return provider === 'mailgun'
    ? createMailer({ provider, apiKey, from, domain: 'example.test' })
    : createMailer({ provider, apiKey, from });
}

beforeEach(() => nock.disableNetConnect());
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('real HTTP SDK serialization', () => {
  it.each(cases)('$provider serializes common fields and exact UTF-8/binary attachments', async (fixture) => {
    let body: unknown;
    const scope = nock(fixture.origin)
      .post(fixture.path)
      .reply(
        fixture.status,
        function (_uri, requestBody) {
          body = requestBody;
          return fixture.body;
        },
        { 'x-message-id': 'sendgrid-real' },
      );
    const client = mailer(fixture.provider);
    try {
      await expect(client.send(input)).resolves.toMatchObject({ messageId: `${fixture.provider}-real` });
      scope.done();
      const utf8 = Buffer.from('İstanbul 🌍').toString('base64');
      if (fixture.provider === 'brevo')
        expect(body).toMatchObject({
          sender: { email: 'sender@example.test', name: 'Sender' },
          to: [{ email: 'reader@example.test', name: 'Reader' }],
          cc: [{ email: 'cc@example.test' }],
          bcc: [{ email: 'bcc@example.test' }],
          replyTo: { email: 'support@example.test', name: 'Support' },
          subject: input.subject,
          textContent: input.text,
          headers: { 'X-Trace': 'trace' },
          attachment: [
            { name: 'utf8.txt', content: utf8 },
            { name: 'binary.bin', content: 'AH+A/w==' },
          ],
        });
      if (fixture.provider === 'postmark')
        expect(body).toMatchObject({
          From: 'Sender <sender@example.test>',
          To: 'Reader <reader@example.test>',
          Cc: 'cc@example.test',
          Bcc: 'bcc@example.test',
          ReplyTo: 'Support <support@example.test>',
          Subject: input.subject,
          TextBody: input.text,
          Attachments: [
            { Name: 'utf8.txt', Content: utf8 },
            { Name: 'binary.bin', Content: 'AH+A/w==' },
          ],
        });
      if (fixture.provider === 'sendgrid')
        expect(body).toMatchObject({
          from: { email: 'sender@example.test', name: 'Sender' },
          reply_to: { email: 'support@example.test', name: 'Support' },
          subject: input.subject,
          personalizations: [
            {
              to: [{ email: 'reader@example.test', name: 'Reader' }],
              cc: [{ email: 'cc@example.test' }],
              bcc: [{ email: 'bcc@example.test' }],
            },
          ],
          attachments: [
            { filename: 'utf8.txt', content: utf8 },
            { filename: 'binary.bin', content: 'AH+A/w==' },
          ],
        });
      if (fixture.provider === 'mailgun') {
        // Nock represents binary multipart bodies as hex. Decode before checking exact bytes.
        const bytes =
          typeof body === 'string'
            ? Buffer.from(body, /^[a-f0-9]+$/i.test(body) ? 'hex' : 'utf8')
            : Buffer.from(JSON.stringify(body));
        const text = bytes.toString('utf8');
        expect(text).toContain('Sender <sender@example.test>');
        expect(text).toContain('Reader <reader@example.test>');
        expect(text).toContain('cc@example.test');
        expect(text).toContain('bcc@example.test');
        expect(text).toContain('Support <support@example.test>');
        expect(text).toContain('İstanbul 🌍');
        expect(text).toContain('filename="binary.bin"');
        expect(bytes.includes(Buffer.from([0, 127, 128, 255]))).toBe(true);
      }
    } finally {
      await client.close();
    }
  });

  it.each(cases.filter((fixture) => fixture.provider !== 'brevo'))(
    '$provider preserves inline content IDs through the SDK',
    async (fixture) => {
      let body: unknown;
      const scope = nock(fixture.origin)
        .post(fixture.path)
        .reply(
          fixture.status,
          function (_uri, requestBody) {
            body = requestBody;
            return fixture.body;
          },
          { 'x-message-id': 'sendgrid-real' },
        );
      const client = mailer(fixture.provider);
      try {
        await client.send({
          ...input,
          attachments: [{ filename: 'logo.png', content: new Uint8Array([1, 2]), contentId: 'logo' }],
        });
        scope.done();
        if (fixture.provider === 'postmark')
          expect(body).toMatchObject({ Attachments: [{ ContentID: 'logo', Content: 'AQI=' }] });
        if (fixture.provider === 'sendgrid')
          expect(body).toMatchObject({ attachments: [{ content_id: 'logo', disposition: 'inline', content: 'AQI=' }] });
        if (fixture.provider === 'mailgun') expect(String(body)).toContain('filename="logo"');
      } finally {
        await client.close();
      }
    },
  );

  describe.each(cases)('$provider HTTP errors', (fixture) => {
    it.each([401, 429, 503])('decodes status %i with conservative delivery uncertainty', async (status) => {
      const scope = nock(fixture.origin)
        .post(fixture.path)
        .reply(
          status,
          { ErrorCode: 10, Message: 'fixture', message: 'fixture', code: 'fixture', errors: [{ message: 'fixture' }] },
          { 'Retry-After': '7' },
        );
      const client = mailer(fixture.provider);
      try {
        await expect(client.send(input)).rejects.toMatchObject({
          provider: fixture.provider,
          status,
          code: status === 401 ? 'authentication' : status === 429 ? 'rate_limit' : 'provider',
          retryable: status !== 401,
          deliveryUnknown: status === 503,
        });
        scope.done();
      } finally {
        await client.close();
      }
    });
  });
});
