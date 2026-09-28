import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'typedmailer-package-smoke-'));
const consumerRoot = join(tempRoot, 'consumer');
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
const npmPrefixArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const packOutput = run(
    npmCommand,
    [...npmPrefixArgs, 'pack', '--json', '--ignore-scripts', '--pack-destination', tempRoot],
    { cwd: projectRoot },
  );
  const packMetadata = JSON.parse(packOutput);
  const pack = Array.isArray(packMetadata)
    ? packMetadata[0]
    : typeof packMetadata.filename === 'string'
      ? packMetadata
      : Object.values(packMetadata)[0];
  assert.ok(pack?.filename, 'npm pack did not report a tarball');

  const packedFiles = new Set(pack.files.map((file) => file.path));
  assert.ok(packedFiles.has('dist/index.js'), 'root ESM entry is missing from the package');
  assert.ok(packedFiles.has('dist/testing.js'), 'testing ESM entry is missing from the package');
  assert.ok(packedFiles.has('README.md'), 'README is missing from the package');
  assert.ok(![...packedFiles].some((file) => file.startsWith('tests/') || file.startsWith('src/')));

  const tarballPath = resolve(tempRoot, pack.filename);
  run(
    npmCommand,
    [
      ...npmPrefixArgs,
      'install',
      '--prefix',
      consumerRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--omit=peer',
      tarballPath,
    ],
    { cwd: projectRoot },
  );

  const consumerSmoke = `
    import assert from 'node:assert/strict';
    const api = await import('typedmailer');
    const testing = await import('typedmailer/testing');
    assert.equal(typeof api.createMailer, 'function');
    assert.equal(typeof api.MailError, 'function');
    assert.equal(typeof testing.createTestMailer, 'function');

    const testMailer = testing.createTestMailer({ from: 'sender@example.test' });
    const result = await testMailer.send({ to: 'reader@example.test', subject: 'Hello', text: 'Hi' });
    assert.equal(result.messageId, 'test-1');

    const missingPeers = [
      [{ provider: 'resend', apiKey: 'placeholder', from: 'sender@example.test' }, 'resend'],
      [{ provider: 'brevo', apiKey: 'placeholder', from: 'sender@example.test' }, '@getbrevo/brevo'],
      [{ provider: 'postmark', apiKey: 'placeholder', from: 'sender@example.test' }, 'postmark'],
      [{ provider: 'sendgrid', apiKey: 'placeholder', from: 'sender@example.test' }, '@sendgrid/mail'],
      [{ provider: 'mailgun', apiKey: 'placeholder', domain: 'mg.example.test', from: 'sender@example.test' }, 'mailgun.js'],
      [{ provider: 'ses', region: 'us-east-1', from: 'sender@example.test' }, '@aws-sdk/client-sesv2'],
      [{ provider: 'smtp', host: '127.0.0.1', port: 1025, secure: false, from: 'sender@example.test' }, 'nodemailer'],
    ];
    for (const [options, dependency] of missingPeers) {
      const mailer = api.createMailer(options);
      await assert.rejects(
        mailer.send({ to: 'reader@example.test', subject: 'Hello', text: 'Hi' }),
        (error) => error instanceof api.MailError && error.code === 'configuration' && error.message.includes(dependency),
      );
    }
  `;
  run(process.execPath, ['--input-type=module', '-e', consumerSmoke], { cwd: consumerRoot });

  const typeConsumer = join(consumerRoot, 'consumer.ts');
  writeFileSync(
    typeConsumer,
    `import { createMailer, MailError, type MailErrorCode, type MailErrorOptions, type MailerOptions, type ProviderName, type SendMailInput, type SendMailResult } from 'typedmailer';
     import { createTestMailer } from 'typedmailer/testing';
     const from = 'sender@example.test';
     const options: MailerOptions[] = [
       { provider: 'resend', apiKey: 'placeholder', from },
       { provider: 'brevo', apiKey: 'placeholder', from },
       { provider: 'postmark', apiKey: 'placeholder', from },
       { provider: 'sendgrid', apiKey: 'placeholder', from },
       { provider: 'mailgun', apiKey: 'placeholder', domain: 'mg.example.test', from },
       { provider: 'ses', region: 'us-east-1', from },
       { provider: 'smtp', host: '127.0.0.1', port: 1025, secure: false, from },
     ];
     const message: SendMailInput = { to: 'reader@example.test', subject: 'Hello', text: 'Hi' };
     const provider: ProviderName = 'ses';
     const testResult: SendMailResult = { provider: 'test', messageId: 'test-1', acceptedAt: new Date() };
     const errorCode: MailErrorCode = 'unsupported';
     const errorOptions: MailErrorOptions = { cause: new Error('original'), deliveryUnknown: true };
     new MailError('uncertain send', errorCode, provider, true, errorOptions);
     void [provider, testResult];
     for (const option of options) createMailer(option).send(message);
     createTestMailer({ from: 'sender@example.test' }).send(message);`,
  );
  run(
    process.execPath,
    [
      resolve(projectRoot, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--skipLibCheck',
      typeConsumer,
    ],
    { cwd: consumerRoot },
  );
  process.stdout.write('Packed ESM and TypeScript consumer checks passed without optional provider peers.\n');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
