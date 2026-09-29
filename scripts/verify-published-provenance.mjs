import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = process.env.PUBLISHED_VERSION?.replace(/^v/, '');
assert.ok(
  version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
  'PUBLISHED_VERSION must be a semver version or v-prefixed tag',
);

const root = mkdtempSync(join(tmpdir(), 'typedmailer-provenance-'));
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
const npmArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];

function run(args) {
  return spawnSync(npmCommand, [...npmArgs, ...args], { cwd: root, encoding: 'utf8' });
}

try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { typedmailer: version } }));
  let lastMessage = '';
  const maxAttempts = 18;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const install = run(['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (install.status === 0) {
      const audit = run(['audit', 'signatures', '--json', '--include-attestations']);
      try {
        const report = JSON.parse(audit.stdout);
        const packageResult = report.verified?.find(
          ({ name, version: foundVersion }) => name === 'typedmailer' && foundVersion === version,
        );
        if (audit.status === 0 && packageResult?.attestations?.provenance) {
          process.stdout.write(`npm provenance verified for typedmailer@${version}.\n`);
          process.exitCode = 0;
          break;
        }
        lastMessage = `npm signature audit did not include a provenance attestation for typedmailer@${version}`;
      } catch {
        lastMessage = `npm signature audit returned invalid JSON: ${audit.stderr || audit.stdout}`;
      }
    } else {
      lastMessage = `npm install failed: ${install.stderr || install.stdout}`;
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `${lastMessage}. The package may already be published; check npm registry propagation and provenance before retrying the release.`,
      );
    }
    const delayMs = Math.min(5_000 * 2 ** Math.min(attempt - 1, 3), 30_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
