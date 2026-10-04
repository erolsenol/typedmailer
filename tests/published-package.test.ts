import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function run(options: { version?: string; failures?: number; commit?: string; expectedCommit?: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'typedmailer-registry-test-'));
  try {
    const npm = join(directory, 'npm');
    const count = join(directory, 'count');
    const output = join(directory, 'output');
    writeFileSync(
      npm,
      `#!${process.execPath}\nconst fs = require('node:fs');
      const path = ${JSON.stringify(count)};
      const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
      fs.writeFileSync(path, String(count + 1));
      if (count < ${options.failures ?? 0}) { process.stderr.write('E404'); process.exit(1); }
      const requested = process.argv[3].split('@')[1];
      process.stdout.write(JSON.stringify({ version: requested === 'latest' ? '2.1.0' : requested, gitHead: ${JSON.stringify(options.commit ?? 'a'.repeat(40))} }));
    `,
    );
    chmodSync(npm, 0o755);
    const result = spawnSync(process.execPath, [resolve('scripts/check-published-package.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        PUBLISHED_VERSION: options.version ?? '',
        PUBLISHED_COMMIT: options.expectedCommit ?? '',
        REGISTRY_MAX_ATTEMPTS: '3',
        REGISTRY_INTERVAL_MS: '1',
      },
    });
    return { ...result, output: result.status === 0 ? readFileSync(output, 'utf8') : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('exact published package polling', () => {
  it('waits for propagation and resolves the requested tag to an exact consumer version', () => {
    const result = run({ version: 'v2.1.0', failures: 2, expectedCommit: 'a'.repeat(40) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain('version=2.1.0');
    expect(result.stdout).toContain('(2/3)');
  });
  it('pins a scheduled latest check to the discovered exact version', () => {
    expect(run({}).output).toContain('version=2.1.0');
  });
  it('fails after bounded polling rather than skipping consumer checks', () => {
    const result = run({ failures: 10 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bounded registry polling');
  });
  it('rejects a package from the wrong source commit', () => {
    const result = run({ expectedCommit: 'b'.repeat(40) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gitHead');
  });
  it('rejects invalid version input before invoking npm', () => {
    const result = run({ version: 'bad;input' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid published version');
  });
});
