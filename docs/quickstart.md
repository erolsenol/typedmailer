# TypedMailer quick start

Send your first message to a local inbox without provider credentials or a real recipient.

## 1. Install TypedMailer and its SMTP adapter

```sh
npm install typedmailer nodemailer
```

## 2. Start Mailpit

With Docker:

```sh
docker run --rm --name typedmailer-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.31.3
```

Or with Homebrew:

```sh
brew install mailpit
mailpit
```

Mailpit captures messages locally. Open its inbox at <http://127.0.0.1:8025>.

## 3. Create `send.mjs`

```js
import { createMailer } from 'typedmailer';

const mailer = createMailer({
  provider: 'smtp',
  host: '127.0.0.1',
  port: 1025,
  secure: false,
  from: 'TypedMailer Demo <sender@example.test>',
});

try {
  await mailer.verifyConnection();
  const result = await mailer.send({
    to: 'reader@example.test',
    subject: 'My first TypedMailer message',
    text: 'This message was captured by local Mailpit.',
  });

  console.log(`Mailpit accepted ${result.messageId}`);
} finally {
  await mailer.close();
}
```

## 4. Run it

```sh
node send.mjs
```

Check the captured message in Mailpit. Both addresses use the reserved `.test` domain; this setup sends nothing to the public internet.

To try a real provider, follow the provider-specific setup in the [README](../README.md#providers). To receive delivery, bounce, and complaint events, follow the [webhook guide](webhooks.md).
