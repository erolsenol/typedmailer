import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import {
  acceptWebhookDelivery,
  createSqlOutboxStore,
  enqueueMail,
  type SqlDatabase,
} from '../examples/reliability/durable-mail.js';

const schema = readFileSync(new URL('../examples/reliability/schema.sql', import.meta.url), 'utf8');
describe('durable example SQL on embedded PostgreSQL', () => {
  it('deduplicates inbox deliveries, persists binary input, claims once, and records partial/unknown receipts', async () => {
    const pg = new PGlite();
    const database: SqlDatabase = { query: (sql, values) => pg.query<Record<string, unknown>>(sql, [...values]) };
    try {
      await pg.exec(schema);
      const event = { provider: 'resend', type: 'accepted', eventType: 'email.sent', raw: {} } as const;
      await Promise.all([
        acceptWebhookDelivery(database, 'same-id', [event]),
        acceptWebhookDelivery(database, 'same-id', [event]),
      ]);
      expect((await pg.query('SELECT * FROM mail_webhook_inbox')).rows).toHaveLength(1);
      const input = {
        to: 'reader@example.test',
        subject: 'Hello',
        text: 'Body',
        attachments: [{ filename: 'bytes.bin', content: Buffer.from([0, 255]) }],
      };
      await enqueueMail(database, 'job-1', input);
      await enqueueMail(database, 'job-1', input);
      await enqueueMail(database, 'job-2', input);
      const store = createSqlOutboxStore(database);
      const [first, second] = await Promise.all([store.claim(), store.claim()]);
      expect(first?.id).not.toBe(second?.id);
      expect(first?.input.attachments?.[0]?.content).toEqual(new Uint8Array([0, 255]));
      expect(await store.claim()).toBeUndefined();
      await store.accept(first!.id, {
        provider: 'smtp',
        messageId: 'mail',
        acceptedAt: new Date(),
        accepted: ['one'],
        rejected: ['two'],
      });
      await store.fail(second!.id, { state: 'unknown', code: 'network', retryable: true });
      expect((await pg.query('SELECT state FROM mail_outbox ORDER BY id')).rows).toEqual([
        { state: 'partial' },
        { state: 'unknown' },
      ]);
      await expect(
        store.accept('job-1', { provider: 'smtp', messageId: 'mail', acceptedAt: new Date() }),
      ).rejects.toThrow('not committed');
    } finally {
      await pg.close();
    }
  }, 20_000);
});
