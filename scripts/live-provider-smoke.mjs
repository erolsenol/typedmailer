import assert from 'node:assert/strict';
import { createMailer } from '../dist/index.js';

const enabledProviders = (process.env.TYPEDMAILER_INTEGRATION_PROVIDERS ?? 'mailpit')
  .split(',')
  .map((provider) => provider.trim())
  .filter(Boolean);
const from = process.env.TYPEDMAILER_SMOKE_FROM;
const to = process.env.TYPEDMAILER_SMOKE_TO;

for (const provider of enabledProviders) {
  if (!['mailpit', 'resend', 'ses'].includes(provider)) {
    throw new Error(`Unsupported integration provider: ${provider}`);
  }
  if (provider !== 'mailpit' && (!from || !to)) {
    throw new Error(`${provider} smoke requires TYPEDMAILER_SMOKE_FROM and TYPEDMAILER_SMOKE_TO.`);
  }
  const sender = from ?? 'TypedMailer Smoke <sender@example.test>';
  const recipient = to ?? 'recipient@example.test';
  const common = { from: sender };
  const mailer =
    provider === 'mailpit'
      ? createMailer({ provider: 'smtp', host: '127.0.0.1', port: 1025, secure: false, ...common })
      : provider === 'resend'
        ? createMailer({ provider, apiKey: required('TYPEDMAILER_RESEND_API_KEY'), ...common })
        : createMailer({ provider, region: required('AWS_REGION'), ...common });
  try {
    if (provider === 'mailpit') await mailer.verifyConnection();
    const result = await mailer.send({
      to: recipient,
      subject: `TypedMailer integration smoke (${provider})`,
      text: `Controlled integration check at ${new Date().toISOString()}.`,
    });
    assert.equal(result.provider, provider === 'mailpit' ? 'smtp' : provider);
    assert.ok(result.messageId, `${provider} did not return a message ID`);
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
