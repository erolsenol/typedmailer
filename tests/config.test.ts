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

  it('rejects blank fields, empty recipient lists, malformed reply-to addresses, and empty attachment metadata', () => {
    expect(mailInputSchema.safeParse({ to: [], subject: 'Welcome', text: 'Hello' }).success).toBe(false);
    expect(mailInputSchema.safeParse({ to: 'reader@example.com', subject: '  ', text: 'Hello' }).success).toBe(false);
    expect(
      mailInputSchema.safeParse({
        to: 'reader@example.com',
        replyTo: 'not-an-email',
        subject: 'Welcome',
        text: 'Hello',
      }).success,
    ).toBe(false);
    expect(
      mailInputSchema.safeParse({
        to: 'reader@example.com',
        subject: 'Welcome',
        text: 'Hello',
        attachments: [{ filename: '  ', content: new Uint8Array(), contentType: '' }],
      }).success,
    ).toBe(false);
    expect(
      mailInputSchema.safeParse({
        to: 'reader@example.com',
        subject: 'Welcome',
        text: 'Hello',
        attachments: [{ filename: 'logo.png', content: new Uint8Array(), contentId: '' }],
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

  it('accepts an explicit undefined display name consistently with optional address names', () => {
    expect(
      mailInputSchema.safeParse({
        from: { email: 'sender@example.com', name: undefined },
        to: { email: 'reader@example.com', name: undefined },
        subject: 'Welcome',
        text: 'Hello',
      }).success,
    ).toBe(true);
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

describe('header boundary validation', () => {
  const message = { to: 'reader@example.com', subject: 'Welcome', text: 'Hello' };
  it.each(['\r', '\n', '\0'])('rejects control character %j in header fields', (control) => {
    for (const field of ['subject', 'messageId'])
      expect(mailInputSchema.safeParse({ ...message, [field]: `value${control}injected` }).success).toBe(false);
    expect(mailInputSchema.safeParse({ ...message, headers: { 'X-Custom': `value${control}injected` } }).success).toBe(
      false,
    );
    for (const field of ['filename', 'contentType', 'contentId'])
      expect(
        mailInputSchema.safeParse({
          ...message,
          attachments: [{ filename: 'file.txt', content: 'body', [field]: `value${control}injected` }],
        }).success,
      ).toBe(false);
  });
  it.each(['', 'X Bad', 'X:Bad', 'X\rInjected'])('rejects malformed header name %j', (name) => {
    expect(mailInputSchema.safeParse({ ...message, headers: { [name]: 'value' } }).success).toBe(false);
  });
  it('accepts Unicode subjects, ordinary custom headers and multiline message bodies', () => {
    expect(
      mailInputSchema.safeParse({
        ...message,
        subject: 'Hoş geldiniz — 你好',
        text: 'Line 1\nLine 2',
        headers: { 'X-Correlation-ID': 'request-1' },
      }).success,
    ).toBe(true);
  });
});
