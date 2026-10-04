import { describe, expect, it, vi } from 'vitest';
import { createMailer, MailError } from '../src/index.js';
import type { ProviderAdapter } from '../src/index.js';

describe('custom provider adapters', () => {
  it.each(['', '  '])('rejects an accepted custom response with a blank ID: %j', async (messageId) => {
    const mailer = createMailer({
      provider: { name: 'custom', send: async () => ({ messageId }) },
      from: 'sender@example.test',
    });
    await expect(mailer.send({ to: 'reader@example.test', subject: 'Hello', text: 'Hi' })).rejects.toMatchObject({
      code: 'provider',
      deliveryUnknown: true,
      retryable: false,
      provider: 'custom',
    });
    await mailer.close();
  });
  it('sends normalized mail through the public adapter API', async () => {
    const send = vi.fn(async () => ({ messageId: 'custom-message-1' }));
    const adapter: ProviderAdapter<'acme-mail'> = { name: 'acme-mail', send };
    const mailer = createMailer({ provider: adapter, from: 'sender@example.test' });

    const result = await mailer.send({ to: 'reader@example.test', subject: 'Hello', text: 'Hi' });

    expect(send).toHaveBeenCalledWith({
      from: 'sender@example.test',
      to: ['reader@example.test'],
      subject: 'Hello',
      text: 'Hi',
    });
    expect(result).toMatchObject({ provider: 'acme-mail', messageId: 'custom-message-1' });
    await mailer.close();
  });

  it('delegates verification and closes the adapter when supported', async () => {
    const verifyConnection = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const mailer = createMailer({
      provider: { name: 'lifecycle-mail', send: async () => ({ messageId: 'id' }), verifyConnection, close },
      from: 'sender@example.test',
    });

    await mailer.verifyConnection();
    await mailer.close();
    await mailer.close();

    expect(verifyConnection).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports unsupported verification and accepts an adapter without close', async () => {
    const mailer = createMailer({
      provider: { name: 'send-only-mail', send: async () => ({ messageId: 'id' }) },
      from: 'sender@example.test',
    });

    await expect(mailer.verifyConnection()).rejects.toMatchObject<Partial<MailError>>({
      code: 'unsupported',
      provider: 'send-only-mail',
    });
    await expect(mailer.close()).resolves.toBeUndefined();
  });

  it('rejects malformed adapter contracts', () => {
    expect(() =>
      createMailer({
        provider: { name: '  ', send: () => Promise.resolve({ messageId: 'id' }) },
        from: 'sender@example.test',
      }),
    ).toThrow();
  });
});
