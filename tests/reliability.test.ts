import { describe, expect, it, vi } from 'vitest';
import { createMailer, MailError, type MailSendEvent } from '../src/index.js';
import { normalizeProviderError } from '../src/errors.js';
import { createTestMailer } from '../src/testing.js';
import { normalizeResend, normalizeSes } from '../src/webhooks/normalize.js';
import { verifyWebhook } from '../src/webhooks.js';

describe('immutable test capture', () => {
  it('isolates nested addresses, headers, metadata and attachment bytes and never reuses IDs after clear', async () => {
    const from = { email: 'sender@example.com', name: 'Sender' };
    const to = [{ email: 'reader@example.com', name: 'Reader' }];
    const headers = { 'X-Test': 'original' };
    const metadata = { tenant: 'original' };
    const content = new Uint8Array([0, 255]);
    const attachments = [{ filename: 'original.bin', content }];
    const mailer = createTestMailer({ from });
    const input = { to, headers, metadata, attachments, subject: 'Hi', text: 'Body' };
    const first = await mailer.send(input);
    from.name = 'Changed';
    to[0]!.name = 'Changed';
    headers['X-Test'] = 'changed';
    metadata.tenant = 'changed';
    content[0] = 127;
    attachments[0]!.filename = 'changed';
    expect(mailer.sent[0]).toMatchObject({
      from: { name: 'Sender' },
      to: [{ name: 'Reader' }],
      headers: { 'X-Test': 'original' },
      metadata: { tenant: 'original' },
      attachments: [{ filename: 'original.bin', content: new Uint8Array([0, 255]) }],
    });
    mailer.clear();
    expect((await mailer.send(input)).messageId).not.toBe(first.messageId);
  });
});

describe('webhook event metadata', () => {
  it('preserves every Resend recipient without changing event cardinality', () => {
    const result = normalizeResend({ type: 'email.delivered', data: { to: ['one@example.com', 'two@example.com'] } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      recipient: 'one@example.com',
      recipients: ['one@example.com', 'two@example.com'],
    });
    expect(() => normalizeResend({ type: 'email.delivered', data: { to: ['one', 'two'] } }, 1)).toThrow();
  });

  it('keeps complaint timestamps even when no recipients or delivery object exist', () => {
    const timestamp = '2026-10-04T10:00:00Z';
    const events = normalizeSes(
      { notificationType: 'Complaint', mail: { messageId: 'mail' }, complaint: { timestamp } },
      1,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'complained', messageId: 'mail', occurredAt: new Date(timestamp) });
  });

  it('enforces recipient limits after falling back from unusable recipient records', () => {
    expect(() =>
      normalizeSes(
        { notificationType: 'Bounce', mail: { destination: ['one', 'two'] }, bounce: { bouncedRecipients: [{}] } },
        1,
      ),
    ).toThrow();
  });

  it('distinguishes real event IDs from legacy email-ID fallbacks', async () => {
    const result = await verifyWebhook({
      provider: 'postmark',
      authorization: 'secret',
      headers: { authorization: 'secret' },
      rawBody: JSON.stringify([
        { RecordType: 'Delivery', MessageID: 'same-mail' },
        { RecordType: 'Open', MessageID: 'same-mail' },
      ]),
    });
    expect(result.map((event) => event.id)).toEqual(['same-mail', 'same-mail']);
    expect(result.every((event) => event.eventId === undefined && event.deliveryId === undefined)).toBe(true);
  });
});

describe('structured errors', () => {
  it('exposes status and a provider retry delay without exposing response text in the message', () => {
    const result = normalizeProviderError(
      { response: { status: 429, headers: { 'Retry-After': '12' } }, message: 'secret' },
      'sendgrid',
      'send',
    );
    expect(result).toMatchObject({
      status: 429,
      retryAfterSeconds: 12,
      code: 'rate_limit',
      retryable: true,
      deliveryUnknown: false,
    });
    expect(result.message).not.toContain('secret');
  });

  it('supports HTTP dates and discards malformed, negative, or infinite retry delays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    try {
      expect(
        normalizeProviderError(
          { status: 429, headers: new Headers({ 'Retry-After': 'Sun, 04 Oct 2026 10:00:15 GMT' }) },
          'resend',
        ).retryAfterSeconds,
      ).toBe(15);
      for (const value of ['-1', 'Infinity', 'garbage']) {
        expect(
          normalizeProviderError({ status: 429, headers: { 'retry-after': value } }, 'resend').retryAfterSeconds,
        ).toBeUndefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves structured fields when reclassifying delivery uncertainty', () => {
    const error = new MailError('Safe', 'network', 'custom', true, {
      cause: { code: 'ETIMEDOUT' },
      status: 503,
      retryAfterSeconds: 5,
    });
    expect(normalizeProviderError(error, 'custom', 'send')).toMatchObject({
      deliveryUnknown: true,
      status: 503,
      retryAfterSeconds: 5,
    });
  });
});

describe('provider recipient receipts', () => {
  it('rejects malformed receipts conservatively instead of returning misleading acceptance', async () => {
    const mailer = createMailer({
      from: 'sender@example.com',
      provider: {
        name: 'local',
        async send() {
          // @ts-expect-error A JavaScript custom adapter can violate the receipt contract.
          const accepted: readonly string[] = 'invalid';
          return { messageId: 'mail', accepted };
        },
      },
    });
    await expect(mailer.send({ to: 'reader@example.com', subject: 'Hi', text: 'Body' })).rejects.toMatchObject({
      deliveryUnknown: true,
      code: 'provider',
    });
    await mailer.close();
  });
});

describe('send observers', () => {
  it('reports duration and sanitized failures without email content or credentials', async () => {
    const events: MailSendEvent[] = [];
    const mailer = createMailer({
      from: 'sender@example.com',
      provider: {
        name: 'local',
        async send() {
          throw { status: 503, message: 'secret' };
        },
      },
      onSend: (event) => {
        events.push(event);
      },
    });
    await expect(
      mailer.send({ to: 'reader@example.com', subject: 'Private', text: 'Secret body' }),
    ).rejects.toMatchObject({ status: 503, deliveryUnknown: true });
    expect(events[0]).toEqual({ type: 'started', provider: 'local' });
    expect(events[1]).toMatchObject({
      type: 'failed',
      provider: 'local',
      code: 'provider',
      retryable: true,
      deliveryUnknown: true,
    });
    expect(JSON.stringify(events)).not.toMatch(/reader|Private|Secret|secret/);
    await mailer.close();
  });

  it.each(['sync', 'async', 'pending'] as const)(
    'isolates %s observer behavior from successful send and close',
    async (mode) => {
      const mailer = createMailer({
        from: 'sender@example.com',
        provider: {
          name: 'local',
          async send() {
            return { messageId: 'mail' };
          },
        },
        onSend: () => {
          if (mode === 'sync') throw new Error('observer');
          return mode === 'async' ? Promise.reject(new Error('observer')) : new Promise<void>(() => {});
        },
      });
      await expect(mailer.send({ to: 'reader@example.com', subject: 'Hi', text: 'Body' })).resolves.toMatchObject({
        messageId: 'mail',
      });
      await mailer.close();
    },
  );

  it('emits successful completion and rejects malformed observers during construction', async () => {
    const observer = vi.fn();
    const mailer = createMailer({
      from: 'sender@example.com',
      provider: {
        name: 'local',
        async send() {
          return { messageId: 'mail' };
        },
      },
      onSend: observer,
    });
    await mailer.send({ to: 'reader@example.com', subject: 'Hi', text: 'Body' });
    expect(observer).toHaveBeenLastCalledWith({ type: 'succeeded', provider: 'local', durationMs: expect.any(Number) });
    expect(() =>
      // @ts-expect-error Runtime callers must also supply a function.
      createMailer({ provider: 'resend', apiKey: 'key', from: 'sender@example.com', onSend: 'invalid' }),
    ).toThrow();
    await mailer.close();
  });
});
