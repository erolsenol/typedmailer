import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyWebhook } from '../src/webhooks.js';

const now = new Date('2026-09-29T12:00:00.000Z');

describe('verifyWebhook', () => {
  it('applies default body and event limits and supports explicit finite overrides', async () => {
    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: ' '.repeat(1_048_577),
        headers: {},
        authorization: 'test-token',
      }),
    ).rejects.toMatchObject({ name: 'WebhookVerificationError', code: 'invalid_payload' });

    const tooManyEvents = JSON.stringify(Array.from({ length: 1_001 }, () => ({ event: 'delivered' })));
    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: tooManyEvents,
        headers: { authorization: 'test-token' },
        authorization: 'test-token',
      }),
    ).rejects.toMatchObject({ name: 'WebhookVerificationError', code: 'invalid_payload' });

    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: JSON.stringify([{ event: 'delivered' }, { event: 'opened' }]),
        headers: { authorization: 'test-token' },
        authorization: 'test-token',
        maxEvents: 2,
      }),
    ).resolves.toHaveLength(2);

    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: '{}',
        headers: {},
        authorization: 'test-token',
        maxEvents: 0,
      }),
    ).rejects.toMatchObject({ name: 'WebhookVerificationError', code: 'invalid_payload' });
  });

  it('rejects oversized or invalid webhook body limits before parsing', async () => {
    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: '{ invalid json }',
        headers: {},
        authorization: 'test-token',
        maxBodyBytes: 4,
      }),
    ).rejects.toMatchObject({ name: 'WebhookVerificationError', code: 'invalid_payload' });

    await expect(
      verifyWebhook({
        provider: 'brevo',
        rawBody: '{}',
        headers: {},
        authorization: 'test-token',
        maxBodyBytes: 0,
      }),
    ).rejects.toMatchObject({ name: 'WebhookVerificationError', code: 'invalid_payload' });
  });

  it('verifies Resend signatures against the exact raw body and normalizes delivered events', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_123',
      type: 'email.delivered',
      created_at: now.toISOString(),
      data: { email_id: 'email_123', to: ['reader@example.test'] },
    });
    const secret = `whsec_${Buffer.from('test signing secret').toString('base64')}`;
    const messageId = 'msg_123';
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`${messageId}.${timestamp}.${rawBody}`)
      .digest('base64');

    const events = await verifyWebhook({
      provider: 'resend',
      rawBody: Buffer.from(rawBody),
      headers: {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
      webhookSecret: secret,
      now,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'resend',
      id: 'evt_123',
      eventId: 'evt_123',
      deliveryId: 'msg_123',
      type: 'delivered',
      eventType: 'email.delivered',
      messageId: 'email_123',
      recipient: 'reader@example.test',
      occurredAt: now,
    });
  });

  it('rejects a Resend signature when the raw body has changed', async () => {
    const secret = `whsec_${Buffer.from('test signing secret').toString('base64')}`;
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`msg_123.${timestamp}.{}`)
      .digest('base64');

    await expect(
      verifyWebhook({
        provider: 'resend',
        rawBody: '{ }',
        headers: {
          'svix-id': 'msg_123',
          'svix-timestamp': timestamp,
          'svix-signature': `v1,${signature}`,
        },
        webhookSecret: secret,
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('verifies Mailgun HMAC signatures and normalizes its event-data envelope', async () => {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const token = 'unique-token';
    const signingKey = 'mailgun signing key';
    const signature = createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
    const rawBody = JSON.stringify({
      signature: { timestamp, token, signature },
      'event-data': {
        id: 'mailgun-event-1',
        event: 'complained',
        timestamp: now.getTime() / 1000,
        recipient: 'reader@example.test',
        message: { headers: { 'message-id': '<mailgun-message-1>' } },
      },
    });

    const events = await verifyWebhook({ provider: 'mailgun', rawBody, headers: {}, signingKey, now });

    expect(events[0]).toMatchObject({
      provider: 'mailgun',
      id: 'mailgun-event-1',
      type: 'complained',
      messageId: '<mailgun-message-1>',
      recipient: 'reader@example.test',
    });
  });

  it('verifies SendGrid ECDSA signatures for a batch and maps each event', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const rawBody = JSON.stringify([
      { sg_event_id: 'sg-1', sg_message_id: 'sg-message', event: 'delivered', email: 'reader@example.test' },
      { sg_event_id: 'sg-2', sg_message_id: 'sg-message', event: 'open', email: 'reader@example.test' },
    ]);
    const signature = sign('sha256', Buffer.from(`${timestamp}${rawBody}`), privateKey).toString('base64');

    const events = await verifyWebhook({
      provider: 'sendgrid',
      rawBody,
      headers: {
        'x-twilio-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': signature,
      },
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      now,
    });

    expect(events.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'sg-1', type: 'delivered' },
      { id: 'sg-2', type: 'opened' },
    ]);
  });

  it.each(['brevo', 'postmark'] as const)(
    'authenticates %s webhook requests with a configured shared header',
    async (provider) => {
      const events = await verifyWebhook({
        provider,
        rawBody: JSON.stringify({ event: provider === 'brevo' ? 'delivered' : undefined, RecordType: 'Delivery' }),
        headers: { authorization: 'Bearer webhook-secret' },
        authorization: 'Bearer webhook-secret',
        now,
      });

      expect(events[0]).toMatchObject({ provider, type: 'delivered' });
    },
  );

  it('rejects Amazon SNS messages with untrusted certificate URLs before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const rawBody = JSON.stringify({
        Type: 'Notification',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
        SignatureVersion: '2',
        Signature: Buffer.from('signature').toString('base64'),
        SigningCertURL: 'https://attacker.example/cert.pem',
        Message: JSON.stringify({ eventType: 'Delivery' }),
      });

      await expect(
        verifyWebhook({
          provider: 'ses',
          rawBody,
          headers: {},
          topicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
          now,
        }),
      ).rejects.toMatchObject({ code: 'invalid_signature' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects malformed Amazon SNS certificate URLs as a verification error', async () => {
    const rawBody = JSON.stringify({
      Type: 'Notification',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
      SignatureVersion: '2',
      Signature: Buffer.from('signature').toString('base64'),
      SigningCertURL: 'not a URL',
      Message: JSON.stringify({ eventType: 'Delivery' }),
    });

    await expect(
      verifyWebhook({
        provider: 'ses',
        rawBody,
        headers: {},
        topicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('verifies a signed Amazon SNS SES notification and rejects a modified signed message', async () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'typedmailer-sns-test-'));
    try {
      const keyPath = join(fixtureDirectory, 'key.pem');
      const certificatePath = join(fixtureDirectory, 'certificate.pem');
      const generated = spawnSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certificatePath,
          '-sha256',
          '-days',
          '2',
          '-nodes',
          '-subj',
          '/CN=Amazon SNS',
        ],
        { encoding: 'utf8' },
      );
      expect(generated.status, generated.stderr).toBe(0);
      const certificate = readFileSync(certificatePath, 'utf8');
      const privateKey = readFileSync(keyPath, 'utf8');
      const snsNow = new Date();
      const topicArn = 'arn:aws:sns:us-east-1:123456789012:mail-events';
      const sesEvent = {
        eventType: 'Delivery',
        mail: {
          messageId: 'ses-message-1',
          destination: ['reader@example.test'],
        },
        delivery: { timestamp: snsNow.toISOString() },
      };
      const envelope = {
        Type: 'Notification',
        MessageId: 'sns-message-1',
        TopicArn: topicArn,
        Message: JSON.stringify(sesEvent),
        Timestamp: snsNow.toISOString(),
        SignatureVersion: '2',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem',
      };
      const stringToSign =
        [
          'Message',
          envelope.Message,
          'MessageId',
          envelope.MessageId,
          'Timestamp',
          envelope.Timestamp,
          'TopicArn',
          envelope.TopicArn,
          'Type',
          envelope.Type,
        ].join('\n') + '\n';
      const signature = sign('sha256', Buffer.from(stringToSign), privateKey).toString('base64');
      const fetchMock = vi.fn(async () => new Response(certificate, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const events = await verifyWebhook({
          provider: 'ses',
          rawBody: JSON.stringify({ ...envelope, Signature: signature }),
          headers: {},
          topicArn,
          now: snsNow,
        });
        expect(events[0]).toMatchObject({
          provider: 'ses',
          type: 'delivered',
          messageId: 'ses-message-1',
          deliveryId: 'sns-message-1',
          recipient: 'reader@example.test',
        });

        await expect(
          verifyWebhook({
            provider: 'ses',
            rawBody: JSON.stringify({
              ...envelope,
              Message: JSON.stringify({ ...sesEvent, eventType: 'Bounce' }),
              Signature: signature,
            }),
            headers: {},
            topicArn,
            now: snsNow,
          }),
        ).rejects.toMatchObject({ code: 'invalid_signature' });
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('cancels oversized SNS certificate streams before buffering the complete body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(20_000));
      },
      cancel,
    });
    vi.stubGlobal('fetch', async () => new Response(body));
    try {
      await expect(
        verifyWebhook({
          provider: 'ses',
          topicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
          headers: {},
          rawBody: JSON.stringify({
            Type: 'Notification',
            MessageId: 'notification',
            TopicArn: 'arn:aws:sns:us-east-1:123456789012:mail-events',
            SignatureVersion: '2',
            Signature: 'fixture',
            SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem',
            Message: '{}',
          }),
        }),
      ).rejects.toMatchObject({ code: 'invalid_signature' });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects mismatched configured authorization values', async () => {
    await expect(
      verifyWebhook({
        provider: 'postmark',
        rawBody: JSON.stringify({ RecordType: 'Delivery' }),
        headers: { authorization: 'Bearer incorrect' },
        authorization: 'Bearer configured',
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('rejects stale timestamps to reduce webhook replay risk', async () => {
    const rawBody = '{}';
    const secret = `whsec_${Buffer.from('test signing secret').toString('base64')}`;
    const timestamp = String(Math.floor((now.getTime() - 10 * 60_000) / 1000));
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`msg_123.${timestamp}.${rawBody}`)
      .digest('base64');

    await expect(
      verifyWebhook({
        provider: 'resend',
        rawBody,
        headers: {
          'svix-id': 'msg_123',
          'svix-timestamp': timestamp,
          'svix-signature': `v1,${signature}`,
        },
        webhookSecret: secret,
        now,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });
});
