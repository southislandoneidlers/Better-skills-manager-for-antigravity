import YAML from 'yaml';

export interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
  yamlError?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;
const EMPTY_FRONTMATTER_RE = /^---\r?\n---(?:\r?\n([\s\S]*))?$/;

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (EMPTY_FRONTMATTER_RE.test(normalized)) {
    const match = EMPTY_FRONTMATTER_RE.exec(normalized);
    return {
      frontmatter: {},
      body: (match?.[1] ?? '').replace(/^\r?\n/, ''),
      hasFrontmatter: true,
    };
  }

  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) {
    return {
      frontmatter: {},
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const yamlText = match[1];
  const body = (match[2] ?? '').replace(/^\r?\n/, '');
  try {
    const parsed = YAML.parse(yamlText);
    if (parsed === null || parsed === undefined) {
      return { frontmatter: {}, body, hasFrontmatter: true };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        frontmatter: {},
        body,
        hasFrontmatter: true,
        yamlError: 'Frontmatter 必須為 YAML 鍵值物件 (key: value)',
      };
    }
    return {
      frontmatter: parsed as Record<string, unknown>,
      body,
      hasFrontmatter: true,
    };
  } catch (err) {
    return {
      frontmatter: {},
      body,
      hasFrontmatter: true,
      yamlError: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface StructuredSkillFields {
  name: string;
  description: string;
  version?: string;
  repository?: string;
  publishedAt?: string;
}

export function serializeSkillMarkdown(
  fields: StructuredSkillFields,
  body: string,
  rawOriginal?: string,
): string {
  let existingFm: Record<string, unknown> = {};
  if (rawOriginal) {
    const parsed = parseSkillMarkdown(rawOriginal);
    if (!parsed.yamlError) {
      existingFm = { ...parsed.frontmatter };
    }
  }

  const nextFm: Record<string, unknown> = {};
  // Put name & description first for clean readability
  nextFm.name = fields.name;
  nextFm.description = fields.description;

  if (fields.version !== undefined) {
    if (fields.version.trim()) {
      nextFm.version = fields.version.trim();
    } else {
      delete existingFm.version;
    }
  } else if (existingFm.version !== undefined) {
    nextFm.version = existingFm.version;
  }

  if (fields.repository !== undefined) {
    if (fields.repository.trim()) {
      nextFm.repository = fields.repository.trim();
    } else {
      delete existingFm.repository;
    }
  } else if (existingFm.repository !== undefined) {
    nextFm.repository = existingFm.repository;
  }

  if (fields.publishedAt !== undefined) {
    if (fields.publishedAt.trim()) {
      nextFm.published_at = fields.publishedAt.trim();
    } else {
      delete existingFm.published_at;
    }
  } else if (existingFm.published_at !== undefined) {
    nextFm.published_at = existingFm.published_at;
  }

  for (const [k, v] of Object.entries(existingFm)) {
    if (k === 'name' || k === 'description' || k === 'version' || k === 'repository' || k === 'published_at') {
      continue;
    }
    nextFm[k] = v;
  }

  const yamlStr = YAML.stringify(nextFm, {
    lineWidth: 88,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd();

  const cleanBody = body.replace(/^\r?\n+/, '');
  return `---\n${yamlStr}\n---\n\n${cleanBody}${cleanBody.endsWith('\n') || cleanBody.length === 0 ? '' : '\n'}`;
}

export function slugifySkillName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled-skill';
}

export function readFrontmatterString(fm: Record<string, unknown>, key: string): string {
  const val = fm[key];
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

export function extractPublishedAtFromFrontmatter(fm: Record<string, unknown>): string | undefined {
  const direct =
    readFrontmatterString(fm, 'published_at') ||
    readFrontmatterString(fm, 'publishedAt') ||
    readFrontmatterString(fm, 'date');
  if (direct) return direct;
  const meta = fm.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    const nested =
      readFrontmatterString(m, 'published_at') ||
      readFrontmatterString(m, 'publishedAt') ||
      readFrontmatterString(m, 'date');
    if (nested) return nested;
  }
  return undefined;
}
