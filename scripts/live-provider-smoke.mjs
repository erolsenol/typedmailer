import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMailer } from '../dist/index.js';

const enabledProviders = (process.env.TYPEDMAILER_INTEGRATION_PROVIDERS ?? 'mailpit')
  .split(',')
  .map((provider) => provider.trim())
  .filter(Boolean);
const from = process.env.TYPEDMAILER_SMOKE_FROM;
const to = process.env.TYPEDMAILER_SMOKE_TO;
const mailpitApiUrl = new URL(process.env.TYPEDMAILER_MAILPIT_API_URL ?? 'http://127.0.0.1:8025/api/v1/');
mailpitApiUrl.pathname = `${mailpitApiUrl.pathname.replace(/\/+$/, '')}/`;

for (const provider of enabledProviders) {
  if (!['mailpit', 'resend', 'ses'].includes(provider)) {
    throw new Error(`Unsupported integration provider: ${provider}`);
  }
  if (provider !== 'mailpit' && (!from || !to)) {
    throw new Error(`${provider} smoke requires TYPEDMAILER_SMOKE_FROM and TYPEDMAILER_SMOKE_TO.`);
  }
  const sender = from ?? 'TypedMailer Smoke <sender@example.test>';
  const recipient = to ?? 'recipient@example.test';
  const smokeId = randomUUID();
  const subject = `TypedMailer smoke ${provider} ${smokeId}`;
  const body = `Controlled integration check ${smokeId}.`;
  const common = { from: sender };
  const mailer =
    provider === 'mailpit'
      ? createMailer({
          provider: 'smtp',
          host: process.env.TYPEDMAILER_MAILPIT_SMTP_HOST ?? '127.0.0.1',
          port: Number(process.env.TYPEDMAILER_MAILPIT_SMTP_PORT ?? 1025),
          secure: false,
          ...common,
        })
      : provider === 'resend'
        ? createMailer({ provider, apiKey: required('TYPEDMAILER_RESEND_API_KEY'), ...common })
        : createMailer({ provider, region: required('AWS_REGION'), ...common });
  try {
    if (provider === 'mailpit') await mailer.verifyConnection();
    const result = await mailer.send({
      to: recipient,
      subject,
      text: body,
    });
    assert.equal(result.provider, provider === 'mailpit' ? 'smtp' : provider);
    assert.ok(result.messageId, `${provider} did not return a message ID`);
    if (provider === 'mailpit') {
      await assertMailpitCapturedMessage(mailpitApiUrl, smokeId, subject, body, recipient);
    }
    process.stdout.write(`${provider}: accepted (${result.messageId})\n`);
  } finally {
    await mailer.close();
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this provider smoke.`);
  return value;
}

async function assertMailpitCapturedMessage(apiUrl, smokeId, subject, body, recipient) {
  const searchUrl = new URL('search', apiUrl);
  searchUrl.searchParams.set('query', `subject:${smokeId}`);
  const deadline = Date.now() + 15_000;
  let lastError;

  while (Date.now() < deadline) {
    let result;
    try {
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) throw new Error(`Mailpit search API returned HTTP ${response.status}.`);
      result = await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const message = result.messages?.find((item) => item.Subject === subject);
    if (message) {
      assert.ok(message.ID, 'Mailpit search did not return a message ID.');
      const rawUrl = new URL(`message/${encodeURIComponent(message.ID)}/raw`, apiUrl);
      const rawResponse = await fetch(rawUrl, { signal: AbortSignal.timeout(2_000) });
      if (!rawResponse.ok) throw new Error(`Mailpit raw message API returned HTTP ${rawResponse.status}.`);
      const rawMessage = await rawResponse.text();
      assert.ok(rawMessage.includes(subject), 'Mailpit did not retain the smoke subject.');
      assert.ok(rawMessage.includes(body), 'Mailpit did not retain the smoke body.');
      assert.ok(rawMessage.includes(recipient), 'Mailpit did not retain the smoke recipient.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Mailpit accepted SMTP but did not expose the message through its API.', { cause: lastError });
}
