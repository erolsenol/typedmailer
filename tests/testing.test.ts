import { describe, expect, it } from 'vitest';
import { createTestMailer } from '../src/testing.js';

describe('createTestMailer', () => {
  it('captures sent messages and applies the default sender', async () => {
    const mailer = createTestMailer({ from: 'sender@example.com' });
    const result = await mailer.send({ to: 'reader@example.com', subject: 'Hello', text: 'Test' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      from: 'sender@example.com',
      to: 'reader@example.com',
      subject: 'Hello',
      text: 'Test',
    });
    expect(result.provider).toBe('test');
    expect(result.messageId).toBe('test-1');
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('preserves a per-message sender and clears captured messages', async () => {
    const mailer = createTestMailer({ from: 'default@example.com' });
    await mailer.send({ from: 'override@example.com', to: 'reader@example.com', subject: 'Hello', text: 'Test' });
    expect(mailer.sent[0]?.from).toBe('override@example.com');

    mailer.clear();
    expect(mailer.sent).toEqual([]);
  });
});
