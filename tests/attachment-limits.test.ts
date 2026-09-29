import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderMocks } from './provider-adapter-mocks.js';

import { createMailer } from '../src/index.js';

const mocks = getProviderMocks();

describe('attachment size limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects aggregate UTF-8 and binary attachment content over the configured cap before loading a provider', async () => {
    const mailer = createMailer({
      provider: 'resend',
      apiKey: 'resend-token',
      from: 'sender@example.com',
      maxAttachmentBytes: 5,
    });

    await expect(
      mailer.send({
        to: 'reader@example.com',
        subject: 'Attachment limit',
        text: 'Hello',
        attachments: [
          { filename: 'text.txt', content: 'éé' },
          { filename: 'binary.bin', content: new Uint8Array([1, 2]) },
        ],
      }),
    ).rejects.toMatchObject({ name: 'MailError', code: 'configuration' });
    expect(mocks.resendApiKey).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('accepts content exactly at the configured cap', async () => {
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-message-limit' }, error: null });
    const mailer = createMailer({
      provider: 'resend',
      apiKey: 'resend-token',
      from: 'sender@example.com',
      maxAttachmentBytes: 4,
    });

    await expect(
      mailer.send({
        to: 'reader@example.com',
        subject: 'Attachment limit',
        text: 'Hello',
        attachments: [{ filename: 'text.txt', content: 'éé' }],
      }),
    ).resolves.toMatchObject({ messageId: 'resend-message-limit' });
    await mailer.close();
  });
});
