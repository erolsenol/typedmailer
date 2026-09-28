import { createMailer } from 'typedmailer';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your environment.`);
  return value;
};

const mailer = createMailer({
  provider: 'smtp',
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
  from: required('MAIL_FROM'),
});

try {
  await mailer.verifyConnection();
  const result = await mailer.send({
    to: required('MAIL_TO'),
    subject: 'TypedMailer Mailpit example',
    text: 'This message was sent to local Mailpit.',
  });
  console.log(`Mailpit accepted message ${result.messageId}.`);
} finally {
  await mailer.close();
}
