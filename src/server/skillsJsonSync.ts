import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

interface SkillsJsonEntry {
  path: string;
  include_only?: string[];
  exclude?: string[];
}

interface SkillsJsonConfig {
  inherits?: Array<Record<string, unknown>>;
  entries?: SkillsJsonEntry[];
  [key: string]: unknown;
}

function expandConfigPath(rawPath: string, scopeRootDir: string): string {
  if (rawPath.startsWith('~/')) {
    return resolve(homedir(), rawPath.slice(2));
  }
  if (isAbsolute(rawPath)) {
    return resolve(rawPath);
  }
  // Workspace-relative or dot-dir-relative
  return resolve(scopeRootDir, rawPath);
}

function isInsideOrEqual(targetPath: string, rootDir: string): boolean {
  const rel = relative(resolve(rootDir), resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function collectNestedCategoryDirs(skillsRootDir: string): string[] {
  const categoryDirs = new Set<string>();
  if (!existsSync(skillsRootDir)) return [];

  function walk(currentDir: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

      const fullDir = join(currentDir, entry.name);
      const hasSkillMd = existsSync(join(fullDir, 'SKILL.md'));
      if (hasSkillMd) {
        // Any skill placed deeper than 1 level needs its immediate parent directory registered in skills.json
        if (depth >= 1) {
          categoryDirs.add(resolve(currentDir));
        }
        // Never descend inside a skill bundle
        continue;
      }

      walk(fullDir, depth + 1);
    }
  }

  walk(skillsRootDir, 0);
  return [...categoryDirs].sort((a, b) => a.localeCompare(b));
}

/**
 * Synchronizes <scopeRootDir>/skills.json so nested category folders inside
 * <skillsRootDir> are registered in `entries`, while preserving all user-defined
 * `inherits`, external `entries`, and extra properties.
 */
export function syncSkillsJsonForScope(
  scopeRootDir: string,
  skillsRootDir: string,
  scopeKind: 'global' | 'workspace',
): { changed: boolean; managedDirs: string[] } {
  const configPath = join(scopeRootDir, 'skills.json');
  const nestedCategoryAbsDirs = collectNestedCategoryDirs(skillsRootDir);

  let existing: SkillsJsonConfig = {};
  let hadExistingFile = false;
  if (existsSync(configPath)) {
    hadExistingFile = true;
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as SkillsJsonConfig;
      }
    } catch {
      // Preserve corrupted file rather than overwriting blindly
      return { changed: false, managedDirs: nestedCategoryAbsDirs };
    }
  }

  const prevEntries = Array.isArray(existing.entries) ? existing.entries : [];
  const preservedEntries = prevEntries.filter((entry) => {
    if (!entry || typeof entry.path !== 'string') return false;
    const resolvedEntry = expandConfigPath(entry.path, scopeRootDir);
    // Keep entries outside skillsRootDir (or pointing directly to skillsRootDir with filters)
    if (!isInsideOrEqual(resolvedEntry, skillsRootDir)) {
      return true;
    }
    if (resolve(resolvedEntry) === resolve(skillsRootDir)) {
      return true;
    }
    return false;
  });

  // Format managed category paths idiomatically for the scope
  const home = homedir();
  const formatManagedPath = (absDir: string): string => {
    if (scopeKind === 'global' && isInsideOrEqual(absDir, home)) {
      return `~/${relative(home, absDir).split('\\').join('/')}`;
    }
    if (scopeKind === 'workspace') {
      // For .agents/skills/<cat>, repo root is parent of .agents
      const repoRoot = dirname(scopeRootDir);
      if (isInsideOrEqual(absDir, repoRoot)) {
        return relative(repoRoot, absDir).split('\\').join('/');
      }
    }
    return absDir;
  };

  const managedEntries: SkillsJsonEntry[] = nestedCategoryAbsDirs.map((dir) => ({
    path: formatManagedPath(dir),
  }));

  const nextEntries = [...preservedEntries, ...managedEntries];
  const nextConfig: SkillsJsonConfig = { ...existing };

  if (nextEntries.length > 0) {
    nextConfig.entries = nextEntries;
  } else {
    delete nextConfig.entries;
  }

  const nextJson = JSON.stringify(nextConfig, null, 2) + '\n';
  const prevJson = hadExistingFile ? readFileSync(configPath, 'utf-8') : '';

  // Avoid creating an empty skills.json if nothing existed and no nested categories exist
  if (!hadExistingFile && Object.keys(nextConfig).length === 0) {
    return { changed: false, managedDirs: [] };
  }

  if (nextJson === prevJson) {
    return { changed: false, managedDirs: nestedCategoryAbsDirs };
  }

  mkdirSync(scopeRootDir, { recursive: true });
  writeFileSync(configPath, nextJson, 'utf-8');
  return { changed: true, managedDirs: nestedCategoryAbsDirs };
}
