import type { Mailer, SendMailInput, SendMailResult } from './types.js';

export interface CapturedMail extends SendMailInput {
  readonly from: NonNullable<SendMailInput['from']>;
}

export interface TestMailer extends Mailer {
  readonly sent: CapturedMail[];
  clear(): void;
}

/** In-memory mailer for application tests and local flows. It never sends network requests. */
export function createTestMailer(options: { from: NonNullable<SendMailInput['from']> }): TestMailer {
  const sent: CapturedMail[] = [];
  return {
    sent,
    clear() { sent.length = 0; },
    async send(input): Promise<SendMailResult> {
      const message = { ...input, from: input.from ?? options.from };
      sent.push(message);
      return { provider: 'smtp', messageId: `test-${sent.length}`, acceptedAt: new Date() };
    },
    async verifyConnection() {},
    async close() {},
  };
}
