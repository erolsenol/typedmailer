import { describe, expect, expectTypeOf, it } from 'vitest';
import { createMailer, type Mailer, type MailerOptions } from '../src/index.js';
import { createTestMailer } from '../src/testing.js';
import { mailInputSchema } from '../src/config.js';

const from = 'sender@example.test';
const options = [
  { provider: 'resend', apiKey: 'local-test-key', from },
  { provider: 'brevo', apiKey: 'local-test-key', from },
  { provider: 'postmark', apiKey: 'local-test-key', from },
  { provider: 'sendgrid', apiKey: 'local-test-key', from },
  { provider: 'mailgun', apiKey: 'local-test-key', domain: 'mg.example.test', from },
  { provider: 'ses', region: 'eu-west-1', from },
  { provider: 'smtp', host: 'localhost', port: 1025, secure: false, from },
] as const satisfies readonly MailerOptions[];

describe('mailer configuration contracts', () => {
  it.each(options)('rejects unknown configuration fields for $provider', (option) => {
    expect(() => createMailer({ ...option, misspelledOption: true })).toThrow();
  });

  it.each(['Name <a@b>', 'Name <not-an-email>', ' <sender@example.test>', 'Name\r\nInjected <sender@example.test>'])(
    'rejects invalid named senders consistently: %j',
    (invalidFrom) => {
      for (const option of options) expect(() => createMailer({ ...option, from: invalidFrom })).toThrow();
      expect(() => createTestMailer({ from: invalidFrom })).toThrow();
      expect(mailInputSchema.safeParse({ from: invalidFrom, to: from, subject: 'Hello', text: 'Hi' }).success).toBe(
        false,
      );
      expect(() =>
        createMailer({ provider: { name: 'custom', send: async () => ({ messageId: 'id' }) }, from: invalidFrom }),
      ).toThrow();
    },
  );

  it.each(['Sender <sender@example.test>', { email: from, name: 'Sender' }, from])(
    'accepts valid senders: %j',
    (validFrom) => {
      for (const option of options) expect(() => createMailer({ ...option, from: validFrom })).not.toThrow();
      expect(() => createTestMailer({ from: validFrom })).not.toThrow();
    },
  );

  it('preserves literal built-in provider names and provider unions', () => {
    expectTypeOf(createMailer(options[0])).toEqualTypeOf<Mailer<'resend'>>();
    expectTypeOf(createMailer(options[5])).toEqualTypeOf<Mailer<'ses'>>();
    expectTypeOf(createMailer(options[6])).toEqualTypeOf<Mailer<'smtp'>>();
    const option = Math.random() > 0.5 ? options[0] : options[5];
    expectTypeOf(createMailer(option)).toEqualTypeOf<Mailer<'resend' | 'ses'>>();
  });
});
