import { MailError, type Mailer, type SendMailInput, type SendMailResult } from 'typedmailer';
import type { EmailWebhookEvent } from 'typedmailer/webhooks';

/** Implement using a database client. Inbox/worker queries must commit before resolving; enqueue may use a business transaction. */
export interface SqlDatabase {
  query(sql: string, values: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export interface OutboxJob {
  readonly id: string;
  readonly input: SendMailInput;
}

export interface OutboxFailure {
  readonly state: 'failed' | 'unknown';
  readonly code: string;
  readonly retryable: boolean;
}

export interface OutboxStore {
  claim(): Promise<OutboxJob | undefined>;
  accept(id: string, result: SendMailResult<string>): Promise<void>;
  fail(id: string, failure: OutboxFailure): Promise<void>;
}

/** One committed row per authenticated notification, including every normalized event. */
export async function acceptWebhookDelivery(
  database: SqlDatabase,
  deliveryId: string,
  events: readonly EmailWebhookEvent[],
): Promise<void> {
  const provider = events[0]?.provider;
  if (!deliveryId.trim() || !provider || events.some((event) => event.provider !== provider)) {
    throw new Error('Expected one provider and an authenticated notification ID.');
  }
  await database.query(
    `INSERT INTO mail_webhook_inbox (provider, delivery_id, events)
     VALUES ($1, $2, $3::jsonb) ON CONFLICT (provider, delivery_id) DO NOTHING`,
    [provider, deliveryId, JSON.stringify(events)],
  );
}

/** Validate input before calling; enqueue in the SAME transaction as the business change. */
export async function enqueueMail(database: SqlDatabase, id: string, input: SendMailInput): Promise<void> {
  if (!id.trim()) throw new Error('Expected a stable business operation ID.');
  await database.query(`INSERT INTO mail_outbox (id, input) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`, [
    id,
    JSON.stringify({
      ...input,
      ...(input.attachments
        ? {
            attachments: input.attachments.map((attachment) => ({
              ...attachment,
              content:
                typeof attachment.content === 'string'
                  ? attachment.content
                  : { encoding: 'typedmailer-bytes', base64: Buffer.from(attachment.content).toString('base64') },
            })),
          }
        : {}),
    }),
  ]);
}

/** Claim commits BEFORE network I/O. A crash leaves sending for reconciliation, never blind resend. */
export function createSqlOutboxStore(database: SqlDatabase): OutboxStore {
  return {
    async claim() {
      const result = await database.query(
        `WITH candidate AS (
           SELECT id FROM mail_outbox WHERE state = 'queued'
           ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
         ) UPDATE mail_outbox SET state = 'sending', updated_at = now()
           FROM candidate WHERE mail_outbox.id = candidate.id
           RETURNING mail_outbox.id, mail_outbox.input`,
        [],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      if (typeof row.id !== 'string') throw new Error('Invalid outbox row ID.');
      // Stored JSON comes from validated application input. The mailer validates again before sending.
      const input = JSON.parse(JSON.stringify(row.input), (_key, value: unknown) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'encoding' in value &&
          value.encoding === 'typedmailer-bytes' &&
          'base64' in value &&
          typeof value.base64 === 'string'
        ) {
          return new Uint8Array(Buffer.from(value.base64, 'base64'));
        }
        return value;
      }) as SendMailInput;
      return { id: row.id, input };
    },
    async accept(id, result) {
      const updated = await database.query(
        `UPDATE mail_outbox SET state = $2, receipt = $3::jsonb, updated_at = now()
         WHERE id = $1 AND state = 'sending' RETURNING id`,
        [id, result.rejected?.length ? 'partial' : 'accepted', JSON.stringify(result)],
      );
      if (updated.rows[0]?.id !== id) throw new Error('Outbox receipt was not committed.');
    },
    async fail(id, failure) {
      const updated = await database.query(
        `UPDATE mail_outbox SET state = $2, failure = $3::jsonb, updated_at = now()
         WHERE id = $1 AND state = 'sending' RETURNING id`,
        [id, failure.state, JSON.stringify(failure)],
      );
      if (updated.rows[0]?.id !== id) throw new Error('Outbox failure was not committed.');
    },
  };
}

/** No automatic retry: the application reconciles unknown and partial delivery states. */
export async function processNextMail(mailer: Mailer<string>, store: OutboxStore): Promise<boolean> {
  const job = await store.claim();
  if (!job) return false;
  let result: SendMailResult<string>;
  try {
    result = await mailer.send(job.input);
  } catch (error) {
    const failure: OutboxFailure =
      error instanceof MailError
        ? { state: error.deliveryUnknown ? 'unknown' : 'failed', code: error.code, retryable: error.retryable }
        : { state: 'unknown', code: 'unclassified', retryable: false };
    await store.fail(job.id, failure);
    return true;
  }
  // Persistence failures propagate. Never reinterpret an accepted send as a send failure.
  await store.accept(job.id, result);
  return true;
}
