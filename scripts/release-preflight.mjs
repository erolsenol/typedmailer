import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
const releaseTag = process.env.RELEASE_TAG;

assert.ok(releaseTag, 'Set RELEASE_TAG to the GitHub release tag (for example, v1.0.0).');
assert.equal(
  releaseTag,
  `v${packageJson.version}`,
  `Release tag must match package.json version ${packageJson.version}.`,
);
assert.match(
  changelog,
  new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}\\s+-`, 'm'),
  `CHANGELOG.md must contain a section for ${packageJson.version}.`,
);

process.stdout.write(`Release tag ${releaseTag} matches package.json and CHANGELOG.md.\n`);
