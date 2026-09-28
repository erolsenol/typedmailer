import { z } from 'zod';

const addressSchema = z.union([
  z.string().email(),
  z.object({ email: z.string().email(), name: z.string().optional() }).strict(),
]);
const senderSchema = z.union([
  z.string().email(),
  z.string().regex(/^.+ <[^<>\s]+@[^<>\s]+>$/, 'Use a valid email address or "Name <email@example.com>".'),
  z.object({ email: z.string().email(), name: z.string().optional() }).strict(),
]);

export const mailInputSchema = z
  .object({
    from: senderSchema.optional(),
    to: z.union([addressSchema, z.array(addressSchema).min(1)]),
    subject: z.string().min(1),
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
          filename: z.string().min(1),
          content: z.union([z.string(), z.instanceof(Uint8Array)]),
          contentType: z.string().optional(),
          contentId: z.string().optional(),
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

export function emailOf(address: string | { email: string; name?: string }): string {
  if (typeof address !== 'string') return address.email;
  const namedAddress = address.match(/^(.+) <([^<>\s]+@[^<>\s]+)>$/);
  return namedAddress?.[2] ?? address;
}

export function addressWithName(address: string | { email: string; name?: string }): { email: string; name?: string } {
  if (typeof address !== 'string') return address;
  const namedAddress = address.match(/^(.+) <([^<>\s]+@[^<>\s]+)>$/);
  return namedAddress ? { email: namedAddress[2]!, name: namedAddress[1]! } : { email: address };
}
