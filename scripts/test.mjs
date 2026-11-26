import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = join(rootDir, 'dist-test');
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(rootDir, 'tests', 'skill-docs.test.ts')],
  outfile: join(outDir, 'skill-docs.test.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'info',
});

execFileSync(process.execPath, ['--test', join(outDir, 'skill-docs.test.mjs')], {
  stdio: 'inherit',
  cwd: rootDir,
});
