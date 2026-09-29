import { describe, expect, it } from 'vitest';
import { MailError, normalizeProviderError } from '../src/errors.js';

describe('provider error normalization', () => {
  it('maps authentication failures without exposing provider messages', () => {
    const original = Object.assign(new Error('secret token rejected'), { statusCode: 401 });
    const normalized = normalizeProviderError(original, 'resend');

    expect(normalized).toMatchObject({
      name: 'MailError',
      code: 'authentication',
      provider: 'resend',
      retryable: false,
      message: 'The email provider rejected the configured credentials.',
    });
    expect(normalized.cause).toBe(original);
    expect(normalized.message).not.toContain('secret token');
  });

  it('separates retry guidance from whether a send may already have been accepted', () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(normalizeProviderError(timeout, 'smtp', 'send')).toMatchObject({
      code: 'network',
      retryable: true,
      deliveryUnknown: true,
    });
    expect(normalizeProviderError(timeout, 'smtp', 'verify')).toMatchObject({ deliveryUnknown: false });
    expect(
      normalizeProviderError(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }), 'resend', 'send'),
    ).toMatchObject({ code: 'network', retryable: true, deliveryUnknown: true });

    expect(
      normalizeProviderError(Object.assign(new Error('limited'), { statusCode: 429 }), 'brevo', 'send'),
    ).toMatchObject({
      code: 'rate_limit',
      retryable: true,
      deliveryUnknown: false,
    });
    expect(
      normalizeProviderError(Object.assign(new Error('dns failure'), { code: 'ENOTFOUND' }), 'resend', 'send'),
    ).toMatchObject({ code: 'network', deliveryUnknown: false });
    expect(
      normalizeProviderError(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }), 'smtp', 'send'),
    ).toMatchObject({ code: 'network', retryable: true, deliveryUnknown: false });
  });

  it('normalizes AWS credential errors without exposing details and retries provider 5xx responses', () => {
    const awsError = Object.assign(new Error('sensitive credential response'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: 400 },
    });
    const normalizedAwsError = normalizeProviderError(awsError, 'ses', 'send');

    expect(normalizedAwsError).toMatchObject({
      code: 'authentication',
      provider: 'ses',
      retryable: false,
      deliveryUnknown: false,
      message: 'The email provider rejected the configured credentials.',
    });
    expect(normalizedAwsError.message).not.toContain('sensitive credential');

    expect(
      normalizeProviderError(Object.assign(new Error('unavailable'), { status: 503 }), 'resend', 'send'),
    ).toMatchObject({ code: 'provider', retryable: true, deliveryUnknown: true });
    expect(
      normalizeProviderError(Object.assign(new Error('unavailable'), { code: 503 }), 'resend', 'send'),
    ).toMatchObject({ code: 'provider', retryable: true, deliveryUnknown: true });
    expect(
      normalizeProviderError(Object.assign(new Error('unavailable'), { statusCode: 503 }), 'smtp', 'send'),
    ).toMatchObject({ code: 'provider', retryable: false, deliveryUnknown: false });
  });

  it('preserves an existing MailError', () => {
    const original = new MailError('Unsupported', 'unsupported', 'smtp', false);
    expect(normalizeProviderError(original, 'smtp')).toBe(original);

    const uncertain = new MailError('No message ID', 'provider', 'resend', false, { deliveryUnknown: true });
    expect(normalizeProviderError(uncertain, 'resend', 'send').deliveryUnknown).toBe(true);
    expect(normalizeProviderError(uncertain, 'resend', 'verify').deliveryUnknown).toBe(false);
  });
});
