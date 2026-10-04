import { z } from 'zod';
import type { MailAddress } from './types.js';

const emailSchema = z.string().email();
const addressObjectSchema = z
  .object({
    email: emailSchema,
    name: z
      .string()
      .refine((value) => !/[\r\n]/.test(value), 'Display names cannot contain line breaks.')
      .optional(),
  })
  .strict();
const addressSchema = z.union([emailSchema, addressObjectSchema]);

export const senderSchema = z.union([
  emailSchema,
  z.string().refine((value) => {
    const match = /^([^<>\r\n]+) <([^<>\s]+)>$/.exec(value);
    return match !== null && match[1]!.trim().length > 0 && emailSchema.safeParse(match[2]).success;
  }, 'Use a valid email address or "Name <email@example.com>".'),
  addressObjectSchema,
]);

export const mailInputSchema = z
  .object({
    from: senderSchema.optional(),
    to: z.union([addressSchema, z.array(addressSchema).min(1)]),
    subject: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'Subject cannot be blank.'),
    messageId: z.string().min(1).optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    replyTo: addressSchema.optional(),
    cc: z.union([addressSchema, z.array(addressSchema)]).optional(),
    bcc: z.union([addressSchema, z.array(addressSchema)]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    attachments: z
      .array(
        z.object({
          filename: z
            .string()
            .min(1)
            .refine((value) => value.trim().length > 0, 'Attachment filename cannot be blank.'),
          content: z.union([z.string(), z.instanceof(Uint8Array)]),
          contentType: z.string().min(1).optional(),
          contentId: z.string().min(1).optional(),
        }),
      )
      .optional(),
    idempotencyKey: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((input) => input.text !== undefined || input.html !== undefined, {
    message: 'Provide at least one of text or html.',
  });

export function normalizeAddresses<T>(value: T | readonly T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value as T];
}

export function emailOf(address: MailAddress): string {
  if (typeof address !== 'string') return address.email;
  const namedAddress = address.match(/^(.+) <([^<>\s]+@[^<>\s]+)>$/);
  return namedAddress?.[2] ?? address;
}

export function addressWithName(address: MailAddress): { email: string; name?: string } {
  if (typeof address !== 'string') {
    return { email: address.email, ...(address.name !== undefined ? { name: address.name } : {}) };
  }
  const namedAddress = address.match(/^(.+) <([^<>\s]+@[^<>\s]+)>$/);
  return namedAddress ? { email: namedAddress[2]!, name: namedAddress[1]! } : { email: address };
}
