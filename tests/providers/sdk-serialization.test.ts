import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer } from '../../src/index.js';

const transport = vi.hoisted(() => ({
  handle: vi.fn(async (request: unknown) => {
    void request;
    return {
      response: {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ MessageId: 'ses-sdk-message' })),
      },
    };
  }),
}));

// Keep real SDK serialization and signing; replace only its network transport.
vi.mock('@aws-sdk/client-sesv2', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@aws-sdk/client-sesv2')>();
  return {
    ...sdk,
    SESv2Client: class extends sdk.SESv2Client {
      constructor(options: ConstructorParameters<typeof sdk.SESv2Client>[0]) {
        super({
          ...options,
          credentials: { accessKeyId: 'local-test-key', secretAccessKey: 'local-test-secret' },
          requestHandler: transport,
          maxAttempts: 1,
        });
      }
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('real provider SDK serialization', () => {
  it('sends Base64 Resend attachment content that decodes to the original UTF-8 and binary bytes', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
      if (typeof options.body !== 'string') throw new Error('Expected a JSON request body.');
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: 'resend-sdk-message' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const mailer = createMailer({ provider: 'resend', apiKey: 'local-test-key', from: 'sender@example.test' });
    try {
      await mailer.send({
        to: 'reader@example.test',
        subject: 'Attachments',
        text: 'Local test',
        attachments: [
          { filename: 'utf8.txt', content: 'İstanbul 🌍', contentType: 'text/plain' },
          { filename: 'binary.bin', content: new Uint8Array([0, 127, 128, 255]), contentId: 'binary' },
          { filename: 'empty.txt', content: '' },
        ],
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        attachments: [
          { filename: 'utf8.txt', content: Buffer.from('İstanbul 🌍').toString('base64'), content_type: 'text/plain' },
          { filename: 'binary.bin', content: 'AH+A/w==', content_id: 'binary' },
          { filename: 'empty.txt', content: '' },
        ],
      });
    } finally {
      await mailer.close();
    }
  });

  it('preserves SES custom headers and attachments in the serialized HTTP body', async () => {
    const mailer = createMailer({ provider: 'ses', region: 'eu-west-1', from: 'sender@example.test' });
    try {
      const result = await mailer.send({
        to: 'reader@example.test',
        subject: 'Attachments',
        text: 'Local test',
        headers: { 'X-Trace': 'trace-1' },
        attachments: [{ filename: 'utf8.txt', content: 'İstanbul', contentType: 'text/plain', contentId: 'inline' }],
      });
      expect(result.messageId).toBe('ses-sdk-message');
      expect(transport.handle).toHaveBeenCalledOnce();
      const request = transport.handle.mock.calls[0]?.[0];
      if (typeof request !== 'object' || request === null || !('body' in request)) {
        throw new Error('Expected a serialized SES JSON request.');
      }
      const body = request.body;
      if (typeof body !== 'string' && !(body instanceof Uint8Array)) {
        throw new Error('Expected a string or binary SES request body.');
      }
      expect(JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8'))).toMatchObject({
        Content: {
          Simple: {
            Headers: [{ Name: 'X-Trace', Value: 'trace-1' }],
            Attachments: [
              {
                FileName: 'utf8.txt',
                RawContent: Buffer.from('İstanbul').toString('base64'),
                ContentType: 'text/plain',
                ContentDisposition: 'INLINE',
                ContentTransferEncoding: 'BASE64',
                ContentId: 'inline',
              },
            ],
          },
        },
      });
    } finally {
      await mailer.close();
    }
  });
});
