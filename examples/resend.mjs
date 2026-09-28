import { createMailer } from 'typedmailer';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your environment.`);
  return value;
};

const mailer = createMailer({
  provider: 'resend',
  apiKey: required('RESEND_API_KEY'),
  from: required('MAIL_FROM'),
});

try {
  const result = await mailer.send({
    to: required('MAIL_TO'),
    subject: 'TypedMailer Resend example',
    text: 'This message was sent with TypedMailer and Resend.',
    html: '<p>This message was sent with <strong>TypedMailer</strong> and Resend.</p>',
  });
  console.log(`Provider accepted message ${result.messageId}.`);
} finally {
  await mailer.close();
}
