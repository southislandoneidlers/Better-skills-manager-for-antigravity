import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { SkillStore } from './skillStore.ts';

const APP_URI = 'ui://skill-docs/app.html';
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseCliFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function resolveAppHtmlPath(): string {
  const envPath = process.env.SKILL_DOCS_APP_HTML;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(__dirname, 'app.html'),
    join(__dirname, '..', 'dist', 'app.html'),
    resolve(process.cwd(), 'dist', 'app.html'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function textResult(text: string, structuredContent?: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

export function createSkillDocsServer(store: SkillStore): Server {
  const server = new Server(
    { name: 'skill-docs', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  const APP_ONLY_META = {
    ui: {
      visibility: ['app'],
    },
  };

  const TOOLS = [
    {
      name: 'open_skill_docs',
      title: 'Skill 文件庫',
      description:
        '開啟「Skill 文件庫（Skill Docs）」互動式管理面板，像管理一般文件一樣管理 Skills、分類資料夾、格式健檢、更新檢查、使用時間軸與多技能協作關聯。所有參數皆為選填。',
      inputSchema: {
        type: 'object',
        properties: {
          scopeId: { type: 'string', description: '預設選取的範圍 ID（例如 global）' },
          skillId: { type: 'string', description: '預設開啟的 Skill ID' },
          tab: {
            type: 'string',
            enum: ['finder', 'analytics', 'graph'],
            description: '預設開啟的分頁視圖',
          },
        },
      },
      _meta: {
        ui: {
          resourceUri: APP_URI,
          visibility: ['model', 'app'],
        },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: 'Skill 文件庫' },
            { type: 'global', title: 'Skill 文件庫' },
          ],
        },
      },
    },
    {
      name: 'list_managed_skills',
      title: '列出受管 Skills 摘要',
      description: '查詢本機全域、專案與通用目錄下的 Skills 狀態、格式健檢、30天使用次數與協作關聯摘要。',
      inputSchema: {
        type: 'object',
        properties: {
          scopeId: { type: 'string', description: '選填，僅列出特定範圍 ID' },
          includeBuiltin: { type: 'boolean', description: '是否包含唯讀內建技能（預設 false）' },
        },
      },
    },
    {
      name: 'app_get_snapshot',
      title: '取得完整文件庫快照',
      description: '讀取所有範圍、分類樹、Skill 文件摘要、使用時間軸與關聯圖（僅限 App 呼叫）。',
      inputSchema: {
        type: 'object',
        properties: {
          forceRefresh: { type: 'boolean' },
        },
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_poll_changes',
      title: '輪詢檔案系統變更',
      description: '檢查是否有來自 Finder 或外部編輯器的變更序號遞增（僅限 App 呼叫）。',
      inputSchema: {
        type: 'object',
        properties: {
          sinceSeq: { type: 'number' },
        },
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_get_skill_detail',
      title: '讀取單一 Skill 完整文件',
      description: '讀取單一 Skill 的完整內容、附件列表、健檢詳情、使用時間軸與協作關聯。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_save_skill',
      title: '儲存 Skill 文件',
      description: '儲存結構化欄位或原始 SKILL.md 內容。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mode: { type: 'string', enum: ['structured', 'raw'] },
          name: { type: 'string' },
          description: { type: 'string' },
          version: { type: 'string' },
          repository: { type: 'string' },
          body: { type: 'string' },
          rawContent: { type: 'string' },
        },
        required: ['id', 'mode'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_create_skill',
      title: '建立新 Skill 文件',
      description: '在指定範圍與分類資料夾建立新 Skill 文件。',
      inputSchema: {
        type: 'object',
        properties: {
          scopeId: { type: 'string' },
          categoryPath: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          template: { type: 'string', enum: ['blank', 'script-workflow', 'reference-guide'] },
        },
        required: ['scopeId', 'name', 'description'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_move_skill',
      title: '移動或複製 Skill 文件',
      description: '將 Skill 移動至其他分類資料夾，或跨範圍複製掛載。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          targetScopeId: { type: 'string' },
          targetCategoryPath: { type: 'string' },
          copy: { type: 'boolean' },
        },
        required: ['id', 'targetCategoryPath'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_toggle_skill',
      title: '啟用或停用 Skill',
      description: '切換 Skill 啟用/停用狀態（移入或移出 _disabled 封存夾）。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['id', 'enabled'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_delete_skill',
      title: '刪除 Skill 文件',
      description: '刪除指定 Skill 資料夾。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_fix_issue',
      title: '一鍵修復健檢問題',
      description: '自動建立缺失的附件檔案或修正命名格式。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string', enum: ['create_attachment', 'slugify_name'] },
          missingRelPath: { type: 'string' },
        },
        required: ['id', 'action'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_manage_folder',
      title: '管理分類資料夾',
      description: '建立、重新命名或刪除分類資料夾並同步 skills.json。',
      inputSchema: {
        type: 'object',
        properties: {
          scopeId: { type: 'string' },
          action: { type: 'string', enum: ['create', 'rename', 'delete'] },
          folderPath: { type: 'string' },
          newName: { type: 'string' },
        },
        required: ['scopeId', 'action', 'folderPath'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_read_attachment',
      title: '讀取附件檔案',
      description: '讀取 Skill 內部附件檔案內容。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          relPath: { type: 'string' },
        },
        required: ['id', 'relPath'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_save_attachment',
      title: '儲存或新增附件檔案',
      description: '寫入或建立 Skill 內部附件檔案（腳本、參考資料等）。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          relPath: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['id', 'relPath', 'content'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_delete_attachment',
      title: '刪除附件檔案',
      description: '刪除 Skill 內部指定附件檔案。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          relPath: { type: 'string' },
        },
        required: ['id', 'relPath'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_bind_source',
      title: '綁定更新來源',
      description: '為 Skill 綁定 Git/GitHub 遠端網址或本機來源目錄，或設為本機原創。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceType: { type: 'string', enum: ['git', 'local_dir', 'local_original'] },
          location: { type: 'string' },
        },
        required: ['id', 'sourceType'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_check_updates',
      title: '檢查 Skill 更新',
      description: '檢查單一或全部受管 Skill 是否有可用更新。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_apply_update',
      title: '套用 Skill 更新',
      description: '備份目前版本並從綁定的遠端或本機來源更新 Skill。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_manage_scopes',
      title: '管理納管專案或外部目錄',
      description: '新增或移除額外納管的專案 Workspace 或外部通用 Skill 資料夾。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add_workspace', 'add_external', 'remove'] },
          path: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['action', 'path'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_record_panel_attach',
      title: '記錄面板附加使用次數',
      description: '當使用者在面板將 Skill 附加至對話時寫入使用紀錄。',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['ids'],
      },
      _meta: APP_ONLY_META,
    },
    {
      name: 'app_reveal_in_finder',
      title: '在 Finder 中顯示',
      description: '呼叫 macOS Finder 開啟並選取指定檔案或資料夾。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      _meta: APP_ONLY_META,
    },
  ];

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: APP_URI,
        name: 'Skill 文件庫介面',
        description: '像管理一般文件一樣管理 Skills 的互動式面板',
        mimeType: RESOURCE_MIME_TYPE,
        _meta: {
          ui: {
            prefersBorder: false,
          },
        },
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== APP_URI) {
      throw new Error(`找不到資源：${request.params.uri}`);
    }
    const htmlPath = resolveAppHtmlPath();
    if (!existsSync(htmlPath)) {
      throw new Error(`找不到前端單檔建置產物：${htmlPath}`);
    }
    const html = readFileSync(htmlPath, 'utf-8');
    return {
      contents: [
        {
          uri: APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'open_skill_docs': {
          const snapshot = await store.getSnapshot();
          const userSkills = snapshot.skills.filter((s) => !s.readOnly);
          const issueCount = userSkills.filter((s) => s.validationStatus !== 'ok').length;
          return textResult(
            `已開啟「Skill 文件庫」：目前納管 ${userSkills.length} 份自訂／專案 Skill（另有 ${snapshot.skills.length - userSkills.length} 份內建參考），共 ${issueCount} 份待檢查項目。`,
            {
              initialScopeId: typeof args.scopeId === 'string' ? args.scopeId : undefined,
              initialSkillId: typeof args.skillId === 'string' ? args.skillId : undefined,
              initialTab: typeof args.tab === 'string' ? args.tab : 'finder',
              summary: {
                totalSkills: snapshot.skills.length,
                managedSkills: userSkills.length,
                issueCount,
                totalActivations: snapshot.analytics.totalActivations,
              },
            },
          );
        }

        case 'list_managed_skills': {
          const snapshot = await store.getSnapshot();
          const includeBuiltin = Boolean(args.includeBuiltin);
          const scopeFilter = typeof args.scopeId === 'string' ? args.scopeId : '';
          const filtered = snapshot.skills.filter((s) => {
            if (!includeBuiltin && s.readOnly) return false;
            if (scopeFilter && s.scopeId !== scopeFilter) return false;
            return true;
          });
          const lines = filtered.map(
            (s) =>
              `- ${s.name} [${s.scopeLabel}${s.categoryPath ? ` / ${s.categoryPath}` : ''}] (${s.enabled ? '啟用' : '停用'}, ${s.validationStatus}, 總使用 ${s.totalUses} / 30天 ${s.last30dUses})`,
          );
          return textResult(
            lines.length ? `受管 Skills 清單：\n${lines.join('\n')}` : '目前沒有符合條件的受管 Skills。',
            { skills: filtered, scopes: snapshot.scopes },
          );
        }

        case 'app_get_snapshot': {
          const snapshot = await store.getSnapshot(Boolean(args.forceRefresh));
          return textResult(`快照 seq=${snapshot.seq}`, { snapshot });
        }

        case 'app_poll_changes': {
          const sinceSeq = typeof args.sinceSeq === 'number' ? args.sinceSeq : 0;
          const seq = store.getChangeSeq();
          return textResult(`seq=${seq}`, { seq, changed: seq !== sinceSeq });
        }

        case 'app_get_skill_detail': {
          const detail = await store.getSkillDetail(String(args.id ?? ''));
          return textResult(`已讀取 ${detail.name}`, { detail });
        }

        case 'app_save_skill': {
          const detail = await store.saveSkill({
            id: String(args.id ?? ''),
            mode: args.mode === 'raw' ? 'raw' : 'structured',
            name: typeof args.name === 'string' ? args.name : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
            version: typeof args.version === 'string' ? args.version : undefined,
            repository: typeof args.repository === 'string' ? args.repository : undefined,
            body: typeof args.body === 'string' ? args.body : undefined,
            rawContent: typeof args.rawContent === 'string' ? args.rawContent : undefined,
          });
          const snapshot = await store.getSnapshot();
          return textResult(`已儲存 ${detail.name}`, { detail, snapshot });
        }

        case 'app_create_skill': {
          const detail = await store.createSkill({
            scopeId: String(args.scopeId ?? 'global'),
            categoryPath: typeof args.categoryPath === 'string' ? args.categoryPath : '',
            name: String(args.name ?? 'new-skill'),
            description: String(args.description ?? ''),
            template:
              args.template === 'script-workflow' || args.template === 'reference-guide'
                ? args.template
                : 'blank',
          });
          const snapshot = await store.getSnapshot();
          return textResult(`已建立 ${detail.name}`, { detail, snapshot });
        }

        case 'app_move_skill': {
          const detail = await store.moveOrCopySkill({
            id: String(args.id ?? ''),
            targetScopeId: typeof args.targetScopeId === 'string' ? args.targetScopeId : undefined,
            targetCategoryPath: String(args.targetCategoryPath ?? ''),
            copy: Boolean(args.copy),
          });
          const snapshot = await store.getSnapshot();
          return textResult(`已更新位置 ${detail.name}`, { detail, snapshot });
        }

        case 'app_toggle_skill': {
          const detail = await store.toggleSkill(String(args.id ?? ''), Boolean(args.enabled));
          const snapshot = await store.getSnapshot();
          return textResult(
            `${detail.name} 已${detail.enabled ? '啟用' : '停用封存'}`,
            { detail, snapshot },
          );
        }

        case 'app_delete_skill': {
          await store.deleteSkill(String(args.id ?? ''));
          const snapshot = await store.getSnapshot();
          return textResult('已刪除 Skill', { snapshot });
        }

        case 'app_fix_issue': {
          const detail = await store.fixIssue({
            id: String(args.id ?? ''),
            action: args.action === 'slugify_name' ? 'slugify_name' : 'create_attachment',
            missingRelPath:
              typeof args.missingRelPath === 'string' ? args.missingRelPath : undefined,
          });
          const snapshot = await store.getSnapshot();
          return textResult(`已完成修復：${detail.name}`, { detail, snapshot });
        }

        case 'app_manage_folder': {
          await store.manageFolder({
            scopeId: String(args.scopeId ?? ''),
            action:
              args.action === 'rename' || args.action === 'delete' ? args.action : 'create',
            folderPath: String(args.folderPath ?? ''),
            newName: typeof args.newName === 'string' ? args.newName : undefined,
          });
          const snapshot = await store.getSnapshot();
          return textResult('已更新分類資料夾', { snapshot });
        }

        case 'app_read_attachment': {
          const file = await store.readAttachment(
            String(args.id ?? ''),
            String(args.relPath ?? ''),
          );
          return textResult(`已讀取附件 ${file.relPath}`, { file });
        }

        case 'app_save_attachment': {
          const detail = await store.saveAttachment(
            String(args.id ?? ''),
            String(args.relPath ?? ''),
            String(args.content ?? ''),
          );
          const snapshot = await store.getSnapshot();
          return textResult(`已儲存附件 ${args.relPath}`, { detail, snapshot });
        }

        case 'app_delete_attachment': {
          const detail = await store.deleteAttachment(
            String(args.id ?? ''),
            String(args.relPath ?? ''),
          );
          const snapshot = await store.getSnapshot();
          return textResult(`已刪除附件 ${args.relPath}`, { detail, snapshot });
        }

        case 'app_bind_source': {
          const detail = await store.bindSource({
            id: String(args.id ?? ''),
            sourceType:
              args.sourceType === 'git' || args.sourceType === 'local_dir'
                ? args.sourceType
                : 'local_original',
            location: typeof args.location === 'string' ? args.location : undefined,
          });
          const snapshot = await store.getSnapshot();
          return textResult(`已更新來源綁定：${detail.name}`, { detail, snapshot });
        }

        case 'app_check_updates': {
          const result = await store.checkUpdates(
            typeof args.id === 'string' && args.id ? args.id : undefined,
          );
          return textResult(
            `已檢查 ${result.checkedCount} 份 Skills，發現 ${result.updatesAvailable} 份可用更新。`,
            result,
          );
        }

        case 'app_apply_update': {
          const { detail, backupPath } = await store.applyUpdate(String(args.id ?? ''));
          const snapshot = await store.getSnapshot();
          return textResult(
            `已更新 ${detail.name}（舊版已備份至 ${backupPath}）`,
            { detail, backupPath, snapshot },
          );
        }

        case 'app_manage_scopes': {
          const snapshot = await store.manageScopes({
            action:
              args.action === 'add_external' || args.action === 'remove'
                ? args.action
                : 'add_workspace',
            path: String(args.path ?? ''),
            label: typeof args.label === 'string' ? args.label : undefined,
          });
          return textResult('已更新納管目錄', { snapshot });
        }

        case 'app_record_panel_attach': {
          const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
          await store.recordPanelAttach(ids);
          const snapshot = await store.getSnapshot();
          return textResult('已記錄附加至對話的使用統計', { snapshot });
        }

        case 'app_reveal_in_finder': {
          await store.revealInFinder(String(args.path ?? ''));
          return textResult('已在 Finder 中顯示');
        }

        default:
          return textResult(`未知工具：${name}`, undefined, true);
      }
    } catch (err) {
      return textResult(
        err instanceof Error ? err.message : String(err),
        undefined,
        true,
      );
    }
  });

  return server;
}

async function main(): Promise<void> {
  const dataDir = parseCliFlag('data_dir');
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

// Only auto-start when executed directly as entrypoint
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error('[skill-docs] fatal error:', err);
    process.exit(1);
  });
}
