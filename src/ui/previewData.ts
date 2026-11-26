import type {
  CategoryNode,
  GraphEdge,
  ScopeInfo,
  SkillDetail,
  SkillSummary,
  SnapshotPayload,
  UiLang,
} from '../shared/types.ts';

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function buildHeatmapCounts(entries: Array<[number, number]>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [ago, count] of entries) {
    const d = new Date();
    d.setDate(d.getDate() - ago);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    map[key] = (map[key] || 0) + count;
  }
  return map;
}

export function buildPreviewDataset(lang: UiLang): {
  snapshot: SnapshotPayload;
  details: Record<string, SkillDetail>;
} {
  const isZh = lang === 'zh-TW';

  const scopes: ScopeInfo[] = [
    {
      id: 'global',
      label: isZh ? '全域技能庫 (~/.gemini/config)' : 'Global Skills (~/.gemini/config)',
      kind: 'global',
      rootDir: '~/.gemini/config',
      skillsDir: '~/.gemini/config/skills',
      readOnly: false,
      exists: true,
      skillCount: 4,
    },
    {
      id: 'ws-webapp',
      label: isZh ? '專案：my-web-app' : 'Project: my-web-app',
      kind: 'workspace',
      rootDir: '~/projects/my-web-app/.agents',
      skillsDir: '~/projects/my-web-app/.agents/skills',
      readOnly: false,
      exists: true,
      skillCount: 2,
    },
    {
      id: 'builtin',
      label: isZh ? '內建技能 (唯讀參考)' : 'Built-in Skills (Read-only)',
      kind: 'builtin',
      rootDir: 'builtin/skills',
      skillsDir: 'builtin/skills',
      readOnly: true,
      exists: true,
      skillCount: 1,
    },
  ];

  const folders: CategoryNode[] = [
    {
      id: 'global::folder::frontend',
      name: isZh ? '前端開發' : 'frontend',
      path: 'frontend',
      scopeId: 'global',
      skillCount: 2,
      children: [
        {
          id: 'global::folder::frontend/react',
          name: 'react',
          path: 'frontend/react',
          scopeId: 'global',
          skillCount: 2,
          children: [],
        },
      ],
    },
    {
      id: 'global::folder::automation',
      name: isZh ? '自動化腳本' : 'automation',
      path: 'automation',
      scopeId: 'global',
      skillCount: 2,
      children: [],
    },
  ];

  const dsHeat = buildHeatmapCounts([
    [0, 3], [1, 2], [3, 4], [5, 1], [8, 2], [12, 3], [18, 2], [24, 1],
    [35, 3], [48, 2], [65, 4], [90, 2], [120, 1], [160, 2], [210, 3],
  ]);
  const e2eHeat = buildHeatmapCounts([
    [0, 2], [2, 2], [3, 2], [7, 2], [14, 2], [21, 2], [40, 1], [75, 2],
  ]);
  const relHeat = buildHeatmapCounts([
    [1, 1], [10, 2], [28, 1], [55, 2], [95, 1],
  ]);
  const mcpHeat = buildHeatmapCounts([
    [4, 2], [16, 1], [44, 1], [110, 2],
  ]);

  const rawDsBody = isZh
    ? `# Frontend Design System\n\n當建置或調整 React UI 元件時，依循以下設計規範：\n\n1. 先檢查 [tokens.md](./references/tokens.md) 的配色與間距變數。\n2. 執行元件視覺檢查腳本：[check-ui.sh](./scripts/check-ui.sh)。\n3. 若需要跑完整端對端瀏覽器測試，可搭配 \`playwright-e2e-runner\`。`
    : `# Frontend Design System\n\nFollow these steps when building or refactoring React UI components:\n\n1. Review color & spacing tokens in [tokens.md](./references/tokens.md).\n2. Run the UI verification script: [check-ui.sh](./scripts/check-ui.sh).\n3. Pair with \`playwright-e2e-runner\` when full browser E2E coverage is needed.`;

  const s1: SkillDetail = {
    id: 'global::active::frontend/react/frontend-design-system',
    dirName: 'frontend-design-system',
    name: 'frontend-design-system',
    description: isZh
      ? '建置 React UI 元件與設計系統時使用，自動套用色票規範並驗證介面排版。'
      : 'Use when building or styling React UI components to enforce design tokens and run layout checks.',
    scopeId: 'global',
    scopeLabel: scopes[0].label,
    scopeKind: 'global',
    readOnly: false,
    enabled: true,
    categoryPath: 'frontend/react',
    skillDir: '~/.gemini/config/skills/frontend/react/frontend-design-system',
    skillMdPath: '~/.gemini/config/skills/frontend/react/frontend-design-system/SKILL.md',
    attachmentCount: 2,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(45),
    publishedAt: daysAgo(6),
    sourceMeta: {
      sourceType: 'git',
      sourceUrl: 'https://github.com/example/design-skills.git',
      installedAt: daysAgo(45),
      publishedAt: daysAgo(6),
      lastSyncedHash: 'a1b2c3d',
      remoteLatestHash: 'f8e9d0a',
      lastCheckedAt: daysAgo(0),
      hasUpdate: true,
      checkStatus: 'update_available',
      checkMessage: isZh ? '偵測到遠端有新版本 (a1b2c3d → f8e9d0a)' : 'New commits available upstream (a1b2c3d → f8e9d0a)',
    },
    totalUses: 35,
    last30dUses: 18,
    lastUsedAt: daysAgo(0),
    idleDays: 0,
    relationCount: 2,
    hasOverlapWarning: false,
    version: '1.4.0',
    repository: 'https://github.com/example/design-skills',
    body: rawDsBody,
    rawContent: `---\nname: frontend-design-system\ndescription: ${isZh ? '建置 React UI 元件與設計系統時使用，自動套用色票規範並驗證介面排版。' : 'Use when building or styling React UI components to enforce design tokens and run layout checks.'}\nversion: 1.4.0\n---\n\n${rawDsBody}`,
    extraFrontmatterKeys: [],
    attachments: [
      { relPath: 'scripts/check-ui.sh', name: 'check-ui.sh', folder: 'scripts', size: 420, isBinary: false, executable: true },
      { relPath: 'references/tokens.md', name: 'tokens.md', folder: 'references', size: 1280, isBinary: false, executable: false },
    ],
    usage: {
      totalUses: 35,
      last30dUses: 18,
      lastUsedAt: daysAgo(0),
      idleDays: 0,
      dailyCounts365: dsHeat,
      recentEvents: [
        { timestamp: daysAgo(0), source: 'read_file', conversationId: 'conv-9a14f0c2', skillKey: 'frontend-design-system' },
        { timestamp: daysAgo(1), source: 'panel_attach', conversationId: 'panel-context', skillKey: 'frontend-design-system' },
        { timestamp: daysAgo(3), source: 'slash_command', conversationId: 'conv-7b2218d4', skillKey: 'frontend-design-system' },
      ],
    },
    relations: [
      {
        targetId: 'global::active::frontend/react/playwright-e2e-runner',
        targetName: 'playwright-e2e-runner',
        targetScopeId: 'global',
        targetScopeLabel: scopes[0].label,
        targetDescription: isZh
          ? '執行 Playwright 端對端瀏覽器測試並截圖驗證畫面是否正常。'
          : 'Run Playwright E2E browser flows and capture screenshots to verify UI changes.',
        score: 0.92,
        reasons: [
          {
            type: 'explicit_ref',
            label: '明確引用',
            detail: '本文件主文或腳本提及「playwright-e2e-runner」',
            weight: 0.9,
            meta: { targetSkillName: 'playwright-e2e-runner', isReverseRef: false },
          },
          {
            type: 'co_usage',
            label: '同對話搭配',
            detail: '曾在 6 次對話中一起搭配使用',
            weight: 0.85,
            meta: { coCount: 6 },
          },
        ],
      },
      {
        targetId: 'ws-webapp::active::ui-component-audit',
        targetName: 'ui-component-audit',
        targetScopeId: 'ws-webapp',
        targetScopeLabel: scopes[1].label,
        targetDescription: isZh
          ? '檢查 React UI 元件無障礙屬性與設計色票一致性的工具。'
          : 'Audit React UI components for accessibility attributes and design token usage.',
        score: 0.56,
        reasons: [
          {
            type: 'high_similarity',
            label: '⚠️ 觸發描述重疊',
            detail: '觸發描述相似度達 56%（共同關鍵詞：react, ui, design, tokens），建議釐清分工以免 Agent 選錯',
            weight: 0.56,
            meta: { simPercent: 56, sharedTokens: ['react', 'ui', 'design', 'tokens'] },
          },
        ],
      },
    ],
  };

  const s2: SkillDetail = {
    id: 'global::active::frontend/react/playwright-e2e-runner',
    dirName: 'playwright-e2e-runner',
    name: 'playwright-e2e-runner',
    description: isZh
      ? '執行 Playwright 端對端瀏覽器測試並截圖驗證畫面是否正常。'
      : 'Run Playwright E2E browser flows and capture screenshots to verify UI changes.',
    scopeId: 'global',
    scopeLabel: scopes[0].label,
    scopeKind: 'global',
    readOnly: false,
    enabled: true,
    categoryPath: 'frontend/react',
    skillDir: '~/.gemini/config/skills/frontend/react/playwright-e2e-runner',
    skillMdPath: '~/.gemini/config/skills/frontend/react/playwright-e2e-runner/SKILL.md',
    attachmentCount: 1,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(60),
    publishedAt: daysAgo(14),
    sourceMeta: {
      sourceType: 'git',
      sourceUrl: 'https://github.com/example/e2e-skills.git',
      installedAt: daysAgo(60),
      publishedAt: daysAgo(14),
      lastSyncedHash: '91c0de2',
      remoteLatestHash: '91c0de2',
      lastCheckedAt: daysAgo(0),
      hasUpdate: false,
      checkStatus: 'up_to_date',
      checkMessage: isZh ? '已是最新版本 (91c0de2)' : 'Up to date (91c0de2)',
    },
    totalUses: 15,
    last30dUses: 10,
    lastUsedAt: daysAgo(0),
    idleDays: 0,
    relationCount: 1,
    hasOverlapWarning: false,
    version: '2.1.0',
    body: isZh ? '# Playwright E2E\n\n執行 `npx playwright test` 並輸出失敗截圖。' : '# Playwright E2E\n\nRun `npx playwright test` and inspect screenshots.',
    rawContent: '---\nname: playwright-e2e-runner\n---\n',
    extraFrontmatterKeys: [],
    attachments: [
      { relPath: 'scripts/run-e2e.sh', name: 'run-e2e.sh', folder: 'scripts', size: 280, isBinary: false, executable: true },
    ],
    usage: {
      totalUses: 15,
      last30dUses: 10,
      lastUsedAt: daysAgo(0),
      idleDays: 0,
      dailyCounts365: e2eHeat,
      recentEvents: [
        { timestamp: daysAgo(0), source: 'read_file', conversationId: 'conv-9a14f0c2', skillKey: 'playwright-e2e-runner' },
      ],
    },
    relations: [
      {
        targetId: s1.id,
        targetName: s1.name,
        targetScopeId: s1.scopeId,
        targetScopeLabel: s1.scopeLabel,
        targetDescription: s1.description,
        score: 0.92,
        reasons: [
          {
            type: 'explicit_ref',
            label: '被引用協作',
            detail: '被「frontend-design-system」的說明或腳本點名搭配使用',
            weight: 0.9,
            meta: { targetSkillName: 'frontend-design-system', isReverseRef: true },
          },
          {
            type: 'co_usage',
            label: '同對話搭配',
            detail: '曾在 6 次對話中一起搭配使用',
            weight: 0.85,
            meta: { coCount: 6 },
          },
        ],
      },
    ],
  };

  const s3: SkillDetail = {
    id: 'global::active::automation/release-notes-bot',
    dirName: 'release-notes-bot',
    name: 'release-notes-bot',
    description: isZh
      ? '彙整近期 Git Commit 紀錄並產出中英文版本更新說明。'
      : 'Summarize recent Git commits into bilingual release notes and CHANGELOG updates.',
    scopeId: 'global',
    scopeLabel: scopes[0].label,
    scopeKind: 'global',
    readOnly: false,
    enabled: true,
    categoryPath: 'automation',
    skillDir: '~/.gemini/config/skills/automation/release-notes-bot',
    skillMdPath: '~/.gemini/config/skills/automation/release-notes-bot/SKILL.md',
    attachmentCount: 0,
    validationStatus: 'error',
    issues: [
      {
        code: 'broken_link',
        severity: 'error',
        message: '附件連結斷連：找不到「scripts/gen-changelog.sh」',
        fixLabel: '+ 一鍵建立此附件',
        missingRelPath: 'scripts/gen-changelog.sh',
      },
    ],
    installedAt: daysAgo(90),
    publishedAt: daysAgo(30),
    sourceMeta: {
      sourceType: 'local_original',
      installedAt: daysAgo(90),
      publishedAt: daysAgo(30),
      hasUpdate: false,
      checkStatus: 'local_original',
    },
    totalUses: 7,
    last30dUses: 4,
    lastUsedAt: daysAgo(1),
    idleDays: 1,
    relationCount: 1,
    hasOverlapWarning: false,
    body: 'Run [gen-changelog.sh](./scripts/gen-changelog.sh) before tagging.',
    rawContent: '---\nname: release-notes-bot\n---\n',
    extraFrontmatterKeys: [],
    attachments: [],
    usage: {
      totalUses: 7,
      last30dUses: 4,
      lastUsedAt: daysAgo(1),
      idleDays: 1,
      dailyCounts365: relHeat,
      recentEvents: [],
    },
    relations: [
      {
        targetId: 'global::active::automation/mcp-plugin-packager',
        targetName: 'mcp-plugin-packager',
        targetScopeId: 'global',
        targetScopeLabel: scopes[0].label,
        targetDescription: isZh ? '打包 MCP Server 與外掛清單並檢查發佈版本。' : 'Package MCP server bundles and verify plugin manifests before release.',
        score: 0.45,
        reasons: [
          {
            type: 'domain_overlap',
            label: '工具／領域相近',
            detail: '共用領域工具關鍵詞：git, release',
            weight: 0.45,
            meta: { sharedTokens: ['git', 'release'] },
          },
        ],
      },
    ],
  };

  const s4: SkillDetail = {
    id: 'global::active::automation/mcp-plugin-packager',
    dirName: 'mcp-plugin-packager',
    name: 'mcp-plugin-packager',
    description: isZh
      ? '打包 MCP Server 與外掛清單並檢查發佈版本。'
      : 'Package MCP server bundles and verify plugin manifests before release.',
    scopeId: 'global',
    scopeLabel: scopes[0].label,
    scopeKind: 'global',
    readOnly: false,
    enabled: true,
    categoryPath: 'automation',
    skillDir: '~/.gemini/config/skills/automation/mcp-plugin-packager',
    skillMdPath: '~/.gemini/config/skills/automation/mcp-plugin-packager/SKILL.md',
    attachmentCount: 1,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(120),
    publishedAt: daysAgo(45),
    sourceMeta: {
      sourceType: 'local_dir',
      sourceDir: '~/templates/mcp-plugin-packager',
      installedAt: daysAgo(120),
      publishedAt: daysAgo(45),
      hasUpdate: false,
      checkStatus: 'up_to_date',
    },
    totalUses: 6,
    last30dUses: 2,
    lastUsedAt: daysAgo(4),
    idleDays: 4,
    relationCount: 1,
    hasOverlapWarning: false,
    body: '# MCP Plugin Packager\n',
    rawContent: '---\nname: mcp-plugin-packager\n---\n',
    extraFrontmatterKeys: [],
    attachments: [{ relPath: 'scripts/pack.mjs', name: 'pack.mjs', folder: 'scripts', size: 610, isBinary: false, executable: false }],
    usage: { totalUses: 6, last30dUses: 2, lastUsedAt: daysAgo(4), idleDays: 4, dailyCounts365: mcpHeat, recentEvents: [] },
    relations: [
      {
        targetId: s3.id,
        targetName: s3.name,
        targetScopeId: s3.scopeId,
        targetScopeLabel: s3.scopeLabel,
        targetDescription: s3.description,
        score: 0.45,
        reasons: s3.relations[0].reasons,
      },
    ],
  };

  const s5: SkillDetail = {
    id: 'ws-webapp::active::ui-component-audit',
    dirName: 'ui-component-audit',
    name: 'ui-component-audit',
    description: isZh
      ? '檢查 React UI 元件無障礙屬性與設計色票一致性的工具。'
      : 'Audit React UI components for accessibility attributes and design token usage.',
    scopeId: 'ws-webapp',
    scopeLabel: scopes[1].label,
    scopeKind: 'workspace',
    readOnly: false,
    enabled: true,
    categoryPath: '',
    skillDir: '~/projects/my-web-app/.agents/skills/ui-component-audit',
    skillMdPath: '~/projects/my-web-app/.agents/skills/ui-component-audit/SKILL.md',
    attachmentCount: 0,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(75),
    publishedAt: daysAgo(75),
    sourceMeta: { sourceType: 'local_original', installedAt: daysAgo(75), publishedAt: daysAgo(75), checkStatus: 'local_original' },
    totalUses: 0,
    last30dUses: 0,
    idleDays: null,
    relationCount: 1,
    hasOverlapWarning: true,
    body: '# UI Audit\n',
    rawContent: '---\nname: ui-component-audit\n---\n',
    extraFrontmatterKeys: [],
    attachments: [],
    usage: { totalUses: 0, last30dUses: 0, idleDays: null, dailyCounts365: {}, recentEvents: [] },
    relations: [
      {
        targetId: s1.id,
        targetName: s1.name,
        targetScopeId: s1.scopeId,
        targetScopeLabel: s1.scopeLabel,
        targetDescription: s1.description,
        score: 0.56,
        reasons: s1.relations[1].reasons,
      },
    ],
  };

  const s6: SkillDetail = {
    id: 'ws-webapp::disabled::legacy-webpack-migrator',
    dirName: 'legacy-webpack-migrator',
    name: 'legacy-webpack-migrator',
    description: isZh ? '將舊版 Webpack 設定遷移至 Vite 的一次性腳本。' : 'Migrate legacy Webpack configs to Vite.',
    scopeId: 'ws-webapp',
    scopeLabel: scopes[1].label,
    scopeKind: 'workspace',
    readOnly: false,
    enabled: false,
    categoryPath: '',
    skillDir: '~/projects/my-web-app/.agents/skills/_disabled/legacy-webpack-migrator',
    skillMdPath: '~/projects/my-web-app/.agents/skills/_disabled/legacy-webpack-migrator/SKILL.md',
    attachmentCount: 0,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(190),
    publishedAt: daysAgo(190),
    sourceMeta: { sourceType: 'local_original', installedAt: daysAgo(190), publishedAt: daysAgo(190), checkStatus: 'local_original' },
    totalUses: 2,
    last30dUses: 0,
    lastUsedAt: daysAgo(120),
    idleDays: 120,
    relationCount: 0,
    hasOverlapWarning: false,
    body: '# Legacy Webpack Migrator\n',
    rawContent: '---\nname: legacy-webpack-migrator\n---\n',
    extraFrontmatterKeys: [],
    attachments: [],
    usage: { totalUses: 2, last30dUses: 0, lastUsedAt: daysAgo(120), idleDays: 120, dailyCounts365: buildHeatmapCounts([[120, 2]]), recentEvents: [] },
    relations: [],
  };

  const s7: SkillDetail = {
    id: 'builtin::active::mcp-app-development',
    dirName: 'mcp-app-development',
    name: 'mcp-app-development',
    description: isZh ? 'Antigravity 內建開發指南：建立與除錯 MCP Apps 側邊欄外掛。' : 'Built-in guide for building and debugging MCP Apps side-pane UIs.',
    scopeId: 'builtin',
    scopeLabel: scopes[2].label,
    scopeKind: 'builtin',
    readOnly: true,
    enabled: true,
    categoryPath: '',
    skillDir: 'builtin/skills/mcp-app-development',
    skillMdPath: 'builtin/skills/mcp-app-development/SKILL.md',
    attachmentCount: 0,
    validationStatus: 'ok',
    issues: [],
    installedAt: daysAgo(200),
    publishedAt: daysAgo(30),
    sourceMeta: { sourceType: 'builtin', installedAt: daysAgo(200), publishedAt: daysAgo(30), checkStatus: 'builtin' },
    totalUses: 11,
    last30dUses: 5,
    lastUsedAt: daysAgo(2),
    idleDays: 2,
    relationCount: 0,
    hasOverlapWarning: false,
    body: '# Developing MCP Apps\n',
    rawContent: '---\nname: mcp-app-development\n---\n',
    extraFrontmatterKeys: [],
    attachments: [],
    usage: { totalUses: 11, last30dUses: 5, lastUsedAt: daysAgo(2), idleDays: 2, dailyCounts365: buildHeatmapCounts([[2, 3], [9, 2], [22, 2], [60, 4]]), recentEvents: [] },
    relations: [],
  };

  const detailsList = [s1, s2, s3, s4, s5, s6, s7];
  const details: Record<string, SkillDetail> = {};
  const skills: SkillSummary[] = [];
  const globalDaily: Record<string, number> = {};

  for (const d of detailsList) {
    details[d.id] = d;
    const { body: _b, rawContent: _r, attachments: _a, usage, relations: _rel, extraFrontmatterKeys: _e, ...sum } = d;
    skills.push(sum);
    for (const [k, v] of Object.entries(usage.dailyCounts365)) {
      globalDaily[k] = (globalDaily[k] || 0) + v;
    }
  }

  const graphEdges: GraphEdge[] = [
    {
      sourceId: s1.id,
      targetId: s2.id,
      score: 0.92,
      reasons: s1.relations[0].reasons,
    },
    {
      sourceId: s1.id,
      targetId: s5.id,
      score: 0.56,
      reasons: s1.relations[1].reasons,
    },
    {
      sourceId: s3.id,
      targetId: s4.id,
      score: 0.45,
      reasons: s3.relations[0].reasons,
    },
  ];

  const snapshot: SnapshotPayload = {
    seq: 1,
    generatedAt: new Date().toISOString(),
    uiLang: lang,
    scopes,
    folders,
    skills,
    analytics: {
      dailyCounts365: globalDaily,
      totalActivations: 76,
      last30dActivations: 39,
      idleSkillIds: [s5.id, s6.id],
      recentEvents: [
        { timestamp: daysAgo(0), source: 'read_file', conversationId: 'conv-9a14f0c2', skillKey: 'frontend-design-system', skillName: 'frontend-design-system', skillId: s1.id },
        { timestamp: daysAgo(0), source: 'read_file', conversationId: 'conv-9a14f0c2', skillKey: 'playwright-e2e-runner', skillName: 'playwright-e2e-runner', skillId: s2.id },
        { timestamp: daysAgo(1), source: 'panel_attach', conversationId: 'panel-context', skillKey: 'release-notes-bot', skillName: 'release-notes-bot', skillId: s3.id },
        { timestamp: daysAgo(2), source: 'slash_command', conversationId: 'conv-5c11a890', skillKey: 'mcp-app-development', skillName: 'mcp-app-development', skillId: s7.id },
        { timestamp: daysAgo(4), source: 'mention', conversationId: 'conv-31f009b1', skillKey: 'mcp-plugin-packager', skillName: 'mcp-plugin-packager', skillId: s4.id },
      ],
    },
    graphEdges,
  };

  return { snapshot, details };
}
