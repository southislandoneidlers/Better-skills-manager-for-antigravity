import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSkillDocsServer } from './server/server.ts';
import { SkillStore } from './server/skillStore.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When bundled as dist/cli.mjs, package root is one level up from dist/
const pkgRoot = existsSync(join(__dirname, 'server.mjs'))
  ? resolve(__dirname, '..')
  : resolve(__dirname, '..');

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')) as {
      version?: string;
    };
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function defaultTargetDir(): string {
  return join(homedir(), '.gemini', 'config', 'plugins', 'skill-docs');
}

function parseOption(args: string[], flag: string): string | undefined {
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(eqPrefix)) {
      return args[i].slice(eqPrefix.length);
    }
    if (args[i] === flag && args[i + 1]) {
      return args[i + 1];
    }
  }
  return undefined;
}

function cmdInstall(args: string[]): void {
  const target = resolve(parseOption(args, '--target') || defaultTargetDir());
  const platform = parseOption(args, '--platform') || process.platform;
  const pluginSrc = join(pkgRoot, 'plugin');
  const distSrc = join(pkgRoot, 'dist');
  const serverJs = join(distSrc, 'server.mjs');
  const appHtml = join(distSrc, 'app.html');

  if (!existsSync(serverJs) || !existsSync(appHtml)) {
    throw new Error('Build artifacts dist/server.mjs or dist/app.html are missing. Run `npm run build` first.');
  }
  if (!existsSync(join(pluginSrc, 'plugin.json'))) {
    throw new Error(`Plugin manifest not found in ${pluginSrc}`);
  }

  mkdirSync(join(target, 'dist'), { recursive: true });
  cpSync(pluginSrc, target, { recursive: true });
  cpSync(serverJs, join(target, 'dist', 'server.mjs'));
  cpSync(appHtml, join(target, 'dist', 'app.html'));

  if (platform === 'win32') {
    const winConfig = {
      mcpServers: {
        server: {
          command: process.execPath,
          args: ['${PLUGIN_ROOT}/dist/server.mjs', '--data_dir=${PLUGIN_DATA}'],
        },
      },
    };
    writeFileSync(join(target, 'mcp_config.json'), JSON.stringify(winConfig, null, 2) + '\n', 'utf-8');
  } else {
    const wrapperPath = join(target, 'bin', 'skill-docs-server');
    if (existsSync(wrapperPath)) {
      chmodSync(wrapperPath, 0o755);
    }
  }

  console.log(`✅ Installed Better-skills-manager (v${readPackageVersion()}) to:\n   ${target}`);
  console.log('\nNext steps in Antigravity:');
  console.log('  1. Open the "+" menu in the right side pane (or left sidebar) and select "Better-skills-manager".');
  console.log('  2. Or ask the agent: "Open Better-skills-manager".');
}

function cmdUninstall(args: string[]): void {
  const target = resolve(parseOption(args, '--target') || defaultTargetDir());
  if (!existsSync(target)) {
    console.log(`ℹ️ Better-skills-manager plugin is not installed at ${target}`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`🗑️ Removed Better-skills-manager plugin from:\n   ${target}`);
  console.log('   (Your Skills under ~/.gemini/config/skills were preserved.)');
}

function cmdStatus(args: string[]): void {
  const target = resolve(parseOption(args, '--target') || defaultTargetDir());
  const installed = existsSync(join(target, 'plugin.json')) && existsSync(join(target, 'dist', 'server.mjs'));
  let installedVersion = 'unknown';
  if (installed) {
    try {
      const pj = JSON.parse(readFileSync(join(target, 'plugin.json'), 'utf-8')) as { version?: string };
      installedVersion = pj.version || '1.0.0';
    } catch {
      // ignore
    }
  }
  console.log(
    JSON.stringify(
      {
        installed,
        version: installed ? installedVersion : null,
        target,
      },
      null,
      2,
    ),
  );
}

async function cmdMcp(args: string[]): Promise<void> {
  const dataDir = parseOption(args, '--data_dir');
  const store = new SkillStore({
    pluginDataDir: dataDir,
    enableWatcher: true,
  });
  const server = createSkillDocsServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function printHelp(): void {
  console.log(`better-skills-manager v${readPackageVersion()} — Manage AI Skills as intuitively as regular documents

Usage:
  better-skills-manager install [--target <dir>]    Install Antigravity plugin (default: ~/.gemini/config/plugins/skill-docs or %USERPROFILE%\\.gemini\\config\\plugins\\skill-docs)
  better-skills-manager uninstall [--target <dir>]  Uninstall Antigravity plugin (keeps your skills intact)
  better-skills-manager status [--target <dir>]     Show plugin installation status as JSON
  better-skills-manager mcp [--data_dir <dir>]      Run the MCP Apps stdio server directly
  better-skills-manager --version                   Show version
  better-skills-manager --help                      Show this help message`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    printHelp();
    return;
  }
  if (sub === '--version' || sub === '-v') {
    console.log(readPackageVersion());
    return;
  }
  if (sub === 'install') {
    cmdInstall(argv.slice(1));
    return;
  }
  if (sub === 'uninstall') {
    cmdUninstall(argv.slice(1));
    return;
  }
  if (sub === 'status') {
    cmdStatus(argv.slice(1));
    return;
  }
  if (sub === 'mcp') {
    await cmdMcp(argv.slice(1));
    return;
  }

  console.error(`Unknown command: ${sub}\n`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('[skill-docs]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
