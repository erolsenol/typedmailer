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

  it('marks timeouts and rate limits as retryable', () => {
    expect(normalizeProviderError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), 'smtp')).toMatchObject({
      code: 'network',
      retryable: true,
    });
    expect(normalizeProviderError(Object.assign(new Error('limited'), { statusCode: 429 }), 'brevo')).toMatchObject({
      code: 'rate_limit',
      retryable: true,
    });
  });

  it('normalizes AWS credential errors without exposing details and retries provider 5xx responses', () => {
    const awsError = Object.assign(new Error('sensitive credential response'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: 400 },
    });
    const normalizedAwsError = normalizeProviderError(awsError, 'ses');

    expect(normalizedAwsError).toMatchObject({
      code: 'authentication',
      provider: 'ses',
      retryable: false,
      message: 'The email provider rejected the configured credentials.',
    });
    expect(normalizedAwsError.message).not.toContain('sensitive credential');

    expect(normalizeProviderError(Object.assign(new Error('unavailable'), { status: 503 }), 'resend')).toMatchObject({
      code: 'provider',
      retryable: true,
    });
    expect(normalizeProviderError(Object.assign(new Error('unavailable'), { statusCode: 503 }), 'smtp')).toMatchObject({
      code: 'provider',
      retryable: false,
    });
  });

  it('preserves an existing MailError', () => {
    const original = new MailError('Unsupported', 'unsupported', 'smtp', false);
    expect(normalizeProviderError(original, 'smtp')).toBe(original);
  });
});
