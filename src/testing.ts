import type { Mailer, SendMailInput, SendMailResult } from './types.js';
import { MailError } from './errors.js';
import { mailInputSchema } from './config.js';

export interface CapturedMail extends SendMailInput {
  readonly from: NonNullable<SendMailInput['from']>;
}

export interface TestMailer extends Mailer<'test'> {
  readonly sent: CapturedMail[];
  clear(): void;
}

/** In-memory mailer for application tests and local flows. It never sends network requests. */
export function createTestMailer(options: { from: NonNullable<SendMailInput['from']> }): TestMailer {
  const sent: CapturedMail[] = [];
  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new MailError('Mailer has been closed.', 'configuration', 'test', false);
  };
  return {
    sent,
    clear() {
      sent.length = 0;
    },
    async send(input): Promise<SendMailResult<'test'>> {
      assertOpen();
      const message = { ...input, from: input.from ?? options.from };
      mailInputSchema.parse(message);
      sent.push(message);
      return { provider: 'test', messageId: `test-${sent.length}`, acceptedAt: new Date() };
    },
    async verifyConnection() {
      assertOpen();
    },
    async close() {
      closed = true;
    },
  };
}
