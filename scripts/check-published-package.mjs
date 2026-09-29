import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['view', 'typedmailer@latest', 'version'], { encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status === 0 && result.stdout.trim()) {
  process.stdout.write(`Published typedmailer version found: ${result.stdout.trim()}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'available=true\n');
} else if (/E404|404 Not Found|is not in this registry/i.test(`${result.stdout}\n${result.stderr}`)) {
  process.stdout.write('typedmailer is not published yet; published consumer verification will be skipped.\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'available=false\n');
} else {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
