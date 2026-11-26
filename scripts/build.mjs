import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = join(rootDir, 'dist');

mkdirSync(distDir, { recursive: true });

const NODE_BANNER = `import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);`;

// 1. Build MCP Server
await esbuild.build({
  entryPoints: [join(rootDir, 'src', 'server', 'server.ts')],
  outfile: join(distDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: NODE_BANNER },
  logLevel: 'info',
});

// 2. Build CLI Entrypoint (dist/cli.mjs)
const cliOut = join(distDir, 'cli.mjs');
await esbuild.build({
  entryPoints: [join(rootDir, 'src', 'cli.ts')],
  outfile: cliOut,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: `#!/usr/bin/env node\n${NODE_BANNER}` },
  logLevel: 'info',
});
chmodSync(cliOut, 0o755);

// 3. Build Single-File UI HTML
const uiRes = await esbuild.build({
  entryPoints: [join(rootDir, 'src', 'ui', 'main.tsx')],
  bundle: true,
  write: false,
  outdir: distDir,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

let jsCode = '';
let cssCode = '';
for (const out of uiRes.outputFiles) {
  if (out.path.endsWith('.js')) jsCode = out.text;
  else if (out.path.endsWith('.css')) cssCode = out.text;
}

const safeJs = jsCode.replace(/<\/script/gi, '<\\/script');
const safeCss = cssCode.replace(/<\/style/gi, '<\\/style');

const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Skill 文件庫</title>
<style>/*__CSS__*/</style>
</head>
<body>
<div id="root"></div>
<script>/*__JS__*/</script>
</body>
</html>
`;

const finalHtml = htmlTemplate
  .replace('/*__CSS__*/', () => safeCss)
  .replace('/*__JS__*/', () => safeJs);

const appHtmlPath = join(distDir, 'app.html');
writeFileSync(appHtmlPath, finalHtml, 'utf-8');

const sizeBytes = statSync(appHtmlPath).size;
console.log(`[build] app.html written (${(sizeBytes / 1024).toFixed(1)} KiB)`);
if (sizeBytes >= 10 * 1024 * 1024) {
  throw new Error(`app.html exceeds 10 MiB limit (${sizeBytes} bytes)`);
}
