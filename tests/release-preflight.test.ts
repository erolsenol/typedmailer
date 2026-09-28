import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly version: string;
}

const packageManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageManifest;
const preflightScript = resolve(process.cwd(), 'scripts/release-preflight.mjs');

describe('release preflight', () => {
  it('accepts a tag that matches the package and changelog versions', () => {
    const result = spawnSync(process.execPath, [preflightScript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { RELEASE_TAG: `v${packageManifest.version}` },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`v${packageManifest.version}`);
  });

  it('rejects a tag that does not match the package version', () => {
    const result = spawnSync(process.execPath, [preflightScript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { RELEASE_TAG: 'v0.0.0' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release tag must match package.json version');
  });
});
