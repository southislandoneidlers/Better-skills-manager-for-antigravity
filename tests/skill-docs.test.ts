import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { SkillStore } from '../src/server/skillStore.ts';
import { parseSkillMarkdown } from '../src/server/frontmatter.ts';
import { toFileUri } from '../src/ui/i18n.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function makeTempEnv() {
  const root = mkdtempSync(join(tmpdir(), 'skill-docs-test-'));
  const homeDir = join(root, 'home');
  const globalConfigDir = join(homeDir, '.gemini', 'config');
  const appDataDir = join(homeDir, '.gemini', 'antigravity');
  const pluginDataDir = join(appDataDir, 'plugin_data', 'skill-docs');
  const builtinSkillsDir = join(appDataDir, 'builtin', 'skills');
  const scratchRootDir = join(appDataDir, 'scratch');

  mkdirSync(join(globalConfigDir, 'skills'), { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(builtinSkillsDir, { recursive: true });
  mkdirSync(scratchRootDir, { recursive: true });

  return {
    root,
    homeDir,
    globalConfigDir,
    appDataDir,
    pluginDataDir,
    builtinSkillsDir,
    scratchRootDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('AC-1 & AC-2: Single-document save preserves custom YAML, manages attachments, and 1-click fixes broken links', async () => {
  const env = makeTempEnv();
  const store = new SkillStore({ ...env, enableWatcher: false });
  try {
    const created = await store.createSkill({
      scopeId: 'global',
      name: 'deploy-helper',
      description: 'Use this skill when deploying services to production environments.',
      template: 'script-workflow',
    });

    assert.equal(created.validationStatus, 'ok');
    assert.equal(created.attachments.length, 1);
    assert.equal(created.attachments[0].relPath, 'scripts/run.sh');

    // Inject custom YAML field directly to test lossless preservation
    const rawWithCustom = `---\nname: deploy-helper\ndescription: Use this skill when deploying services.\nmetadata:\n  icon: rocket\n---\n\n# Deploy\n\nRun [setup](./scripts/setup.sh).\n`;
    writeFileSync(created.skillMdPath, rawWithCustom, 'utf-8');

    // Save structured fields & verify custom metadata preserved + broken link detected
    const updated = await store.saveSkill({
      id: created.id,
      mode: 'structured',
      name: 'Bad Name With Spaces',
      description: '',
      body: '# Deploy\n\nRun [setup](./scripts/setup.sh) and read [guide](./references/guide.md).\n',
    });

    const parsedAfterSave = parseSkillMarkdown(readFileSync(updated.skillMdPath, 'utf-8'));
    assert.deepEqual(parsedAfterSave.frontmatter.metadata, { icon: 'rocket' });

    assert.equal(updated.validationStatus, 'error');
    const codes = updated.issues.map((i) => i.code);
    assert.ok(codes.includes('invalid_name'));
    assert.ok(codes.includes('missing_description'));
    assert.ok(codes.includes('broken_link'));

    // Fix invalid name + missing broken links
    await store.fixIssue({ id: updated.id, action: 'slugify_name' });
    await store.fixIssue({
      id: updated.id,
      action: 'create_attachment',
      missingRelPath: 'scripts/setup.sh',
    });
    await store.fixIssue({
      id: updated.id,
      action: 'create_attachment',
      missingRelPath: 'references/guide.md',
    });
    const finalDetail = await store.saveSkill({
      id: updated.id,
      mode: 'structured',
      description: 'Use this skill when the user wants to deploy services safely.',
    });

    assert.equal(finalDetail.name, 'bad-name-with-spaces');
    assert.equal(finalDetail.validationStatus, 'ok');
    assert.equal(finalDetail.issues.length, 0);
    const setupSt = statSync(join(finalDetail.skillDir, 'scripts', 'setup.sh'));
    assert.ok((setupSt.mode & 0o111) !== 0, 'Created .sh attachment should be executable');
  } finally {
    store.close();
    env.cleanup();
  }
});

test('AC-3: Multi-level category folders sync skills.json while preserving existing inherits/entries and _disabled restore', async () => {
  const env = makeTempEnv();
  // Seed pre-existing skills.json with inherits & external entry
  const existingConfig = {
    inherits: [{ path: '/shared/team-skills.json', include_only: ['shared-linter'] }],
    entries: [{ path: '~/external-custom-skills' }],
  };
  writeFileSync(
    join(env.globalConfigDir, 'skills.json'),
    JSON.stringify(existingConfig, null, 2),
    'utf-8',
  );

  const store = new SkillStore({ ...env, enableWatcher: false });
  try {
    await store.manageFolder({
      scopeId: 'global',
      action: 'create',
      folderPath: '前端/React',
    });

    const created = await store.createSkill({
      scopeId: 'global',
      categoryPath: '前端/React',
      name: 'react-perf',
      description: 'Analyze React rendering performance and eliminate unnecessary re-renders.',
    });

    assert.equal(created.categoryPath, '前端/React');

    // Verify skills.json preserves inherits + external entry AND adds nested category folder
    const skillsJson = JSON.parse(readFileSync(join(env.globalConfigDir, 'skills.json'), 'utf-8'));
    assert.equal(skillsJson.inherits.length, 1);
    assert.equal(skillsJson.inherits[0].path, '/shared/team-skills.json');
    assert.ok(skillsJson.entries.some((e: { path: string }) => e.path === '~/external-custom-skills'));
    assert.ok(
      skillsJson.entries.some((e: { path: string }) => e.path.endsWith('/skills/前端/React')),
      'Nested category path must be registered in skills.json',
    );

    // Disable skill -> moves to _disabled/前端/React/react-perf and cleans skills.json managed entry
    const disabled = await store.toggleSkill(created.id, false);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.categoryPath, '前端/React');
    assert.ok(existsSync(join(env.globalConfigDir, 'skills', '_disabled', '前端', 'React', 'react-perf', 'SKILL.md')));

    const skillsJsonAfterDisable = JSON.parse(
      readFileSync(join(env.globalConfigDir, 'skills.json'), 'utf-8'),
    );
    assert.ok(
      !skillsJsonAfterDisable.entries.some((e: { path: string }) => e.path.includes('前端/React')),
    );
    assert.ok(
      skillsJsonAfterDisable.entries.some((e: { path: string }) => e.path === '~/external-custom-skills'),
    );

    // Re-enable -> restores exact category and re-syncs skills.json
    const reEnabled = await store.toggleSkill(disabled.id, true);
    assert.equal(reEnabled.enabled, true);
    assert.equal(reEnabled.categoryPath, '前端/React');
    const skillsJsonAfterEnable = JSON.parse(
      readFileSync(join(env.globalConfigDir, 'skills.json'), 'utf-8'),
    );
    assert.ok(
      skillsJsonAfterEnable.entries.some((e: { path: string }) => e.path.endsWith('/skills/前端/React')),
    );
  } finally {
    store.close();
    env.cleanup();
  }
});

test('AC-4: Lifecycle dates, local_dir & git update checks, backup-and-apply update, and fs.watch change detection', async () => {
  const env = makeTempEnv();
  const upstreamDir = join(env.root, 'upstream-skill');
  mkdirSync(upstreamDir, { recursive: true });
  writeFileSync(
    join(upstreamDir, 'SKILL.md'),
    `---\nname: upstream-tool\ndescription: Upstream skill tool v1.\nversion: 1.0.0\n---\n\n# v1\n`,
    'utf-8',
  );

  // Create a local bare git repo to test git update checks deterministically offline
  const bareRepo = join(env.root, 'bare-repo.git');
  const workRepo = join(env.root, 'work-repo');
  execFileSync('git', ['init', '--bare', bareRepo]);
  execFileSync('git', ['clone', bareRepo, workRepo]);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workRepo });
  writeFileSync(
    join(workRepo, 'SKILL.md'),
    `---\nname: git-skill\ndescription: Skill synced from local bare git repository.\nversion: 1.0.0\n---\n\n# Git v1\n`,
    'utf-8',
  );
  execFileSync('git', ['add', '.'], { cwd: workRepo });
  execFileSync('git', ['commit', '-m', 'v1'], { cwd: workRepo });
  execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: workRepo });

  const store = new SkillStore({ ...env, enableWatcher: true });
  try {
    // 1. Bind local_dir skill
    const localSkill = await store.createSkill({
      scopeId: 'global',
      name: 'local-copy',
      description: 'Skill synced from local upstream directory.',
    });
    assert.ok(localSkill.installedAt);
    assert.ok(localSkill.publishedAt);
    await store.bindSource({
      id: localSkill.id,
      sourceType: 'local_dir',
      location: upstreamDir,
    });

    // Mutate upstream -> checkUpdates detects update -> applyUpdate backs up & updates
    writeFileSync(
      join(upstreamDir, 'SKILL.md'),
      `---\nname: upstream-tool\ndescription: Upstream skill tool v2.\nversion: 2.0.0\n---\n\n# v2\n`,
      'utf-8',
    );
    const checkLocal = await store.checkUpdates(localSkill.id);
    assert.equal(checkLocal.updatesAvailable, 1);
    const appliedLocal = await store.applyUpdate(localSkill.id);
    assert.ok(existsSync(appliedLocal.backupPath));
    assert.equal(appliedLocal.detail.version, '2.0.0');
    assert.equal(appliedLocal.detail.sourceMeta.hasUpdate, false);

    // 2. Bind git skill against local bare repo
    const gitSkill = await store.createSkill({
      scopeId: 'global',
      name: 'git-skill',
      description: 'Skill synced from git repository.',
    });
    await store.bindSource({
      id: gitSkill.id,
      sourceType: 'git',
      location: bareRepo,
    });
    // Sync initial v1 commit first
    await store.applyUpdate(gitSkill.id);
    const checkGit1 = await store.checkUpdates(gitSkill.id);
    assert.equal(checkGit1.updatesAvailable, 0);

    // Push v2 commit to bare repo
    writeFileSync(
      join(workRepo, 'SKILL.md'),
      `---\nname: git-skill\ndescription: Skill synced from local bare git repository v2.\nversion: 2.0.0\n---\n\n# Git v2\n`,
      'utf-8',
    );
    execFileSync('git', ['add', '.'], { cwd: workRepo });
    execFileSync('git', ['commit', '-m', 'v2'], { cwd: workRepo });
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: workRepo });

    const checkGit2 = await store.checkUpdates(gitSkill.id);
    assert.equal(checkGit2.updatesAvailable, 1);
    const appliedGit = await store.applyUpdate(gitSkill.id);
    assert.equal(appliedGit.detail.version, '2.0.0');

    // 3. Test fs.watch 2-way Finder sync
    await store.getSnapshot(true);
    const seqBefore = store.getChangeSeq();
    const droppedDir = join(env.globalConfigDir, 'skills', 'finder-dropped');
    mkdirSync(droppedDir, { recursive: true });
    writeFileSync(
      join(droppedDir, 'SKILL.md'),
      `---\nname: finder-dropped\ndescription: Dropped directly in Finder for two-way sync verification.\n---\n\n# Dropped\n`,
      'utf-8',
    );

    // Wait up to 2s for debounced fs.watch
    let seqAfter = seqBefore;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      seqAfter = store.getChangeSeq();
      if (seqAfter > seqBefore) break;
    }
    assert.ok(seqAfter > seqBefore, 'fs.watch should bump changeSeq when Finder drops a skill');
    const snapAfter = await store.getSnapshot();
    assert.ok(snapAfter.skills.some((s) => s.name === 'finder-dropped'));
  } finally {
    store.close();
    env.cleanup();
  }
});

test('AC-5 & AC-6: Usage analytics (total, 30d, 365d heatmap, dedup) and multi-skill relationships (explicit_ref, co_usage, overlap)', async () => {
  const env = makeTempEnv();
  const now = new Date();
  const daysAgoIso = (days: number, offsetMinutes = 0) =>
    new Date(now.getTime() - days * 86400_000 + offsetMinutes * 60_000).toISOString();

  // Create two collaborating skills + one overlapping skill
  const skillsRoot = join(env.globalConfigDir, 'skills');
  mkdirSync(join(skillsRoot, 'mcp-builder'), { recursive: true });
  writeFileSync(
    join(skillsRoot, 'mcp-builder', 'SKILL.md'),
    `---\nname: mcp-builder\ndescription: Build MCP server tools and package them as Antigravity plugins with TypeScript.\n---\n\n# MCP Builder\n\nAfter building, follow \`plugin-packer\` to package.\n`,
    'utf-8',
  );

  mkdirSync(join(skillsRoot, 'plugin-packer'), { recursive: true });
  writeFileSync(
    join(skillsRoot, 'plugin-packer', 'SKILL.md'),
    `---\nname: plugin-packer\ndescription: Package MCP server bundles into plugin.json and mcp_config.json directories.\n---\n\n# Plugin Packer\n\nBundle your tools cleanly.\n`,
    'utf-8',
  );

  mkdirSync(join(skillsRoot, 'mcp-builder-copy'), { recursive: true });
  writeFileSync(
    join(skillsRoot, 'mcp-builder-copy', 'SKILL.md'),
    `---\nname: mcp-builder-copy\ndescription: Build MCP server tools and package them as Antigravity plugins with TypeScript helpers.\n---\n\n# Duplicate Scope\n`,
    'utf-8',
  );

  // Create mock transcripts spanning today, 10 days ago, and 180 days ago
  const conv1Logs = join(env.appDataDir, 'brain', 'conv-11111111', '.system_generated', 'logs');
  mkdirSync(conv1Logs, { recursive: true });
  const linesConv1 = [
    // Today: mcp-builder read twice within 2 min (should dedup to 1) + plugin-packer read (co-usage!)
    JSON.stringify({
      created_at: daysAgoIso(0, -10),
      type: 'GENERIC',
      tool_calls: [{ name: 'read_file', args: { Path: '/Users/x/.gemini/config/skills/mcp-builder/SKILL.md' } }],
    }),
    JSON.stringify({
      created_at: daysAgoIso(0, -8),
      type: 'GENERIC',
      tool_calls: [{ name: 'read_file', args: { Path: '/Users/x/.gemini/config/skills/mcp-builder/SKILL.md' } }],
    }),
    JSON.stringify({
      created_at: daysAgoIso(0, -5),
      type: 'USER_INPUT',
      content: '<USER_REQUEST>\n/plugin-packer bundle this\n</USER_REQUEST>',
    }),
  ];
  writeFileSync(join(conv1Logs, 'transcript_full.jsonl'), linesConv1.join('\n') + '\n', 'utf-8');

  const conv2Logs = join(env.appDataDir, 'brain', 'conv-22222222', '.system_generated', 'logs');
  mkdirSync(conv2Logs, { recursive: true });
  const linesConv2 = [
    // 10 days ago (within 30d)
    JSON.stringify({
      created_at: daysAgoIso(10),
      type: 'GENERIC',
      tool_calls: [{ name: 'read_file', args: { Path: '/Users/x/.gemini/config/skills/mcp-builder/SKILL.md' } }],
    }),
    // 180 days ago (within 365d, outside 30d)
    JSON.stringify({
      created_at: daysAgoIso(180),
      type: 'GENERIC',
      tool_calls: [{ name: 'read_file', args: { Path: '/Users/x/.gemini/config/skills/mcp-builder/SKILL.md' } }],
    }),
  ];
  writeFileSync(join(conv2Logs, 'transcript_full.jsonl'), linesConv2.join('\n') + '\n', 'utf-8');

  const store = new SkillStore({ ...env, enableWatcher: false });
  try {
    const snap = await store.getSnapshot(true);
    const mcpBuilder = snap.skills.find((s) => s.name === 'mcp-builder')!;
    const pluginPacker = snap.skills.find((s) => s.name === 'plugin-packer')!;
    const mcpCopy = snap.skills.find((s) => s.name === 'mcp-builder-copy')!;

    assert.equal(mcpBuilder.totalUses, 3, '2 reads in 2 mins should dedup + 10d + 180d = 3 total');
    assert.equal(mcpBuilder.last30dUses, 2, 'Today + 10d ago = 2 in last 30 days');
    assert.equal(pluginPacker.totalUses, 1);
    assert.equal(pluginPacker.last30dUses, 1);
    assert.equal(mcpCopy.totalUses, 0);
    assert.ok(snap.analytics.idleSkillIds.includes(mcpCopy.id));

    const builderDetail = await store.getSkillDetail(mcpBuilder.id);
    assert.equal(Object.values(builderDetail.usage.dailyCounts365).reduce((a, b) => a + b, 0), 3);
    assert.equal(builderDetail.usage.recentEvents.length, 3);

    // Relationships: explicit_ref + co_usage with plugin-packer, high_similarity with mcp-builder-copy
    const relWithPacker = builderDetail.relations.find((r) => r.targetId === pluginPacker.id);
    assert.ok(relWithPacker, 'Should detect relationship with plugin-packer');
    assert.ok(relWithPacker.reasons.some((r) => r.type === 'explicit_ref'));
    assert.ok(relWithPacker.reasons.some((r) => r.type === 'co_usage'));

    const relWithCopy = builderDetail.relations.find((r) => r.targetId === mcpCopy.id);
    assert.ok(relWithCopy, 'Should detect high_similarity warning with mcp-builder-copy');
    assert.ok(relWithCopy.reasons.some((r) => r.type === 'high_similarity'));
  } finally {
    store.close();
    env.cleanup();
  }
});

test('MCP E2E: dist/server.mjs exposes UI resource, entrypoints, and working tools over stdio', async () => {
  const serverPath = join(projectRoot, 'dist', 'server.mjs');
  assert.ok(existsSync(serverPath), 'dist/server.mjs must be built before running E2E test');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' }, {});
  await client.connect(transport);

  try {
    const resources = await client.listResources();
    const uiRes = resources.resources.find((r) => r.uri === 'ui://skill-docs/app.html');
    assert.ok(uiRes, 'UI resource must be listed');
    assert.equal(uiRes.mimeType, RESOURCE_MIME_TYPE);

    const readRes = await client.readResource({ uri: 'ui://skill-docs/app.html' });
    const first = readRes.contents[0] as { text?: string; mimeType?: string };
    assert.equal(first.mimeType, RESOURCE_MIME_TYPE);
    assert.ok(first.text && first.text.includes('<div id="root"></div>'));
    assert.ok(first.text.length < 10 * 1024 * 1024);

    const tools = await client.listTools();
    const openTool = tools.tools.find((t) => t.name === 'open_skill_docs') as Record<string, unknown>;
    assert.ok(openTool, 'open_skill_docs tool must be listed');
    const meta = openTool._meta as Record<string, unknown>;
    assert.ok(meta?.ui);
    const agyUi = meta['com.google.antigravity/ui'] as { entrypoints: Array<{ type: string }> };
    assert.ok(agyUi.entrypoints.some((e) => e.type === 'aux_pane'));
    assert.ok(agyUi.entrypoints.some((e) => e.type === 'global'));

    const callRes = await client.callTool({ name: 'open_skill_docs', arguments: {} });
    assert.ok(!callRes.isError);
    assert.ok(callRes.structuredContent);

    const snapRes = await client.callTool({ name: 'app_get_snapshot', arguments: {} });
    assert.ok(!snapRes.isError);
    assert.ok((snapRes.structuredContent as { snapshot?: unknown })?.snapshot);
  } finally {
    await client.close();
  }
});

test('CLI: dist/cli.mjs install, status, and uninstall work cleanly in isolated target directory', () => {
  const cliPath = join(projectRoot, 'dist', 'cli.mjs');
  assert.ok(existsSync(cliPath), 'dist/cli.mjs must be built before running CLI test');

  const tmpBase = mkdtempSync(join(tmpdir(), 'skill-docs-cli-'));
  const targetDir = join(tmpBase, 'plugins', 'skill-docs');
  try {
    execFileSync(process.execPath, [cliPath, 'install', '--target', targetDir], { stdio: 'pipe' });
    assert.ok(existsSync(join(targetDir, 'plugin.json')));
    assert.ok(existsSync(join(targetDir, 'mcp_config.json')));
    assert.ok(existsSync(join(targetDir, 'dist', 'server.mjs')));
    assert.ok(existsSync(join(targetDir, 'dist', 'app.html')));
    assert.ok(existsSync(join(targetDir, 'skills', 'skill-docs-guide', 'SKILL.md')));

    const statusOut = execFileSync(process.execPath, [cliPath, 'status', '--target', targetDir], {
      encoding: 'utf-8',
    });
    const statusJson = JSON.parse(statusOut) as { installed: boolean; version: string | null };
    assert.equal(statusJson.installed, true);
    assert.equal(statusJson.version, '1.1.1');

    execFileSync(process.execPath, [cliPath, 'uninstall', '--target', targetDir], { stdio: 'pipe' });
    assert.equal(existsSync(targetDir), false);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('Windows compat: toFileUri encodes POSIX, Windows drive, and UNC paths cleanly', () => {
  assert.equal(toFileUri('/Users/alice/my app/SKILL.md'), 'file:///Users/alice/my%20app/SKILL.md');
  assert.equal(
    toFileUri('C:\\Users\\Alice Smith\\my-skill\\SKILL.md'),
    'file:///C:/Users/Alice%20Smith/my-skill/SKILL.md',
  );
  assert.equal(
    toFileUri('D:\\work\\#tag?\\SKILL.md'),
    'file:///D:/work/%23tag%3F/SKILL.md',
  );
  assert.equal(toFileUri('\\\\fileserver\\skills\\SKILL.md'), 'file://fileserver/skills/SKILL.md');
});

test('Windows compat: CLI install --platform win32 writes direct node executable in mcp_config.json', () => {
  const cliPath = join(projectRoot, 'dist', 'cli.mjs');
  const tmpBase = mkdtempSync(join(tmpdir(), 'skill-docs-win-cli-'));
  const targetDir = join(tmpBase, 'plugins', 'skill-docs');
  try {
    execFileSync(
      process.execPath,
      [cliPath, 'install', '--platform', 'win32', '--target', targetDir],
      { stdio: 'pipe' },
    );
    const cfg = JSON.parse(readFileSync(join(targetDir, 'mcp_config.json'), 'utf-8')) as {
      mcpServers?: { server?: { command?: string; args?: string[] } };
    };
    assert.equal(cfg.mcpServers?.server?.command, process.execPath);
    assert.deepEqual(cfg.mcpServers?.server?.args, [
      '${PLUGIN_ROOT}/dist/server.mjs',
      '--data_dir=${PLUGIN_DATA}',
    ]);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('Windows compat: SkillStore normalizes backslash category paths when creating skills', async () => {
  const env = makeTempEnv();
  const store = new SkillStore({ ...env, enableWatcher: false });
  try {
    const created = await store.createSkill({
      scopeId: 'global',
      categoryPath: '\\frontend\\react\\',
      name: 'win-cat-skill',
      description: 'Valid description for testing backslash category normalization',
    });
    assert.equal(created.categoryPath, 'frontend/react');
    assert.equal(
      existsSync(join(env.globalConfigDir, 'skills', 'frontend', 'react', 'win-cat-skill', 'SKILL.md')),
      true,
    );
  } finally {
    store.close();
    env.cleanup();
  }
});

test('Preferences: uiLang persists cleanly across snapshots', async () => {
  const env = makeTempEnv();
  const store = new SkillStore({ ...env, enableWatcher: false });
  try {
    assert.equal((await store.getSnapshot(true)).uiLang, undefined);
    store.setUiLang('en');
    assert.equal((await store.getSnapshot(true)).uiLang, 'en');
    store.setUiLang('zh-TW');
    assert.equal((await store.getSnapshot(true)).uiLang, 'zh-TW');
  } finally {
    store.close();
    env.cleanup();
  }
});

test('i18n Guard: README.zh-TW, plugin, UI, and server files contain zero Mainland China terms', () => {
  const bannedTerms = [
    '宿主', '去重', '防抖', '倉庫', '納管', '兜底', '默認', '激活', '緩存', '組件',
    '回調', '調用', '代碼', '信息', '網絡', '硬盤', '菜單', '鼠標', '字節', '痛點',
    '實戰共現', '文件夾', '配置項', '視圖', '上下文',
  ];

  const filesToCheck: string[] = [join(projectRoot, 'README.zh-TW.md')];
  const collectFiles = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full);
      else if (/\.(ts|tsx|md|json)$/i.test(entry.name)) filesToCheck.push(full);
    }
  };
  collectFiles(join(projectRoot, 'src'));
  collectFiles(join(projectRoot, 'plugin'));

  const violations: string[] = [];
  for (const file of filesToCheck) {
    const content = readFileSync(file, 'utf-8');
    for (const term of bannedTerms) {
      if (content.includes(term)) {
        violations.push(`${file}: contains banned term "${term}"`);
      }
    }
  }
  assert.deepEqual(violations, [], `Found Mainland Chinese terms:\n${violations.join('\n')}`);
});
