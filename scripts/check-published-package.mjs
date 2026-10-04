import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const requestedVersion = process.env.PUBLISHED_VERSION?.replace(/^v/, '') || 'latest';
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
assert.ok(requestedVersion === 'latest' || versionPattern.test(requestedVersion), 'Invalid published version');
const expectedCommit = process.env.PUBLISHED_COMMIT;
assert.ok(!expectedCommit || /^[a-f0-9]{40}$/.test(expectedCommit), 'Invalid published commit');
const attempts = Number(process.env.REGISTRY_MAX_ATTEMPTS ?? 18);
const intervalMs = Number(process.env.REGISTRY_INTERVAL_MS ?? 30_000);
assert.ok(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 100, 'Invalid registry attempt limit');
assert.ok(Number.isSafeInteger(intervalMs) && intervalMs >= 0 && intervalMs <= 30_000, 'Invalid registry interval');

let version;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync('npm', ['view', `typedmailer@${requestedVersion}`, '--json'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status === 0) {
    const manifest = JSON.parse(result.stdout);
    assert.ok(versionPattern.test(manifest.version), 'Registry returned an invalid version');
    assert.ok(requestedVersion === 'latest' || manifest.version === requestedVersion, 'Registry version mismatch');
    assert.ok(
      !expectedCommit || manifest.gitHead === expectedCommit,
      'Published gitHead does not match release commit',
    );
    version = manifest.version;
    break;
  }
  process.stdout.write(`Waiting for typedmailer@${requestedVersion} (${attempt}/${attempts}).\n`);
  if (attempt === attempts) throw new Error('Published package is unavailable after bounded registry polling.');
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
assert.ok(version, 'No published version found');
process.stdout.write(`Published consumer will verify typedmailer@${version}.\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `available=true\nversion=${version}\n`);
