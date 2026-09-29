import { timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError, defaultTimestampToleranceSeconds } from './types.js';
import type { WebhookHeaders } from './types.js';

export function assertRecentTimestamp(
  value: string | undefined,
  now: Date | undefined,
  toleranceSeconds: number | undefined,
): void {
  if (!value || !/^\d+$/.test(value)) throw new WebhookVerificationError('invalid_signature');
  const timestamp = Number(value);
  const tolerance = toleranceSeconds ?? defaultTimestampToleranceSeconds;
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(tolerance) || tolerance < 1) {
    throw new WebhookVerificationError('invalid_signature');
  }
  const seconds = Math.floor((now ?? new Date()).getTime() / 1000);
  if (Math.abs(seconds - timestamp) > tolerance) throw new WebhookVerificationError('invalid_signature');
}

export function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return typeof entry === 'string' ? entry : Array.isArray(entry) ? entry.join(' ') : undefined;
}

export function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, 'base64');
}

export function decodeHex(value: string): Buffer {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, 'hex');
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const result = new Date(milliseconds);
    return Number.isNaN(result.getTime()) ? undefined : result;
  }
  if (typeof value === 'string' && value.length > 0) {
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? undefined : result;
  }
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebhookVerificationError('invalid_payload');
  }
  return value as Record<string, unknown>;
}

export function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asId(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

export function firstString(value: unknown): string | undefined {
  return asString(value) ?? asStringArray(value)[0];
}
