import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const appHtml = join(rootDir, 'dist', 'app.html');
const assetsDir = join(rootDir, 'docs', 'assets');

if (!existsSync(appHtml)) {
  throw new Error('dist/app.html not found. Run `npm run build` first.');
}

const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromeBin)) {
  throw new Error(`Google Chrome not found at ${chromeBin}`);
}

mkdirSync(assetsDir, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), 'bsm-chrome-'));

const jobs = [
  { file: 'preview-finder-en.png', query: '?preview=1&lang=en&tab=finder', w: 1240, h: 780, cropH: 1460, cropW: 2480 },
  { file: 'preview-analytics-en.png', query: '?preview=1&lang=en&tab=analytics', w: 1160, h: 780, cropH: 1460, cropW: 2320 },
  { file: 'preview-graph-en.png', query: '?preview=1&lang=en&tab=graph', w: 1160, h: 780, cropH: 1460, cropW: 2320 },
  { file: 'preview-finder-zh.png', query: '?preview=1&lang=zh-TW&tab=finder', w: 1240, h: 780, cropH: 1460, cropW: 2480 },
  { file: 'preview-analytics-zh.png', query: '?preview=1&lang=zh-TW&tab=analytics', w: 1160, h: 780, cropH: 1460, cropW: 2320 },
  { file: 'preview-graph-zh.png', query: '?preview=1&lang=zh-TW&tab=graph', w: 1160, h: 780, cropH: 1460, cropW: 2320 },
];

try {
  const baseUrl = pathToFileURL(appHtml).href;
  for (const job of jobs) {
    const outPath = join(assetsDir, job.file);
    const targetUrl = `${baseUrl}${job.query}`;
    execFileSync(
      chromeBin,
      [
        '--headless=new',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=2',
        `--window-size=${job.w},${job.h}`,
        '--virtual-time-budget=2500',
        `--user-data-dir=${userDataDir}`,
        `--screenshot=${outPath}`,
        targetUrl,
      ],
      { stdio: 'pipe', timeout: 25000 },
    );
    // Use y=1 to anchor top-left in sips and trim the bottom macOS headless frame artifact
    execFileSync(
      'sips',
      ['--cropOffset', '1', '0', '--cropToHeightWidth', String(job.cropH), String(job.cropW), outPath],
      { stdio: 'pipe' },
    );
    const bytes = statSync(outPath).size;
    console.log(`[capture] ${job.file} (${(bytes / 1024).toFixed(1)} KiB)`);
  }
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}
