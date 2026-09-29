import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const peerDependencies = packageJson.peerDependencies ?? {};
const developmentDependencies = packageJson.devDependencies ?? {};
const installArgs = [];

for (const [name, range] of Object.entries(peerDependencies)) {
  if (developmentDependencies[name] !== range) {
    throw new Error(`${name}: devDependency range must match its peerDependency range (${range}).`);
  }

  const minimum = /^>=(\d+\.\d+\.\d+)\s+<\d+/.exec(range)?.[1];
  if (!minimum) {
    throw new Error(`${name}: expected a peer range with an explicit >=x.y.z minimum, received ${range}.`);
  }

  installArgs.push(`${name}@${minimum}`);
}

if (installArgs.length === 0) throw new Error('No optional provider peer dependencies were found.');

console.log(`Installing provider peer minimums: ${installArgs.join(', ')}`);
execFileSync('npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', ...installArgs], {
  stdio: 'inherit',
});
