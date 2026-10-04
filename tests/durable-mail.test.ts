import { describe, expect, it, vi } from 'vitest';
import { createMailer, MailError, type Mailer } from '../src/index.js';
import {
  acceptWebhookDelivery,
  createSqlOutboxStore,
  enqueueMail,
  processNextMail,
  type OutboxStore,
  type SqlDatabase,
} from '../examples/reliability/durable-mail.js';

const input = { to: 'reader@example.test', subject: 'Hello', text: 'Body' };
function store(): OutboxStore {
  return {
    claim: vi.fn(async () => ({ id: 'job-1', input })),
    accept: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

describe('durable mail examples', () => {
  it('awaits inbox persistence, deduplicates at the database boundary and rejects mixed-provider batches', async () => {
    let resolve: (() => void) | undefined;
    const query = vi.fn(
      () =>
        new Promise<{ rows: readonly Record<string, unknown>[] }>((done) => {
          resolve = () => done({ rows: [] });
        }),
    );
    const event = { provider: 'resend', type: 'delivered', eventType: 'email.delivered', raw: {} } as const;
    let committed = false;
    const pending = acceptWebhookDelivery({ query }, 'notification', [event]).then(() => {
      committed = true;
    });
    await Promise.resolve();
    expect(committed).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (provider, delivery_id) DO NOTHING'), [
      'resend',
      'notification',
      JSON.stringify([event]),
    ]);
    resolve?.();
    await pending;
    expect(committed).toBe(true);
    await expect(
      acceptWebhookDelivery({ query }, 'notification', [event, { ...event, provider: 'ses' }]),
    ).rejects.toThrow();
  });

  it('does not acknowledge a failed durable inbox commit', async () => {
    await expect(
      acceptWebhookDelivery(
        {
          query: async () => {
            throw new Error('database unavailable');
          },
        },
        'notification',
        [{ provider: 'resend', type: 'accepted', eventType: 'email.sent', raw: {} }],
      ),
    ).rejects.toThrow('database unavailable');
  });

  it('round-trips binary attachments through JSON storage and claims only queued rows atomically', async () => {
    const bytes = new Uint8Array([0, 127, 128, 255]);
    const query = vi.fn<SqlDatabase['query']>(async () => ({
      rows: [] as readonly Record<string, unknown>[],
    }));
    await enqueueMail({ query }, 'operation-1', { ...input, attachments: [{ filename: 'file.bin', content: bytes }] });
    const serialized = query.mock.calls[0]?.[1][1];
    if (typeof serialized !== 'string') throw new Error('Expected stored JSON');
    query.mockResolvedValueOnce({ rows: [{ id: 'operation-1', input: JSON.parse(serialized) }] });
    const job = await createSqlOutboxStore({ query }).claim();
    expect(job?.input.attachments?.[0]?.content).toEqual(bytes);
    expect(query.mock.calls[1]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[1]?.[0]).toContain("state = 'sending'");
  });

  it('marks SMTP partial results without retrying the complete recipient list', async () => {
    const query = vi.fn<SqlDatabase['query']>(async () => ({ rows: [{ id: 'job' }] }));
    await createSqlOutboxStore({ query }).accept('job', {
      provider: 'smtp',
      messageId: 'mail',
      acceptedAt: new Date(),
      accepted: ['one'],
      rejected: ['two'],
    });
    expect(query.mock.calls[0]?.[1]).toEqual(['job', 'partial', expect.any(String)]);
  });

  it('keeps uncertain sends for reconciliation and records definite failures without retry', async () => {
    for (const unknown of [true, false]) {
      const outbox = store();
      const send = vi.fn(async () => {
        throw new MailError('Safe', 'network', 'local', true, { deliveryUnknown: unknown });
      });
      const mailer: Mailer<string> = { send, close: async () => {}, verifyConnection: async () => {} };
      await processNextMail(mailer, outbox);
      expect(outbox.fail).toHaveBeenCalledWith('job-1', {
        state: unknown ? 'unknown' : 'failed',
        code: 'network',
        retryable: true,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(outbox.accept).not.toHaveBeenCalled();
    }
  });

  it('propagates a receipt persistence failure without relabeling accepted delivery or resending', async () => {
    const outbox = store();
    outbox.accept = vi.fn(async () => {
      throw new Error('commit failed');
    });
    const send = vi.fn(async () => ({ messageId: 'mail' }));
    const mailer = createMailer({ from: 'sender@example.test', provider: { name: 'local', send } });
    await expect(processNextMail(mailer, outbox)).rejects.toThrow('commit failed');
    expect(outbox.fail).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    await mailer.close();
  });

  it('leaves an empty outbox idle', async () => {
    const outbox = store();
    outbox.claim = vi.fn(async () => undefined);
    const mailer = createMailer({ from: 'sender@example.test', provider: { name: 'local', send: vi.fn() } });
    expect(await processNextMail(mailer, outbox)).toBe(false);
    expect(outbox.accept).not.toHaveBeenCalled();
    expect(outbox.fail).not.toHaveBeenCalled();
    await mailer.close();
  });
});
