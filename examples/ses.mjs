import { createMailer } from 'typedmailer';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your environment.`);
  return value;
};

const mailer = createMailer({
  provider: 'ses',
  region: required('AWS_REGION'),
  from: required('MAIL_FROM'),
});

try {
  const result = await mailer.send({
    to: required('MAIL_TO'),
    subject: 'TypedMailer Amazon SES example',
    text: 'This message was sent with TypedMailer and Amazon SES.',
  });
  console.log(`Provider accepted message ${result.messageId}.`);
} finally {
  await mailer.close();
}
