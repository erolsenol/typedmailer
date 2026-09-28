import { describe, expect, it } from 'vitest';
import { addressWithName, emailOf, mailInputSchema, normalizeAddresses } from '../src/config.js';

describe('mail input configuration', () => {
  it('accepts a valid message with either text or HTML content', () => {
    const result = mailInputSchema.safeParse({
      to: 'reader@example.com',
      subject: 'Welcome',
      text: 'Hello',
    });

    expect(result.success).toBe(true);
  });

  it('requires message content and rejects unknown fields', () => {
    expect(mailInputSchema.safeParse({ to: 'reader@example.com', subject: 'Welcome' }).success).toBe(false);
    expect(
      mailInputSchema.safeParse({
        to: 'reader@example.com',
        subject: 'Welcome',
        text: 'Hello',
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('normalizes single and multiple addresses', () => {
    expect(normalizeAddresses('reader@example.com')).toEqual(['reader@example.com']);
    expect(normalizeAddresses(['reader@example.com', 'team@example.com'])).toEqual([
      'reader@example.com',
      'team@example.com',
    ]);
    expect(normalizeAddresses(undefined)).toBeUndefined();
  });

  it('extracts and formats named email addresses', () => {
    expect(emailOf('Reader Name <reader@example.com>')).toBe('reader@example.com');
    expect(addressWithName('Reader Name <reader@example.com>')).toEqual({
      email: 'reader@example.com',
      name: 'Reader Name',
    });
    expect(addressWithName({ email: 'reader@example.com', name: 'Reader Name' })).toEqual({
      email: 'reader@example.com',
      name: 'Reader Name',
    });
  });
});
