import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../src/index.js';

async function startRelay(rejectAll = false) {
  const messages: string[] = [];
  const recipients: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 local SMTP fixture\r\n');
    let buffer = '';
    let data = false;
    let message = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(message);
            message = '';
            data = false;
            socket.write('250 queued\r\n');
          } else message += `${line.replace(/^\.\./, '.')}\r\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-local fixture\r\n250 8BITMIME\r\n');
        else if (/^RCPT TO:/i.test(line)) {
          const address = /<([^>]+)>/.exec(line)?.[1] ?? '';
          recipients.push(address);
          socket.write(
            rejectAll || address.startsWith('reject') ? '550 recipient rejected\r\n' : '250 recipient accepted\r\n',
          );
        } else if (line === 'DATA') {
          data = true;
          socket.write('354 send data\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected relay port');
  return {
    port: address.port,
    messages,
    recipients,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe('real SMTP wire contract', () => {
  it('reports partial RCPT acceptance while transmitting UTF-8, binary and inline MIME content', async () => {
    const relay = await startRelay();
    const mailer = createMailer({
      provider: 'smtp',
      host: '127.0.0.1',
      port: relay.port,
      secure: false,
      from: { email: 'sender@example.test', name: 'Sender' },
    });
    try {
      const result = await mailer.send({
        to: ['accept@example.test', 'reject@example.test'],
        cc: 'cc@example.test',
        bcc: 'bcc@example.test',
        subject: 'İstanbul 🌍',
        text: 'İstanbul 🌍',
        attachments: [{ filename: 'binary.bin', content: new Uint8Array([0, 127, 128, 255]), contentId: 'inline' }],
      });
      expect(result.accepted).toEqual(['accept@example.test', 'cc@example.test', 'bcc@example.test']);
      expect(result.rejected).toEqual(['reject@example.test']);
      expect(relay.messages).toHaveLength(1);
      expect(relay.recipients).toEqual([
        'accept@example.test',
        'reject@example.test',
        'cc@example.test',
        'bcc@example.test',
      ]);
      expect(relay.messages[0]).toContain('From: Sender <sender@example.test>');
      expect(relay.messages[0]).toContain('Content-ID: <inline>');
      expect(relay.messages[0]).toContain('AH+A/w==');
      expect(relay.messages[0]).toContain('=C4=B0stanbul');
      expect(relay.messages[0]).not.toMatch(/^Bcc:/m);
    } finally {
      await mailer.close();
      await relay.close();
    }
  });

  it('rejects an envelope with no accepted recipients without uncertain delivery or automatic retry', async () => {
    const relay = await startRelay(true);
    const mailer = createMailer({
      provider: 'smtp',
      host: '127.0.0.1',
      port: relay.port,
      secure: false,
      from: 'sender@example.test',
    });
    try {
      await expect(
        mailer.send({ to: ['one@example.test', 'two@example.test'], subject: 'Hello', text: 'Body' }),
      ).rejects.toMatchObject({ status: 550, provider: 'smtp', retryable: false, deliveryUnknown: false });
      expect(relay.messages).toEqual([]);
      expect(relay.recipients).toHaveLength(2);
    } finally {
      await mailer.close();
      await relay.close();
    }
  });
});
