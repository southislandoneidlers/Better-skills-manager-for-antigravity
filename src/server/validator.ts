import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import type { ValidationIssue } from '../shared/types.ts';
import { parseSkillMarkdown, readFrontmatterString, slugifySkillName } from './frontmatter.ts';

const KEBAB_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MD_LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const IGNORED_SCHEMES = [
  'http://',
  'https://',
  'mailto:',
  'tel:',
  'data:',
  'customization://',
  'sidecar://',
  'conversation://',
  'file://',
];

export function extractRelativeLinksFromMarkdown(body: string): string[] {
  // Strip fenced code blocks so code examples don't trigger false broken links
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((match = MD_LINK_RE.exec(stripped)) !== null) {
    let target = match[1].trim();
    if (!target || target.startsWith('#')) continue;
    const lower = target.toLowerCase();
    if (IGNORED_SCHEMES.some((scheme) => lower.startsWith(scheme))) continue;
    if (isAbsolute(target)) continue;

    const hashIdx = target.indexOf('#');
    if (hashIdx >= 0) target = target.slice(0, hashIdx);
    const queryIdx = target.indexOf('?');
    if (queryIdx >= 0) target = target.slice(0, queryIdx);
    target = target.trim();
    if (!target) continue;

    // Normalize leading ./
    const normalized = target.replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('..')) continue;
    found.add(normalized);
  }
  return [...found];
}

export interface ValidateOptions {
  skillId: string;
  skillDir: string;
  rawContent: string;
  enabled: boolean;
  activeSkillNamesMap: Map<string, string[]>;
}

export function validateSkillBundle(opts: ValidateOptions): {
  issues: ValidationIssue[];
  status: 'ok' | 'warning' | 'error';
  name: string;
  description: string;
  yamlError?: string;
} {
  const issues: ValidationIssue[] = [];
  const parsed = parseSkillMarkdown(opts.rawContent);

  const name = readFrontmatterString(parsed.frontmatter, 'name');
  const description = readFrontmatterString(parsed.frontmatter, 'description');

  if (!parsed.hasFrontmatter) {
    issues.push({
      code: 'yaml_error',
      severity: 'error',
      message: '缺少 YAML Frontmatter 區塊（檔案開頭需要 --- ... ---）',
    });
  } else if (parsed.yamlError) {
    issues.push({
      code: 'yaml_error',
      severity: 'error',
      message: `YAML 語法錯誤：${parsed.yamlError}`,
    });
  }

  if (!name) {
    issues.push({
      code: 'missing_name',
      severity: 'error',
      message: '缺少必填欄位 name（Skill 唯一識別名稱）',
      fixLabel: '自動產生名稱',
      suggestedName: slugifySkillName(opts.skillDir.split(sep).pop() || 'my-skill'),
    });
  } else {
    if (!KEBAB_NAME_RE.test(name)) {
      issues.push({
        code: 'invalid_name',
        severity: 'warning',
        message: `建議使用小寫英數與連字號（kebab-case），例如「${slugifySkillName(name)}」`,
        fixLabel: `改為 ${slugifySkillName(name)}`,
        suggestedName: slugifySkillName(name),
      });
    }
    if (opts.enabled) {
      const ids = opts.activeSkillNamesMap.get(name) ?? [];
      if (ids.length > 1) {
        issues.push({
          code: 'duplicate_name',
          severity: 'warning',
          message: `偵測到同名啟用中 Skill「${name}」（共 ${ids.length} 處），高優先度範圍會覆寫低優先度`,
        });
      }
    }
  }

  if (!description) {
    issues.push({
      code: 'missing_description',
      severity: 'error',
      message: '缺少必填欄位 description：Agent 需要此描述判斷何時啟用此 Skill',
    });
  } else if (description.length < 20) {
    issues.push({
      code: 'short_description',
      severity: 'warning',
      message: '觸發描述偏短（少於 20 字），建議補上「做什麼」與「何時觸發」以提升命中率',
    });
  }

  // Check relative links inside SKILL.md body
  const relLinks = extractRelativeLinksFromMarkdown(parsed.body);
  const resolvedRoot = resolve(opts.skillDir);
  for (const rel of relLinks) {
    const absTarget = resolve(resolvedRoot, rel);
    const relFromRoot = relative(resolvedRoot, absTarget);
    if (relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) continue;

    const looksLikeFileOrDir =
      rel.includes('/') ||
      /\.[a-z0-9]{1,8}$/i.test(rel);
    if (!looksLikeFileOrDir) continue;

    if (!existsSync(absTarget)) {
      issues.push({
        code: 'broken_link',
        severity: 'error',
        message: `附件連結斷連：找不到「${rel}」`,
        fixLabel: `+ 一鍵建立此附件`,
        missingRelPath: rel.replace(/\/$/, ''),
      });
    } else {
      try {
        const st = statSync(absTarget);
        if (st.isDirectory() && rel.endsWith('/')) {
          continue;
        }
      } catch {
        // ignore stat errors
      }
    }
  }

  let status: 'ok' | 'warning' | 'error' = 'ok';
  if (issues.some((i) => i.severity === 'error')) {
    status = 'error';
  } else if (issues.length > 0) {
    status = 'warning';
  }

  return {
    issues,
    status,
    name,
    description,
    yamlError: parsed.yamlError,
  };
}

export function defaultAttachmentStub(relPath: string): string {
  const lower = relPath.toLowerCase();
  const baseName = relPath.split('/').pop() || relPath;
  const parentDir = dirname(relPath);
  if (lower.endsWith('.sh')) {
    return `#!/usr/bin/env bash\nset -euo pipefail\n\n# ${baseName} — generated by Skill 文件庫\necho "Running ${baseName}"\n`;
  }
  if (lower.endsWith('.py')) {
    return `#!/usr/bin/env python3\n\"\"\"${baseName} — generated by Skill 文件庫.\"\"\"\n\ndef main() -> None:\n    print("Running ${baseName}")\n\nif __name__ == "__main__":\n    main()\n`;
  }
  if (lower.endsWith('.mjs') || lower.endsWith('.js')) {
    return `// ${baseName} — generated by Skill 文件庫\nconsole.log('Running ${baseName}');\n`;
  }
  if (lower.endsWith('.ts')) {
    return `// ${baseName} — generated by Skill 文件庫\nexport function run(): void {\n  console.log('Running ${baseName}');\n}\n`;
  }
  if (lower.endsWith('.json')) {
    return `{\n  "name": "${baseName.replace(/\.json$/i, '')}"\n}\n`;
  }
  return `# ${baseName}\n\n> 由「Skill 文件庫」一鍵建立於 \`${parentDir === '.' ? '' : parentDir + '/'}${baseName}\`。\n\n在此補充參考文件或說明內容。\n`;
}
