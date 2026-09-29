import { createHmac, createVerify, X509Certificate } from 'node:crypto';
import { WebhookVerificationError } from './types.js';
import type { VerifyWebhookInput } from './types.js';
import { asRecord, asString, assertRecentTimestamp, decodeBase64, decodeHex, getHeader, safeEqual } from './shared.js';

export function verifyResend(input: Extract<VerifyWebhookInput, { provider: 'resend' }>, rawBody: Uint8Array): void {
  const messageId = getHeader(input.headers, 'svix-id');
  const timestamp = getHeader(input.headers, 'svix-timestamp');
  const signatures = getHeader(input.headers, 'svix-signature');
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!messageId || !signatures || !input.webhookSecret.startsWith('whsec_')) {
    throw new WebhookVerificationError('invalid_signature');
  }
  let key: Buffer;
  try {
    key = Buffer.from(input.webhookSecret.slice('whsec_'.length), 'base64');
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (key.length === 0) throw new WebhookVerificationError('invalid_signature');
  const expected = createHmac('sha256', key).update(`${messageId}.${timestamp}.`).update(rawBody).digest();
  const matches = signatures
    .split(' ')
    .some((item) => item.startsWith('v1,') && safeEqual(expected, decodeBase64(item.slice(3))));
  if (!matches) throw new WebhookVerificationError('invalid_signature');
}

export function verifyMailgun(input: Extract<VerifyWebhookInput, { provider: 'mailgun' }>, payload: unknown): void {
  const root = asRecord(payload);
  const signature = asRecord(root.signature);
  const timestamp = asString(signature.timestamp);
  const token = asString(signature.token);
  const received = asString(signature.signature);
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!timestamp || !token || !received || !input.signingKey) {
    throw new WebhookVerificationError('invalid_signature');
  }
  const expected = createHmac('sha256', input.signingKey).update(`${timestamp}${token}`).digest('hex');
  if (!safeEqual(Buffer.from(expected, 'hex'), decodeHex(received))) {
    throw new WebhookVerificationError('invalid_signature');
  }
}

export function verifySendGrid(
  input: Extract<VerifyWebhookInput, { provider: 'sendgrid' }>,
  rawBody: Uint8Array,
): void {
  const timestamp = getHeader(input.headers, 'x-twilio-email-event-webhook-timestamp');
  const signature = getHeader(input.headers, 'x-twilio-email-event-webhook-signature');
  assertRecentTimestamp(timestamp, input.now, input.toleranceSeconds);
  if (!timestamp || !signature || !input.publicKey) throw new WebhookVerificationError('invalid_signature');
  try {
    const verifier = createVerify('sha256');
    verifier.update(timestamp);
    verifier.update(rawBody);
    verifier.end();
    if (!verifier.verify(input.publicKey, signature, 'base64')) {
      throw new WebhookVerificationError('invalid_signature');
    }
  } catch (error) {
    if (error instanceof WebhookVerificationError) throw error;
    throw new WebhookVerificationError('invalid_signature');
  }
}

export function verifyAuthorization(
  input: Extract<VerifyWebhookInput, { provider: 'brevo' | 'postmark' }>,
  headerName: string,
): void {
  const received = getHeader(input.headers, headerName);
  if (!received || !input.authorization || !safeEqual(Buffer.from(received), Buffer.from(input.authorization))) {
    throw new WebhookVerificationError('invalid_signature');
  }
}

export async function verifySnsNotification(
  input: Extract<VerifyWebhookInput, { provider: 'ses' }>,
  payload: unknown,
): Promise<unknown> {
  const envelope = asRecord(payload);
  const topicArn = asString(envelope.TopicArn);
  const signingCertUrl = asString(envelope.SigningCertURL);
  const signature = asString(envelope.Signature);
  const signatureVersion = asString(envelope.SignatureVersion);
  if (
    envelope.Type !== 'Notification' ||
    topicArn !== input.topicArn ||
    !signingCertUrl ||
    !signature ||
    (signatureVersion !== '1' && signatureVersion !== '2')
  ) {
    throw new WebhookVerificationError('invalid_signature');
  }

  let certificateUrl: URL;
  try {
    certificateUrl = new URL(signingCertUrl);
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  const topicMatch = /^arn:(aws|aws-us-gov|aws-cn):sns:([a-z0-9-]+):\d{12}:[^:]+$/.exec(input.topicArn);
  const expectedHost = topicMatch
    ? topicMatch[1] === 'aws-cn'
      ? `sns.${topicMatch[2]}.amazonaws.com.cn`
      : `sns.${topicMatch[2]}.amazonaws.com`
    : undefined;
  if (
    certificateUrl.protocol !== 'https:' ||
    certificateUrl.username ||
    certificateUrl.password ||
    certificateUrl.port ||
    certificateUrl.search ||
    certificateUrl.hash ||
    certificateUrl.hostname !== expectedHost ||
    !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(certificateUrl.pathname)
  ) {
    throw new WebhookVerificationError('invalid_signature');
  }

  let response: Response;
  try {
    response = await fetch(certificateUrl, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (!response.ok) throw new WebhookVerificationError('invalid_signature');
  let certificateBody: string;
  try {
    certificateBody = await response.text();
  } catch {
    throw new WebhookVerificationError('invalid_signature');
  }
  if (certificateBody.length > 32_768) throw new WebhookVerificationError('invalid_signature');

  try {
    const certificate = new X509Certificate(certificateBody);
    const now = input.now ?? new Date();
    if (
      !certificate.subject.split('\n').some((line) => line === 'CN=Amazon SNS') ||
      now < new Date(certificate.validFrom) ||
      now > new Date(certificate.validTo)
    ) {
      throw new WebhookVerificationError('invalid_signature');
    }
    const fields = snsFields(envelope);
    const verifier = createVerify(signatureVersion === '2' ? 'sha256' : 'sha1');
    verifier.update(fields);
    verifier.end();
    if (!verifier.verify(certificate.publicKey, signature, 'base64')) {
      throw new WebhookVerificationError('invalid_signature');
    }
  } catch (error) {
    if (error instanceof WebhookVerificationError) throw error;
    throw new WebhookVerificationError('invalid_signature');
  }

  try {
    const message = JSON.parse(asString(envelope.Message) ?? '');
    return message;
  } catch {
    throw new WebhookVerificationError('invalid_payload');
  }
}

function snsFields(envelope: Record<string, unknown>): string {
  const fields = ['Message', 'MessageId'];
  if (envelope.Subject !== undefined) fields.push('Subject');
  fields.push('Timestamp', 'TopicArn', 'Type');
  return fields.map((field) => `${field}\n${asString(envelope[field]) ?? ''}\n`).join('');
}
