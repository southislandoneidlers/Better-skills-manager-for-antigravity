import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  AttachmentFile,
  CategoryNode,
  GraphEdge,
  GlobalAnalyticsSummary,
  ScopeInfo,
  ScopeKind,
  SkillDetail,
  SkillRelation,
  SkillSourceMeta,
  SkillSummary,
  SnapshotPayload,
  UiLang,
} from '../shared/types.ts';
import {
  parseSkillMarkdown,
  readFrontmatterString,
  serializeSkillMarkdown,
  slugifySkillName,
} from './frontmatter.ts';
import { analyzeSkillRelationships, type SkillRelInput } from './relationshipAnalyzer.ts';
import { syncSkillsJsonForScope } from './skillsJsonSync.ts';
import {
  applySkillUpdate,
  bindSkillSource,
  checkSkillUpdate,
  computeDirFingerprint,
  resolveSkillLifecycleMeta,
  writeSourceMetaFile,
} from './updateChecker.ts';
import { UsageAnalyticsEngine } from './usageAnalytics.ts';
import { defaultAttachmentStub, validateSkillBundle } from './validator.ts';

export interface CustomScopeRecord {
  id: string;
  label: string;
  kind: 'workspace' | 'external';
  rootDir: string;
  skillsDir: string;
}

export interface SkillStoreOptions {
  homeDir?: string;
  globalConfigDir?: string;
  appDataDir?: string;
  pluginDataDir?: string;
  builtinSkillsDir?: string;
  scratchRootDir?: string;
  extraScopes?: CustomScopeRecord[];
  enableWatcher?: boolean;
}

interface InternalSkillRecord {
  summary: SkillSummary;
  detailTextForRel: string;
  body: string;
  rawContent: string;
  version?: string;
  repository?: string;
  extraFrontmatterKeys: string[];
  yamlError?: string;
  attachments: AttachmentFile[];
}

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.wasm', '.exe', '.bin',
]);

function isBinaryFilename(name: string, buf?: Buffer): boolean {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (BINARY_EXTS.has(ext)) return true;
  if (buf) {
    const sample = buf.subarray(0, Math.min(buf.length, 512));
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
  }
  return false;
}

function resolveInside(rootDir: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  const abs = resolve(rootDir, clean);
  const rel = relative(resolve(rootDir), abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路徑不合法（不可超出 Skill 目錄）：${relPath}`);
  }
  return abs;
}

function encodeSkillId(scopeId: string, enabled: boolean, relDir: string): string {
  return `${scopeId}::${enabled ? 'active' : 'disabled'}::${relDir}`;
}

function cleanupEmptyParentDirs(dir: string, stopAtDir: string): void {
  let curr = resolve(dir);
  const stop = resolve(stopAtDir);
  while (curr !== stop && curr.startsWith(stop)) {
    try {
      const entries = readdirSync(curr).filter((e) => e !== '.DS_Store');
      if (entries.length === 0) {
        rmSync(curr, { recursive: true, force: true });
        curr = dirname(curr);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

export class SkillStore {
  private readonly homeDir: string;
  private readonly globalConfigDir: string;
  private readonly appDataDir: string;
  private readonly pluginDataDir: string;
  private readonly builtinSkillsDir: string;
  private readonly scratchRootDir: string;
  private readonly scopesFile: string;
  private readonly prefsFile: string;
  private readonly extraScopes: CustomScopeRecord[];
  private readonly usageEngine: UsageAnalyticsEngine;
  private readonly enableWatcher: boolean;

  private watchers = new Map<string, FSWatcher>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private changeSeq = 1;
  private cachedSnapshot: SnapshotPayload | null = null;
  private cachedDetails = new Map<string, SkillDetail>();
  private cachedScopeList: ScopeInfo[] = [];

  constructor(options: SkillStoreOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    this.globalConfigDir = options.globalConfigDir ?? join(this.homeDir, '.gemini', 'config');
    this.appDataDir = options.appDataDir ?? join(this.homeDir, '.gemini', 'antigravity');
    this.pluginDataDir =
      options.pluginDataDir ?? join(this.appDataDir, 'plugin_data', 'skill-docs');
    this.builtinSkillsDir =
      options.builtinSkillsDir ?? join(this.appDataDir, 'builtin', 'skills');
    this.scratchRootDir =
      options.scratchRootDir ?? join(this.appDataDir, 'scratch');
    this.scopesFile = join(this.pluginDataDir, 'scopes.json');
    this.prefsFile = join(this.pluginDataDir, 'preferences.json');
    this.extraScopes = options.extraScopes ?? [];
    this.enableWatcher = options.enableWatcher ?? true;
    this.usageEngine = new UsageAnalyticsEngine(this.appDataDir, this.pluginDataDir);
  }

  getChangeSeq(): number {
    return this.changeSeq;
  }

  bumpSeq(): void {
    this.changeSeq += 1;
    this.cachedSnapshot = null;
  }

  getUiLang(): UiLang | undefined {
    if (!existsSync(this.prefsFile)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(this.prefsFile, 'utf-8')) as { uiLang?: string };
      if (parsed.uiLang === 'en' || parsed.uiLang === 'zh-TW') return parsed.uiLang;
    } catch {
      // ignore
    }
    return undefined;
  }

  setUiLang(uiLang: UiLang): UiLang {
    mkdirSync(this.pluginDataDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    if (existsSync(this.prefsFile)) {
      try {
        existing = JSON.parse(readFileSync(this.prefsFile, 'utf-8')) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }
    existing.uiLang = uiLang;
    writeFileSync(this.prefsFile, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    this.bumpSeq();
    return uiLang;
  }

  private loadCustomScopes(): CustomScopeRecord[] {
    if (!existsSync(this.scopesFile)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.scopesFile, 'utf-8'));
      return Array.isArray(parsed) ? (parsed as CustomScopeRecord[]) : [];
    } catch {
      return [];
    }
  }

  private saveCustomScopes(records: CustomScopeRecord[]): void {
    mkdirSync(this.pluginDataDir, { recursive: true });
    writeFileSync(this.scopesFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');
  }

  private discoverScopes(): ScopeInfo[] {
    const scopes: ScopeInfo[] = [];
    const seenIds = new Set<string>();

    const addScope = (s: Omit<ScopeInfo, 'exists' | 'skillCount'>) => {
      if (seenIds.has(s.id)) return;
      seenIds.add(s.id);
      scopes.push({
        ...s,
        exists: existsSync(s.skillsDir),
        skillCount: 0,
      });
    };

    // 1. Global Antigravity skills
    addScope({
      id: 'global',
      label: '全域技能庫 (~/.gemini/config)',
      kind: 'global',
      rootDir: this.globalConfigDir,
      skillsDir: join(this.globalConfigDir, 'skills'),
      readOnly: false,
    });

    // 2. Scratch workspaces that have .agents/skills or .agents
    if (existsSync(this.scratchRootDir)) {
      try {
        for (const entry of readdirSync(this.scratchRootDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const projDir = join(this.scratchRootDir, entry.name);
          const agentsDir = join(projDir, '.agents');
          const skillsDir = join(agentsDir, 'skills');
          if (existsSync(skillsDir) || existsSync(agentsDir)) {
            addScope({
              id: `ws-${slugifySkillName(entry.name)}`,
              label: `專案：${entry.name}`,
              kind: 'workspace',
              rootDir: agentsDir,
              skillsDir,
              readOnly: false,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. User-added workspaces & external directories
    for (const custom of [...this.extraScopes, ...this.loadCustomScopes()]) {
      addScope({
        id: custom.id,
        label: custom.label,
        kind: custom.kind,
        rootDir: custom.rootDir,
        skillsDir: custom.skillsDir,
        readOnly: false,
        customAdded: true,
      });
    }

    // 4. Common universal directories if present (~/.agents/skills, ~/.claude/skills)
    const agentsUniversal = join(this.homeDir, '.agents', 'skills');
    if (existsSync(agentsUniversal)) {
      addScope({
        id: 'ext-agents',
        label: '通用目錄 (~/.agents/skills)',
        kind: 'external',
        rootDir: dirname(agentsUniversal),
        skillsDir: agentsUniversal,
        readOnly: false,
      });
    }
    const claudeDir = join(this.homeDir, '.claude', 'skills');
    if (existsSync(claudeDir)) {
      addScope({
        id: 'ext-claude',
        label: 'Claude Code (~/.claude/skills)',
        kind: 'external',
        rootDir: dirname(claudeDir),
        skillsDir: claudeDir,
        readOnly: false,
      });
    }

    // 5. Builtin reference skills (read-only)
    if (existsSync(this.builtinSkillsDir)) {
      addScope({
        id: 'builtin',
        label: '內建技能 (唯讀參考)',
        kind: 'builtin',
        rootDir: this.builtinSkillsDir,
        skillsDir: this.builtinSkillsDir,
        readOnly: true,
      });
    }

    return scopes;
  }

  private ensureWatchers(scopes: ScopeInfo[]): void {
    if (!this.enableWatcher) return;
    const wantedDirs = new Set<string>();
    for (const sc of scopes) {
      if (sc.readOnly) continue;
      if (existsSync(sc.skillsDir)) {
        wantedDirs.add(sc.skillsDir);
      } else if (existsSync(sc.rootDir)) {
        wantedDirs.add(sc.rootDir);
      }
    }

    // Close obsolete watchers
    for (const [dir, w] of this.watchers) {
      if (!wantedDirs.has(dir)) {
        w.close();
        this.watchers.delete(dir);
      }
    }

    for (const dir of wantedDirs) {
      if (this.watchers.has(dir)) continue;
      try {
        const w = watch(dir, { recursive: true }, (_eventType, filename) => {
          if (filename && (filename.endsWith('skills.json') || filename.endsWith('.DS_Store'))) {
            return;
          }
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            this.reconcileAllSkillsJson(scopes);
            this.bumpSeq();
          }, 250);
        });
        this.watchers.set(dir, w);
      } catch {
        // Fallback if recursive watch isn't supported
      }
    }
  }

  private reconcileAllSkillsJson(scopes: ScopeInfo[]): void {
    for (const sc of scopes) {
      if (sc.kind === 'global' || sc.kind === 'workspace') {
        if (existsSync(sc.skillsDir)) {
          syncSkillsJsonForScope(sc.rootDir, sc.skillsDir, sc.kind);
        }
      }
    }
  }

  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const [, w] of this.watchers) {
      w.close();
    }
    this.watchers.clear();
  }

  private collectAttachments(skillDir: string): { attachments: AttachmentFile[]; textForRel: string } {
    const attachments: AttachmentFile[] = [];
    const textChunks: string[] = [];

    function walk(curr: string): void {
      let entries;
      try {
        entries = readdirSync(curr, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (
          entry.name === '.DS_Store' ||
          entry.name === '.git' ||
          entry.name === 'node_modules' ||
          entry.name === '.skill-source.json'
        ) {
          continue;
        }
        const full = join(curr, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const relPath = relative(skillDir, full).split('\\').join('/');
        if (relPath === 'SKILL.md') continue;

        let size = 0;
        let executable = false;
        let binary = isBinaryFilename(entry.name);
        try {
          const st = statSync(full);
          size = st.size;
          executable = (st.mode & 0o111) !== 0;
          if (!binary && size <= 128 * 1024) {
            const buf = readFileSync(full);
            binary = isBinaryFilename(entry.name, buf);
            if (!binary) {
              textChunks.push(buf.toString('utf-8'));
            }
          }
        } catch {
          // ignore
        }

        const slashIdx = relPath.indexOf('/');
        const folder = slashIdx >= 0 ? relPath.slice(0, slashIdx) : '(根目錄)';
        attachments.push({
          relPath,
          name: entry.name,
          folder,
          size,
          isBinary: binary,
          executable,
        });
      }
    }

    walk(skillDir);
    return { attachments, textForRel: textChunks.join('\n') };
  }

  private scanScopeTree(scope: ScopeInfo): {
    folders: CategoryNode[];
    rawSkills: Array<{
      id: string;
      dirName: string;
      scope: ScopeInfo;
      enabled: boolean;
      categoryPath: string;
      skillDir: string;
      skillMdPath: string;
      rawContent: string;
    }>;
  } {
    const folders: CategoryNode[] = [];
    const rawSkills: Array<{
      id: string;
      dirName: string;
      scope: ScopeInfo;
      enabled: boolean;
      categoryPath: string;
      skillDir: string;
      skillMdPath: string;
      rawContent: string;
    }> = [];

    if (!existsSync(scope.skillsDir)) {
      return { folders, rawSkills };
    }

    const walkActive = (currDir: string, relCat: string): CategoryNode[] => {
      let entries;
      try {
        entries = readdirSync(currDir, { withFileTypes: true });
      } catch {
        return [];
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const nodes: CategoryNode[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

        const fullDir = join(currDir, entry.name);
        const skillMdPath = join(fullDir, 'SKILL.md');
        if (existsSync(skillMdPath)) {
          let rawContent = '';
          try {
            rawContent = readFileSync(skillMdPath, 'utf-8');
          } catch {
            rawContent = '';
          }
          const relDir = relCat ? `${relCat}/${entry.name}` : entry.name;
          rawSkills.push({
            id: encodeSkillId(scope.id, true, relDir),
            dirName: entry.name,
            scope,
            enabled: true,
            categoryPath: relCat,
            skillDir: fullDir,
            skillMdPath,
            rawContent,
          });
          continue;
        }

        const nextCat = relCat ? `${relCat}/${entry.name}` : entry.name;
        const children = walkActive(fullDir, nextCat);
        nodes.push({
          id: `${scope.id}::folder::${nextCat}`,
          name: entry.name,
          path: nextCat,
          scopeId: scope.id,
          children,
          skillCount: 0, // computed after
        });
      }
      return nodes;
    };

    const walkDisabled = (currDir: string, relCat: string): void => {
      let entries;
      try {
        entries = readdirSync(currDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.')) continue;

        const fullDir = join(currDir, entry.name);
        const skillMdPath = join(fullDir, 'SKILL.md');
        if (existsSync(skillMdPath)) {
          let rawContent = '';
          try {
            rawContent = readFileSync(skillMdPath, 'utf-8');
          } catch {
            rawContent = '';
          }
          const relDir = relCat ? `${relCat}/${entry.name}` : entry.name;
          rawSkills.push({
            id: encodeSkillId(scope.id, false, relDir),
            dirName: entry.name,
            scope,
            enabled: false,
            categoryPath: relCat,
            skillDir: fullDir,
            skillMdPath,
            rawContent,
          });
          continue;
        }
        const nextCat = relCat ? `${relCat}/${entry.name}` : entry.name;
        walkDisabled(fullDir, nextCat);
      }
    };

    const treeNodes = walkActive(scope.skillsDir, '');
    const disabledRoot = join(scope.skillsDir, '_disabled');
    if (existsSync(disabledRoot)) {
      walkDisabled(disabledRoot, '');
    }

    const computeFolderCounts = (node: CategoryNode): number => {
      const direct = rawSkills.filter(
        (s) => s.enabled && s.categoryPath === node.path,
      ).length;
      let nested = 0;
      for (const child of node.children) {
        nested += computeFolderCounts(child);
      }
      node.skillCount = direct + nested;
      return node.skillCount;
    };
    for (const n of treeNodes) computeFolderCounts(n);

    return { folders: treeNodes, rawSkills };
  }

  async getSnapshot(forceRefresh = false): Promise<SnapshotPayload> {
    if (this.cachedSnapshot && !forceRefresh) {
      return this.cachedSnapshot;
    }

    const scopes = this.discoverScopes();
    this.cachedScopeList = scopes;
    this.reconcileAllSkillsJson(scopes);
    this.ensureWatchers(scopes);

    const allFolders: CategoryNode[] = [];
    const collectedRaw: Array<{
      id: string;
      dirName: string;
      scope: ScopeInfo;
      enabled: boolean;
      categoryPath: string;
      skillDir: string;
      skillMdPath: string;
      rawContent: string;
    }> = [];

    for (const sc of scopes) {
      const { folders, rawSkills } = this.scanScopeTree(sc);
      sc.skillCount = rawSkills.length;
      allFolders.push(...folders);
      collectedRaw.push(...rawSkills);
    }

    // Build active name collision map
    const activeSkillNamesMap = new Map<string, string[]>();
    const parsedCache = new Map<string, ReturnType<typeof parseSkillMarkdown>>();
    for (const item of collectedRaw) {
      const parsed = parseSkillMarkdown(item.rawContent);
      parsedCache.set(item.id, parsed);
      const fmName = readFrontmatterString(parsed.frontmatter, 'name') || item.dirName;
      if (item.enabled && fmName) {
        const list = activeSkillNamesMap.get(fmName) ?? [];
        list.push(item.id);
        activeSkillNamesMap.set(fmName, list);
      }
    }

    // Usage analytics
    const usageInput = collectedRaw.map((item) => {
      const parsed = parsedCache.get(item.id)!;
      return {
        id: item.id,
        name: readFrontmatterString(parsed.frontmatter, 'name') || item.dirName,
        dirName: item.dirName,
      };
    });
    const { bySkillId, coUsageByConversation, globalSummary } = this.usageEngine.collect(usageInput);

    // Build records with validation, lifecycle dates & attachments
    const internalRecords: InternalSkillRecord[] = [];
    const relInputs: SkillRelInput[] = [];

    for (const item of collectedRaw) {
      const parsed = parsedCache.get(item.id)!;
      const val = validateSkillBundle({
        skillId: item.id,
        skillDir: item.skillDir,
        rawContent: item.rawContent,
        enabled: item.enabled,
        activeSkillNamesMap,
      });

      const { attachments, textForRel } = this.collectAttachments(item.skillDir);
      const lifecycle = await resolveSkillLifecycleMeta(
        item.skillDir,
        item.rawContent,
        item.scope.kind === 'builtin',
      );

      const usage = bySkillId.get(item.id) ?? {
        totalUses: 0,
        last30dUses: 0,
        idleDays: null,
        dailyCounts365: {},
        recentEvents: [],
      };

      const displayName = val.name || item.dirName;
      const extraKeys = Object.keys(parsed.frontmatter).filter(
        (k) => k !== 'name' && k !== 'description' && k !== 'version' && k !== 'repository' && k !== 'published_at',
      );

      const summary: SkillSummary = {
        id: item.id,
        dirName: item.dirName,
        name: displayName,
        description: val.description,
        scopeId: item.scope.id,
        scopeLabel: item.scope.label,
        scopeKind: item.scope.kind,
        readOnly: item.scope.readOnly,
        enabled: item.enabled,
        categoryPath: item.categoryPath,
        skillDir: item.skillDir,
        skillMdPath: item.skillMdPath,
        attachmentCount: attachments.length,
        validationStatus: val.status,
        issues: val.issues,
        installedAt: lifecycle.installedAt,
        publishedAt: lifecycle.publishedAt,
        sourceMeta: lifecycle.sourceMeta,
        totalUses: usage.totalUses,
        last30dUses: usage.last30dUses,
        lastUsedAt: usage.lastUsedAt,
        idleDays: usage.idleDays,
        relationCount: 0,
        hasOverlapWarning: false,
      };

      internalRecords.push({
        summary,
        detailTextForRel: `${parsed.body}\n${textForRel}`,
        body: parsed.body,
        rawContent: item.rawContent,
        version: readFrontmatterString(parsed.frontmatter, 'version') || undefined,
        repository: readFrontmatterString(parsed.frontmatter, 'repository') || undefined,
        extraFrontmatterKeys: extraKeys,
        yamlError: val.yamlError,
        attachments,
      });

      relInputs.push({
        id: item.id,
        name: displayName,
        dirName: item.dirName,
        scopeId: item.scope.id,
        scopeLabel: item.scope.label,
        description: val.description,
        bodyAndScriptsText: `${parsed.body}\n${textForRel}`,
      });
    }

    const { relationsBySkillId, graphEdges } = analyzeSkillRelationships(
      relInputs,
      coUsageByConversation,
    );

    const nextDetails = new Map<string, SkillDetail>();
    const summaries: SkillSummary[] = [];

    for (const rec of internalRecords) {
      const relations = relationsBySkillId.get(rec.summary.id) ?? [];
      rec.summary.relationCount = relations.length;
      rec.summary.hasOverlapWarning = relations.some((r) =>
        r.reasons.some((reason) => reason.type === 'high_similarity'),
      );
      summaries.push(rec.summary);

      const usage = bySkillId.get(rec.summary.id) ?? {
        totalUses: 0,
        last30dUses: 0,
        idleDays: null,
        dailyCounts365: {},
        recentEvents: [],
      };

      nextDetails.set(rec.summary.id, {
        ...rec.summary,
        version: rec.version,
        repository: rec.repository,
        body: rec.body,
        rawContent: rec.rawContent,
        extraFrontmatterKeys: rec.extraFrontmatterKeys,
        yamlError: rec.yamlError,
        attachments: rec.attachments,
        usage,
        relations,
      });
    }

    this.cachedDetails = nextDetails;
    const payload: SnapshotPayload = {
      seq: this.changeSeq,
      generatedAt: new Date().toISOString(),
      uiLang: this.getUiLang(),
      scopes,
      folders: allFolders,
      skills: summaries,
      analytics: globalSummary,
      graphEdges,
    };
    this.cachedSnapshot = payload;
    return payload;
  }

  async getSkillDetail(id: string): Promise<SkillDetail> {
    if (!this.cachedSnapshot) {
      await this.getSnapshot();
    }
    const detail = this.cachedDetails.get(id);
    if (!detail) {
      throw new Error(`找不到 Skill：${id}`);
    }
    return detail;
  }

  private assertWritable(detail: SkillDetail): void {
    if (detail.readOnly) {
      throw new Error('內建技能為唯讀參考，請先「複製到全域或專案」後再編輯');
    }
  }

  private findScope(scopeId: string): ScopeInfo {
    const scopes = this.cachedScopeList.length > 0 ? this.cachedScopeList : this.discoverScopes();
    const sc = scopes.find((s) => s.id === scopeId);
    if (!sc) throw new Error(`找不到範圍：${scopeId}`);
    return sc;
  }

  async saveSkill(params: {
    id: string;
    mode: 'structured' | 'raw';
    name?: string;
    description?: string;
    version?: string;
    repository?: string;
    body?: string;
    rawContent?: string;
  }): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(params.id);
    this.assertWritable(detail);

    const currentRawOnDisk = existsSync(detail.skillMdPath)
      ? readFileSync(detail.skillMdPath, 'utf-8')
      : detail.rawContent;
    const currentParsed = parseSkillMarkdown(currentRawOnDisk);

    let nextRaw = '';
    if (params.mode === 'raw') {
      nextRaw = params.rawContent ?? currentRawOnDisk;
    } else {
      nextRaw = serializeSkillMarkdown(
        {
          name: (params.name ?? (readFrontmatterString(currentParsed.frontmatter, 'name') || detail.name)).trim(),
          description: params.description ?? readFrontmatterString(currentParsed.frontmatter, 'description'),
          version: params.version ?? (readFrontmatterString(currentParsed.frontmatter, 'version') || undefined),
          repository: params.repository ?? (readFrontmatterString(currentParsed.frontmatter, 'repository') || undefined),
        },
        params.body ?? currentParsed.body,
        currentRawOnDisk,
      );
    }

    writeFileSync(detail.skillMdPath, nextRaw, 'utf-8');
    this.bumpSeq();
    await this.getSnapshot(true);
    return this.getSkillDetail(params.id);
  }

  async createSkill(params: {
    scopeId: string;
    categoryPath?: string;
    name: string;
    description: string;
    template?: 'blank' | 'script-workflow' | 'reference-guide';
  }): Promise<SkillDetail> {
    const scope = this.findScope(params.scopeId);
    if (scope.readOnly) {
      throw new Error('無法在唯讀的內建目錄建立新 Skill，請選擇全域或專案範圍');
    }
    const slug = slugifySkillName(params.name);
    const cat = (params.categoryPath ?? '').replace(/^\/+|\/+$/g, '');
    const targetParent = cat ? resolveInside(scope.skillsDir, cat) : scope.skillsDir;
    const skillDir = join(targetParent, slug);
    if (existsSync(skillDir)) {
      throw new Error(`目錄已存在：${cat ? `${cat}/` : ''}${slug}`);
    }

    mkdirSync(skillDir, { recursive: true });
    let body = `# ${params.name.trim() || slug}\n\n在此撰寫詳細操作步驟與指引。\n`;

    if (params.template === 'script-workflow') {
      mkdirSync(join(skillDir, 'scripts'), { recursive: true });
      const scriptPath = join(skillDir, 'scripts', 'run.sh');
      writeFileSync(
        scriptPath,
        `#!/usr/bin/env bash\nset -euo pipefail\n\necho "Executing ${slug}"\n`,
        'utf-8',
      );
      chmodSync(scriptPath, 0o755);
      body = `# ${params.name.trim() || slug}\n\n## 執行步驟\n\n1. 執行自動化腳本：[run.sh](./scripts/run.sh)\n2. 確認輸出結果無誤。\n`;
    } else if (params.template === 'reference-guide') {
      mkdirSync(join(skillDir, 'references'), { recursive: true });
      writeFileSync(
        join(skillDir, 'references', 'guide.md'),
        `# ${slug} 參考手冊\n\n在此補充規範細節或範例。\n`,
        'utf-8',
      );
      body = `# ${params.name.trim() || slug}\n\n## 參考文件\n\n- 詳細規範請參閱 [guide.md](./references/guide.md)\n`;
    }

    const now = new Date().toISOString();
    const content = serializeSkillMarkdown(
      {
        name: slug,
        description: params.description.trim() || `當使用者需要處理 ${slug} 相關工作時啟用此 Skill。`,
        publishedAt: now.slice(0, 10),
      },
      body,
    );
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
    writeSourceMetaFile(skillDir, {
      sourceType: 'local_original',
      installedAt: now,
      publishedAt: now,
      hasUpdate: false,
      checkStatus: 'local_original',
      checkMessage: '本機原創（可綁定遠端或來源目錄以追蹤更新）',
    });

    if (scope.kind === 'global' || scope.kind === 'workspace') {
      syncSkillsJsonForScope(scope.rootDir, scope.skillsDir, scope.kind);
    }

    this.bumpSeq();
    await this.getSnapshot(true);
    const relDir = cat ? `${cat}/${slug}` : slug;
    return this.getSkillDetail(encodeSkillId(scope.id, true, relDir));
  }

  async moveOrCopySkill(params: {
    id: string;
    targetScopeId?: string;
    targetCategoryPath: string;
    copy?: boolean;
  }): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(params.id);
    const destScope = this.findScope(params.targetScopeId || detail.scopeId);
    if (destScope.readOnly) {
      throw new Error('無法移動或複製至唯讀內建目錄');
    }

    const cleanCat = params.targetCategoryPath.replace(/^\/+|\/+$/g, '');
    const isCopy = Boolean(params.copy || destScope.id !== detail.scopeId);

    if (!isCopy) {
      this.assertWritable(detail);
      const baseRoot = detail.enabled
        ? destScope.skillsDir
        : join(destScope.skillsDir, '_disabled');
      const targetParent = cleanCat ? resolveInside(baseRoot, cleanCat) : baseRoot;
      const destDir = join(targetParent, detail.dirName);
      if (resolve(destDir) === resolve(detail.skillDir)) {
        return detail;
      }
      if (existsSync(destDir)) {
        throw new Error(`目標位置已存在同名目錄：${cleanCat ? `${cleanCat}/` : ''}${detail.dirName}`);
      }
      const oldParent = dirname(detail.skillDir);
      mkdirSync(targetParent, { recursive: true });
      renameSync(detail.skillDir, destDir);
      cleanupEmptyParentDirs(
        oldParent,
        detail.enabled ? destScope.skillsDir : join(destScope.skillsDir, '_disabled'),
      );

      if (destScope.kind === 'global' || destScope.kind === 'workspace') {
        syncSkillsJsonForScope(destScope.rootDir, destScope.skillsDir, destScope.kind);
      }

      this.bumpSeq();
      await this.getSnapshot(true);
      const relDir = cleanCat ? `${cleanCat}/${detail.dirName}` : detail.dirName;
      return this.getSkillDetail(encodeSkillId(destScope.id, detail.enabled, relDir));
    }

    // Copy to target scope/category and record local_dir source so updates can be tracked!
    const targetParent = cleanCat
      ? resolveInside(destScope.skillsDir, cleanCat)
      : destScope.skillsDir;
    let destName = detail.dirName;
    if (existsSync(join(targetParent, destName))) {
      destName = `${detail.dirName}-copy`;
      let idx = 2;
      while (existsSync(join(targetParent, destName))) {
        destName = `${detail.dirName}-copy-${idx++}`;
      }
    }
    const destDir = join(targetParent, destName);
    mkdirSync(targetParent, { recursive: true });
    cpSync(detail.skillDir, destDir, { recursive: true });

    const now = new Date().toISOString();
    const fingerprint = computeDirFingerprint(destDir);
    const sourceMeta: SkillSourceMeta = {
      sourceType: 'local_dir',
      sourceDir: detail.skillDir,
      installedAt: now,
      publishedAt: detail.publishedAt,
      lastSyncedHash: fingerprint,
      remoteLatestHash: fingerprint,
      lastCheckedAt: now,
      hasUpdate: false,
      checkStatus: 'up_to_date',
      checkMessage: `來源複製自「${detail.scopeLabel}」`,
    };
    writeSourceMetaFile(destDir, sourceMeta);

    if (destScope.kind === 'global' || destScope.kind === 'workspace') {
      syncSkillsJsonForScope(destScope.rootDir, destScope.skillsDir, destScope.kind);
    }

    this.bumpSeq();
    await this.getSnapshot(true);
    const relDir = cleanCat ? `${cleanCat}/${destName}` : destName;
    return this.getSkillDetail(encodeSkillId(destScope.id, true, relDir));
  }

  async toggleSkill(id: string, enabled: boolean): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(id);
    this.assertWritable(detail);
    if (detail.enabled === enabled) return detail;

    const scope = this.findScope(detail.scopeId);
    const cat = detail.categoryPath;
    const targetBase = enabled ? scope.skillsDir : join(scope.skillsDir, '_disabled');
    const targetParent = cat ? resolveInside(targetBase, cat) : targetBase;
    const destDir = join(targetParent, detail.dirName);
    if (existsSync(destDir)) {
      throw new Error(`無法切換狀態，目標目錄已存在：${destDir}`);
    }

    const oldParent = dirname(detail.skillDir);
    mkdirSync(targetParent, { recursive: true });
    renameSync(detail.skillDir, destDir);
    cleanupEmptyParentDirs(
      oldParent,
      detail.enabled ? scope.skillsDir : join(scope.skillsDir, '_disabled'),
    );

    if (scope.kind === 'global' || scope.kind === 'workspace') {
      syncSkillsJsonForScope(scope.rootDir, scope.skillsDir, scope.kind);
    }

    this.bumpSeq();
    await this.getSnapshot(true);
    const relDir = cat ? `${cat}/${detail.dirName}` : detail.dirName;
    return this.getSkillDetail(encodeSkillId(scope.id, enabled, relDir));
  }

  async deleteSkill(id: string): Promise<void> {
    const detail = await this.getSkillDetail(id);
    this.assertWritable(detail);
    const scope = this.findScope(detail.scopeId);
    const oldParent = dirname(detail.skillDir);
    rmSync(detail.skillDir, { recursive: true, force: true });
    cleanupEmptyParentDirs(
      oldParent,
      detail.enabled ? scope.skillsDir : join(scope.skillsDir, '_disabled'),
    );

    if (scope.kind === 'global' || scope.kind === 'workspace') {
      syncSkillsJsonForScope(scope.rootDir, scope.skillsDir, scope.kind);
    }
    this.bumpSeq();
    await this.getSnapshot(true);
  }

  async fixIssue(params: {
    id: string;
    action: 'create_attachment' | 'slugify_name';
    missingRelPath?: string;
  }): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(params.id);
    this.assertWritable(detail);

    if (params.action === 'slugify_name') {
      const nextName = slugifySkillName(detail.name || detail.dirName);
      return this.saveSkill({
        id: params.id,
        mode: 'structured',
        name: nextName,
      });
    }

    if (params.action === 'create_attachment') {
      const rel = (params.missingRelPath || '').replace(/^\.\//, '').trim();
      if (!rel) throw new Error('請指定要建立的附件相對路徑');
      const absTarget = resolveInside(detail.skillDir, rel);
      if (!existsSync(absTarget)) {
        mkdirSync(dirname(absTarget), { recursive: true });
        writeFileSync(absTarget, defaultAttachmentStub(rel), 'utf-8');
        if (rel.endsWith('.sh') || rel.endsWith('.py')) {
          chmodSync(absTarget, 0o755);
        }
      }
      this.bumpSeq();
      await this.getSnapshot(true);
      return this.getSkillDetail(params.id);
    }

    throw new Error(`未知修復動作：${params.action}`);
  }

  async manageFolder(params: {
    scopeId: string;
    action: 'create' | 'rename' | 'delete';
    folderPath: string;
    newName?: string;
  }): Promise<void> {
    const scope = this.findScope(params.scopeId);
    if (scope.readOnly) throw new Error('無法修改唯讀內建目錄的資料夾');
    const cleanPath = params.folderPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) throw new Error('請指定資料夾路徑');

    const absDir = resolveInside(scope.skillsDir, cleanPath);
    if (params.action === 'create') {
      mkdirSync(absDir, { recursive: true });
    } else if (params.action === 'rename') {
      if (!existsSync(absDir)) throw new Error(`找不到資料夾：${cleanPath}`);
      const nextName = (params.newName || '').trim().replace(/[/\\]/g, '-');
      if (!nextName) throw new Error('請提供新資料夾名稱');
      const destDir = join(dirname(absDir), nextName);
      if (existsSync(destDir)) throw new Error(`目標名稱已存在：${nextName}`);
      renameSync(absDir, destDir);
    } else if (params.action === 'delete') {
      if (!existsSync(absDir)) return;
      const children = readdirSync(absDir).filter((e) => e !== '.DS_Store');
      if (children.length > 0) {
        throw new Error('資料夾內仍有項目，請先移出裡面的 Skill 或子資料夾再刪除');
      }
      rmSync(absDir, { recursive: true, force: true });
    }

    if (scope.kind === 'global' || scope.kind === 'workspace') {
      syncSkillsJsonForScope(scope.rootDir, scope.skillsDir, scope.kind);
    }
    this.bumpSeq();
    await this.getSnapshot(true);
  }

  async readAttachment(id: string, relPath: string): Promise<{
    relPath: string;
    content: string;
    isBinary: boolean;
    size: number;
  }> {
    const detail = await this.getSkillDetail(id);
    const abs = resolveInside(detail.skillDir, relPath);
    if (!existsSync(abs)) throw new Error(`找不到附件：${relPath}`);
    const st = statSync(abs);
    const buf = readFileSync(abs);
    const binary = isBinaryFilename(basename(abs), buf);
    return {
      relPath,
      content: binary ? '' : buf.toString('utf-8'),
      isBinary: binary,
      size: st.size,
    };
  }

  async saveAttachment(id: string, relPath: string, content: string): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(id);
    this.assertWritable(detail);
    const cleanRel = relPath.replace(/^\.\//, '').trim();
    if (!cleanRel || cleanRel === 'SKILL.md') {
      throw new Error('不合法的附件路徑');
    }
    const abs = resolveInside(detail.skillDir, cleanRel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
    if (cleanRel.endsWith('.sh') || cleanRel.endsWith('.py')) {
      chmodSync(abs, 0o755);
    }
    this.bumpSeq();
    await this.getSnapshot(true);
    return this.getSkillDetail(id);
  }

  async deleteAttachment(id: string, relPath: string): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(id);
    this.assertWritable(detail);
    const cleanRel = relPath.replace(/^\.\//, '').trim();
    if (!cleanRel || cleanRel === 'SKILL.md') {
      throw new Error('無法刪除主文件 SKILL.md');
    }
    const abs = resolveInside(detail.skillDir, cleanRel);
    if (existsSync(abs)) {
      rmSync(abs, { force: true });
      cleanupEmptyParentDirs(dirname(abs), detail.skillDir);
    }
    this.bumpSeq();
    await this.getSnapshot(true);
    return this.getSkillDetail(id);
  }

  async bindSource(params: {
    id: string;
    sourceType: 'git' | 'local_dir' | 'local_original';
    location?: string;
  }): Promise<SkillDetail> {
    const detail = await this.getSkillDetail(params.id);
    this.assertWritable(detail);
    await bindSkillSource(detail.skillDir, detail.rawContent, {
      sourceType: params.sourceType,
      location: params.location,
    });
    this.bumpSeq();
    await this.getSnapshot(true);
    return this.getSkillDetail(params.id);
  }

  async checkUpdates(id?: string): Promise<{
    checkedCount: number;
    updatesAvailable: number;
    snapshot: SnapshotPayload;
  }> {
    const snap = await this.getSnapshot(true);
    const targets = id
      ? snap.skills.filter((s) => s.id === id)
      : snap.skills.filter((s) => !s.readOnly);

    let updatesAvailable = 0;
    for (const s of targets) {
      let raw = '';
      try {
        raw = readFileSync(s.skillMdPath, 'utf-8');
      } catch {
        raw = '';
      }
      const res = await checkSkillUpdate(s.skillDir, raw, s.readOnly);
      if (res.hasUpdate) updatesAvailable += 1;
    }

    this.bumpSeq();
    const updatedSnap = await this.getSnapshot(true);
    return {
      checkedCount: targets.length,
      updatesAvailable,
      snapshot: updatedSnap,
    };
  }

  async applyUpdate(id: string): Promise<{ detail: SkillDetail; backupPath: string }> {
    const detail = await this.getSkillDetail(id);
    this.assertWritable(detail);
    const scope = this.findScope(detail.scopeId);
    const backupRoot = join(scope.skillsDir, '_backups');
    const { backupPath } = await applySkillUpdate(detail.skillDir, detail.rawContent, backupRoot);

    if (scope.kind === 'global' || scope.kind === 'workspace') {
      syncSkillsJsonForScope(scope.rootDir, scope.skillsDir, scope.kind);
    }
    this.bumpSeq();
    await this.getSnapshot(true);
    return {
      detail: await this.getSkillDetail(id),
      backupPath,
    };
  }

  async manageScopes(params: {
    action: 'add_workspace' | 'add_external' | 'remove';
    path: string;
    label?: string;
  }): Promise<SnapshotPayload> {
    const existing = this.loadCustomScopes();
    if (params.action === 'remove') {
      const target = resolve(params.path);
      const filtered = existing.filter(
        (s) => resolve(s.skillsDir) !== target && resolve(s.rootDir) !== target && s.id !== params.path,
      );
      this.saveCustomScopes(filtered);
      this.bumpSeq();
      return this.getSnapshot(true);
    }

    const absInput = params.path.startsWith('~/')
      ? resolve(this.homeDir, params.path.slice(2))
      : resolve(params.path);

    if (!existsSync(absInput)) {
      throw new Error(`找不到指定目錄：${absInput}`);
    }

    if (params.action === 'add_workspace') {
      const agentsDir = basename(absInput) === '.agents' ? absInput : join(absInput, '.agents');
      const skillsDir = join(agentsDir, 'skills');
      mkdirSync(skillsDir, { recursive: true });
      const projName = basename(dirname(agentsDir));
      const id = `ws-custom-${slugifySkillName(projName)}`;
      if (!existing.some((e) => resolve(e.skillsDir) === resolve(skillsDir))) {
        existing.push({
          id,
          label: params.label?.trim() || `專案：${projName}`,
          kind: 'workspace',
          rootDir: agentsDir,
          skillsDir,
        });
        this.saveCustomScopes(existing);
      }
    } else if (params.action === 'add_external') {
      const id = `ext-custom-${slugifySkillName(basename(absInput))}`;
      if (!existing.some((e) => resolve(e.skillsDir) === resolve(absInput))) {
        existing.push({
          id,
          label: params.label?.trim() || `外部：${basename(absInput)}`,
          kind: 'external',
          rootDir: dirname(absInput),
          skillsDir: absInput,
        });
        this.saveCustomScopes(existing);
      }
    }

    this.bumpSeq();
    return this.getSnapshot(true);
  }

  async recordPanelAttach(ids: string[]): Promise<void> {
    const names: string[] = [];
    for (const id of ids) {
      try {
        const d = await this.getSkillDetail(id);
        names.push(d.name || d.dirName);
      } catch {
        // ignore missing
      }
    }
    this.usageEngine.recordPanelAttach(ids, names);
    this.bumpSeq();
  }

  revealInFinder(targetPath: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      if (!existsSync(targetPath)) {
        rejectPromise(new Error(`找不到路徑：${targetPath}`));
        return;
      }
      if (process.platform === 'darwin') {
        execFile('open', ['-R', targetPath], (err) => {
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      } else if (process.platform === 'win32') {
        execFile('explorer.exe', [`/select,${targetPath}`], (err) => {
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      } else {
        const dirToOpen = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
        execFile('xdg-open', [dirToOpen], (err) => {
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      }
    });
  }
}
