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

    const mailer = api.createMailer({ provider: 'resend', apiKey: 'placeholder', from: 'sender@example.test' });
    await assert.rejects(
      mailer.send({ to: 'reader@example.test', subject: 'Hello', text: 'Hi' }),
      (error) => error instanceof api.MailError && error.code === 'configuration' && error.message.includes('resend'),
    );
  `;
  run(process.execPath, ['--input-type=module', '-e', consumerSmoke], { cwd: consumerRoot });

  const typeConsumer = join(consumerRoot, 'consumer.ts');
  writeFileSync(
    typeConsumer,
    `import { createMailer, type MailerOptions, type SendMailInput } from 'typedmailer';
     import { createTestMailer } from 'typedmailer/testing';
     const options: MailerOptions = { provider: 'ses', region: 'us-east-1', from: 'sender@example.test' };
     const message: SendMailInput = { to: 'reader@example.test', subject: 'Hello', text: 'Hi' };
     createMailer(options).send(message);
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
