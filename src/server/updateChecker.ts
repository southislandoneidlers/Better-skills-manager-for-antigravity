import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  cpSync,
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
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { SkillSourceMeta } from '../shared/types.ts';
import { extractPublishedAtFromFrontmatter, parseSkillMarkdown, readFrontmatterString } from './frontmatter.ts';

const execFileAsync = promisify(execFile);
const SOURCE_META_FILE = '.skill-source.json';

function runCmd(cmd: string, args: string[], cwd?: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
}

export function computeDirFingerprint(dir: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];

  function walk(curr: string): void {
    let entries;
    try {
      entries = readdirSync(curr, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === SOURCE_META_FILE || entry.name === '.DS_Store' || entry.name === '.git') continue;
      const full = join(curr, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  walk(dir);
  files.sort();
  for (const f of files) {
    const rel = relative(dir, f).split('\\').join('/');
    hash.update(`FILE:${rel}\n`);
    try {
      hash.update(readFileSync(f));
    } catch {
      // ignore unreadable
    }
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function parseGitRemoteSpec(rawUrl: string): {
  repoUrl: string;
  branch?: string;
  subpath?: string;
} {
  const trimmed = rawUrl.trim();
  // Support GitHub tree URLs: https://github.com/owner/repo/tree/branch/path/to/skill
  const ghTree = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.*))?$/i.exec(trimmed);
  if (ghTree) {
    const [, owner, repo, branch, subpath] = ghTree;
    return {
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      branch,
      subpath: subpath ? subpath.replace(/\/+$/, '') : undefined,
    };
  }
  // Support file:// or local bare git repo paths or standard git URLs
  return { repoUrl: trimmed };
}

async function getGitCommitIsoDate(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await runCmd('git', ['log', '-1', '--format=%cI', '--', '.'], dir, 3000);
    const out = stdout.trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

async function getGitHeadSha(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await runCmd('git', ['rev-parse', 'HEAD'], dir, 3000);
    const out = stdout.trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function readSourceMetaFile(skillDir: string): Partial<SkillSourceMeta> | null {
  const metaPath = join(skillDir, SOURCE_META_FILE);
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<SkillSourceMeta>) : null;
  } catch {
    return null;
  }
}

export function writeSourceMetaFile(skillDir: string, meta: SkillSourceMeta): void {
  const metaPath = join(skillDir, SOURCE_META_FILE);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

export async function resolveSkillLifecycleMeta(
  skillDir: string,
  rawSkillMd: string,
  isBuiltin: boolean,
): Promise<{ installedAt: string; publishedAt: string; sourceMeta: SkillSourceMeta }> {
  const skillMdPath = join(skillDir, 'SKILL.md');
  let birthtimeIso = new Date().toISOString();
  let mtimeIso = birthtimeIso;
  try {
    const stDir = statSync(skillDir);
    const stMd = existsSync(skillMdPath) ? statSync(skillMdPath) : stDir;
    const birth = stDir.birthtimeMs > 0 ? stDir.birthtime : stDir.ctime;
    birthtimeIso = birth.toISOString();
    mtimeIso = stMd.mtime.toISOString();
  } catch {
    // fallback to now
  }

  const saved = readSourceMetaFile(skillDir);
  const parsed = parseSkillMarkdown(rawSkillMd);
  const fmPublished = extractPublishedAtFromFrontmatter(parsed.frontmatter);
  const fmRepo = readFrontmatterString(parsed.frontmatter, 'repository');

  const installedAt = saved?.installedAt || birthtimeIso;
  let publishedAt = fmPublished || saved?.publishedAt;
  if (!publishedAt) {
    const gitDate = await getGitCommitIsoDate(skillDir);
    publishedAt = gitDate || mtimeIso;
  }

  if (isBuiltin) {
    return {
      installedAt,
      publishedAt,
      sourceMeta: {
        sourceType: 'builtin',
        installedAt,
        publishedAt,
        checkStatus: 'builtin',
        checkMessage: 'Antigravity 內建技能（隨系統更新）',
      },
    };
  }

  let sourceType = saved?.sourceType;
  let sourceUrl = saved?.sourceUrl || fmRepo || undefined;
  let sourceBranch = saved?.sourceBranch;
  let sourceSubpath = saved?.sourceSubpath;

  if (!sourceType) {
    if (sourceUrl) {
      const spec = parseGitRemoteSpec(sourceUrl);
      sourceType = 'git';
      sourceUrl = spec.repoUrl;
      sourceBranch = sourceBranch || spec.branch;
      sourceSubpath = sourceSubpath || spec.subpath;
    } else if (saved?.sourceDir) {
      sourceType = 'local_dir';
    } else {
      sourceType = 'local_original';
    }
  }

  const sourceMeta: SkillSourceMeta = {
    sourceType,
    sourceUrl,
    sourceBranch,
    sourceSubpath,
    sourceDir: saved?.sourceDir,
    installedAt,
    publishedAt,
    lastSyncedHash: saved?.lastSyncedHash,
    lastCheckedAt: saved?.lastCheckedAt,
    remoteLatestHash: saved?.remoteLatestHash,
    hasUpdate: saved?.hasUpdate ?? false,
    checkStatus:
      saved?.checkStatus ??
      (sourceType === 'local_original' ? 'local_original' : 'unchecked'),
    checkMessage:
      saved?.checkMessage ??
      (sourceType === 'local_original'
        ? '本機原創（可綁定遠端或來源目錄以追蹤更新）'
        : undefined),
  };

  return { installedAt, publishedAt, sourceMeta };
}

export async function bindSkillSource(
  skillDir: string,
  rawSkillMd: string,
  opts: { sourceType: 'git' | 'local_dir' | 'local_original'; location?: string },
): Promise<SkillSourceMeta> {
  const current = await resolveSkillLifecycleMeta(skillDir, rawSkillMd, false);
  const now = new Date().toISOString();

  if (opts.sourceType === 'local_original') {
    const next: SkillSourceMeta = {
      sourceType: 'local_original',
      installedAt: current.installedAt,
      publishedAt: current.publishedAt,
      hasUpdate: false,
      checkStatus: 'local_original',
      checkMessage: '已解除來源綁定（本機原創）',
    };
    writeSourceMetaFile(skillDir, next);
    return next;
  }

  if (opts.sourceType === 'local_dir') {
    const dir = (opts.location || '').trim();
    if (!dir || !existsSync(dir)) {
      throw new Error(`找不到本機來源目錄：${dir}`);
    }
    const next: SkillSourceMeta = {
      sourceType: 'local_dir',
      sourceDir: dir,
      installedAt: current.installedAt,
      publishedAt: current.publishedAt,
      lastSyncedHash: computeDirFingerprint(skillDir),
      lastCheckedAt: now,
      checkStatus: 'unchecked',
      checkMessage: `已綁定本機來源：${dir}`,
    };
    writeSourceMetaFile(skillDir, next);
    return checkSkillUpdate(skillDir, rawSkillMd, false);
  }

  // Git URL
  const url = (opts.location || '').trim();
  if (!url) throw new Error('請輸入有效的 Git 或 GitHub 網址');
  const spec = parseGitRemoteSpec(url);
  const localSha = await getGitHeadSha(skillDir);
  const next: SkillSourceMeta = {
    sourceType: 'git',
    sourceUrl: spec.repoUrl,
    sourceBranch: spec.branch,
    sourceSubpath: spec.subpath,
    installedAt: current.installedAt,
    publishedAt: current.publishedAt,
    lastSyncedHash: current.sourceMeta.lastSyncedHash || localSha,
    lastCheckedAt: now,
    checkStatus: 'unchecked',
  };
  writeSourceMetaFile(skillDir, next);
  return checkSkillUpdate(skillDir, rawSkillMd, false);
}

export async function checkSkillUpdate(
  skillDir: string,
  rawSkillMd: string,
  isBuiltin: boolean,
): Promise<SkillSourceMeta> {
  const { installedAt, publishedAt, sourceMeta } = await resolveSkillLifecycleMeta(
    skillDir,
    rawSkillMd,
    isBuiltin,
  );
  const now = new Date().toISOString();

  if (isBuiltin) {
    return sourceMeta;
  }

  if (sourceMeta.sourceType === 'local_original') {
    const next: SkillSourceMeta = {
      ...sourceMeta,
      lastCheckedAt: now,
      hasUpdate: false,
      checkStatus: 'local_original',
      checkMessage: '本機原創（無外部上游來源）',
    };
    return next;
  }

  if (sourceMeta.sourceType === 'local_dir') {
    const srcDir = sourceMeta.sourceDir;
    if (!srcDir || !existsSync(srcDir)) {
      const next: SkillSourceMeta = {
        ...sourceMeta,
        lastCheckedAt: now,
        hasUpdate: false,
        checkStatus: 'error',
        checkMessage: `上游來源目錄已不存在：${srcDir ?? '(未設定)'}`,
      };
      writeSourceMetaFile(skillDir, next);
      return next;
    }
    const upstreamHash = computeDirFingerprint(srcDir);
    const localHash = computeDirFingerprint(skillDir);
    const hasUpdate = upstreamHash !== localHash;
    let upstreamPublished = publishedAt;
    try {
      const srcMd = join(srcDir, 'SKILL.md');
      if (existsSync(srcMd)) {
        upstreamPublished = statSync(srcMd).mtime.toISOString();
      }
    } catch {
      // ignore
    }

    const next: SkillSourceMeta = {
      ...sourceMeta,
      installedAt,
      publishedAt: hasUpdate ? upstreamPublished : publishedAt,
      lastSyncedHash: sourceMeta.lastSyncedHash || localHash,
      remoteLatestHash: upstreamHash,
      lastCheckedAt: now,
      hasUpdate,
      checkStatus: hasUpdate ? 'update_available' : 'up_to_date',
      checkMessage: hasUpdate
        ? `上游來源有新內容（指紋 ${upstreamHash.slice(0, 7)} ≠ 目前 ${localHash.slice(0, 7)}）`
        : '與本機來源目錄一致，已是最新',
    };
    writeSourceMetaFile(skillDir, next);
    return next;
  }

  // Git source check via git ls-remote
  const repoUrl = sourceMeta.sourceUrl;
  if (!repoUrl) {
    return {
      ...sourceMeta,
      lastCheckedAt: now,
      hasUpdate: false,
      checkStatus: 'error',
      checkMessage: '缺少遠端 Git 位址',
    };
  }

  try {
    const refTarget = sourceMeta.sourceBranch || 'HEAD';
    const { stdout } = await runCmd('git', ['ls-remote', repoUrl, refTarget], undefined, 8000);
    const firstLine = stdout.trim().split(/\r?\n/)[0] || '';
    const remoteSha = firstLine.split(/\s+/)[0]?.trim();
    if (!remoteSha) {
      throw new Error(`遠端找不到分支或參照：${refTarget}`);
    }

    const currentSha = sourceMeta.lastSyncedHash || (await getGitHeadSha(skillDir));
    const hasUpdate = !currentSha || currentSha !== remoteSha;
    const next: SkillSourceMeta = {
      ...sourceMeta,
      installedAt,
      publishedAt,
      lastSyncedHash: currentSha,
      remoteLatestHash: remoteSha,
      lastCheckedAt: now,
      hasUpdate,
      checkStatus: hasUpdate ? 'update_available' : 'up_to_date',
      checkMessage: hasUpdate
        ? currentSha
          ? `偵測到遠端更新 (${currentSha.slice(0, 7)} → ${remoteSha.slice(0, 7)})`
          : `遠端最新版本 ${remoteSha.slice(0, 7)}（尚未記錄本機基準版本，可一鍵同步）`
        : `已是最新版本 (${remoteSha.slice(0, 7)})`,
    };
    writeSourceMetaFile(skillDir, next);
    return next;
  } catch (err) {
    const next: SkillSourceMeta = {
      ...sourceMeta,
      lastCheckedAt: now,
      hasUpdate: false,
      checkStatus: 'error',
      checkMessage: `檢查遠端失敗：${err instanceof Error ? err.message : String(err)}`,
    };
    writeSourceMetaFile(skillDir, next);
    return next;
  }
}

function replaceSkillFilesPreservingMeta(srcDir: string, destDir: string, backupRootDir: string): string {
  mkdirSync(backupRootDir, { recursive: true });
  const backupPath = join(
    backupRootDir,
    `${basename(destDir)}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  cpSync(destDir, backupPath, { recursive: true });

  // Remove existing files in destDir except .skill-source.json
  for (const entry of readdirSync(destDir)) {
    if (entry === SOURCE_META_FILE) continue;
    rmSync(join(destDir, entry), { recursive: true, force: true });
  }

  for (const entry of readdirSync(srcDir)) {
    if (entry === SOURCE_META_FILE || entry === '.git') continue;
    cpSync(join(srcDir, entry), join(destDir, entry), { recursive: true });
  }
  return backupPath;
}

export async function applySkillUpdate(
  skillDir: string,
  rawSkillMd: string,
  backupRootDir: string,
): Promise<{ sourceMeta: SkillSourceMeta; backupPath: string }> {
  const { installedAt, sourceMeta } = await resolveSkillLifecycleMeta(skillDir, rawSkillMd, false);
  const now = new Date().toISOString();

  if (sourceMeta.sourceType === 'local_dir') {
    const srcDir = sourceMeta.sourceDir;
    if (!srcDir || !existsSync(srcDir)) {
      throw new Error(`找不到本機來源目錄：${srcDir ?? ''}`);
    }
    const backupPath = replaceSkillFilesPreservingMeta(srcDir, skillDir, backupRootDir);
    const newHash = computeDirFingerprint(skillDir);
    let publishedAt = now;
    try {
      publishedAt = statSync(join(srcDir, 'SKILL.md')).mtime.toISOString();
    } catch {
      // ignore
    }
    const next: SkillSourceMeta = {
      ...sourceMeta,
      installedAt,
      publishedAt,
      lastSyncedHash: newHash,
      remoteLatestHash: newHash,
      lastCheckedAt: now,
      hasUpdate: false,
      checkStatus: 'up_to_date',
      checkMessage: '已同步至最新本機來源',
    };
    writeSourceMetaFile(skillDir, next);
    return { sourceMeta: next, backupPath };
  }

  if (sourceMeta.sourceType === 'git' && sourceMeta.sourceUrl) {
    const tempParent = mkdtempSync(join(tmpdir(), 'skill-docs-update-'));
    try {
      const cloneArgs = ['clone', '--depth', '1'];
      if (sourceMeta.sourceBranch) {
        cloneArgs.push('--branch', sourceMeta.sourceBranch);
      }
      cloneArgs.push(sourceMeta.sourceUrl, tempParent);
      await runCmd('git', cloneArgs, undefined, 25000);

      const remoteSha = (await getGitHeadSha(tempParent)) || sourceMeta.remoteLatestHash || '';
      const commitDate = (await getGitCommitIsoDate(tempParent)) || now;
      const srcRoot = sourceMeta.sourceSubpath
        ? join(tempParent, sourceMeta.sourceSubpath)
        : tempParent;
      if (!existsSync(join(srcRoot, 'SKILL.md'))) {
        throw new Error(`遠端路徑找不到 SKILL.md：${sourceMeta.sourceSubpath || '/'}`);
      }

      const backupPath = replaceSkillFilesPreservingMeta(srcRoot, skillDir, backupRootDir);
      const next: SkillSourceMeta = {
        ...sourceMeta,
        installedAt,
        publishedAt: commitDate,
        lastSyncedHash: remoteSha,
        remoteLatestHash: remoteSha,
        lastCheckedAt: now,
        hasUpdate: false,
        checkStatus: 'up_to_date',
        checkMessage: `已更新至版本 ${remoteSha.slice(0, 7)}`,
      };
      writeSourceMetaFile(skillDir, next);
      return { sourceMeta: next, backupPath };
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  }

  throw new Error('此 Skill 尚未綁定可更新的遠端或本機來源');
}
