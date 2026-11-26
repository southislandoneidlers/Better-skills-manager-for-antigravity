import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GlobalAnalyticsSummary, UsageEvent, UsageStats } from '../shared/types.ts';

interface CachedTranscriptFile {
  mtimeMs: number;
  size: number;
  events: UsageEvent[];
}

interface UsageCacheFile {
  version: number;
  files: Record<string, CachedTranscriptFile>;
}

const READ_SKILL_RE = /[/\\]skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i;
const SLASH_CMD_RE = /(?:^|\s)\/([a-z0-9][a-z0-9-_]{1,64})(?=\s|$|[.,!?;:])/gi;
const MENTION_SKILL_RE = /@\[([a-z0-9][a-z0-9-_]{1,64})\]/gi;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractUserInputInner(content: string): string {
  const m = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(content);
  return m ? m[1] : content;
}

function parseTranscriptEvents(filePath: string, conversationId: string): UsageEvent[] {
  const rawEvents: UsageEvent[] = [];
  let text = '';
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return rawEvents;
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const timestamp = typeof obj.created_at === 'string' ? obj.created_at : '';
    if (!timestamp) continue;

    // 1. Check tool_calls reading SKILL.md
    if (Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        const call = tc as { name?: string; args?: Record<string, unknown> };
        const toolName = String(call.name || '');
        if (toolName === 'read_file' || toolName === 'view_file') {
          const targetPath = typeof call.args?.Path === 'string'
            ? call.args.Path
            : typeof call.args?.AbsolutePath === 'string'
              ? call.args.AbsolutePath
              : '';
          const m = READ_SKILL_RE.exec(targetPath);
          if (m) {
            rawEvents.push({
              timestamp,
              source: 'read_file',
              conversationId,
              skillKey: m[1].toLowerCase(),
            });
          }
        }
      }
    }

    // 2. Check USER_INPUT slash commands or @[skill] mentions
    if (obj.type === 'USER_INPUT' && typeof obj.content === 'string') {
      const inner = extractUserInputInner(obj.content);
      SLASH_CMD_RE.lastIndex = 0;
      let sm: RegExpExecArray | null;
      while ((sm = SLASH_CMD_RE.exec(inner)) !== null) {
        rawEvents.push({
          timestamp,
          source: 'slash_command',
          conversationId,
          skillKey: sm[1].toLowerCase(),
        });
      }
      MENTION_SKILL_RE.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = MENTION_SKILL_RE.exec(inner)) !== null) {
        rawEvents.push({
          timestamp,
          source: 'mention',
          conversationId,
          skillKey: mm[1].toLowerCase(),
        });
      }
    }
  }

  return rawEvents;
}

export interface KnownSkillLookupItem {
  id: string;
  name: string;
  dirName: string;
}

export class UsageAnalyticsEngine {
  private readonly brainDir: string;
  private readonly cacheFile: string;
  private readonly panelLogFile: string;

  constructor(appDataDir: string, pluginDataDir: string) {
    this.brainDir = join(appDataDir, 'brain');
    this.cacheFile = join(pluginDataDir, 'usage-cache.json');
    this.panelLogFile = join(pluginDataDir, 'panel-usage.jsonl');
  }

  recordPanelAttach(skillIds: string[], skillNames: string[]): void {
    try {
      mkdirSync(dirname(this.panelLogFile), { recursive: true });
      const now = new Date().toISOString();
      const lines = skillNames.map((name, idx) =>
        JSON.stringify({
          timestamp: now,
          source: 'panel_attach',
          conversationId: 'panel-context',
          skillKey: name.toLowerCase(),
          skillId: skillIds[idx] || '',
        }),
      );
      if (lines.length > 0) {
        appendFileSync(this.panelLogFile, lines.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // ignore logging error
    }
  }

  private loadCache(): UsageCacheFile {
    if (!existsSync(this.cacheFile)) {
      return { version: 1, files: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as UsageCacheFile;
      if (parsed && parsed.version === 1 && parsed.files) return parsed;
    } catch {
      // ignore corrupted cache
    }
    return { version: 1, files: {} };
  }

  private saveCache(cache: UsageCacheFile): void {
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify(cache), 'utf-8');
    } catch {
      // ignore cache write failure
    }
  }

  private readPanelEvents(): UsageEvent[] {
    if (!existsSync(this.panelLogFile)) return [];
    const events: UsageEvent[] = [];
    try {
      const lines = readFileSync(this.panelLogFile, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as UsageEvent;
          if (obj.timestamp && obj.skillKey) {
            events.push(obj);
          }
        } catch {
          // ignore bad line
        }
      }
    } catch {
      // ignore
    }
    return events;
  }

  collect(
    knownSkills: KnownSkillLookupItem[],
    nowMs = Date.now(),
  ): {
    bySkillId: Map<string, UsageStats>;
    coUsageByConversation: Map<string, Set<string>>;
    globalSummary: GlobalAnalyticsSummary;
  } {
    // Map normalized keys (both dirName and frontmatter name, plus underscore/hyphen variants) -> matching skill IDs
    const keyToSkillIds = new Map<string, string[]>();
    const skillNameById = new Map<string, string>();

    const registerKey = (key: string, skillId: string) => {
      const norm = key.trim().toLowerCase();
      if (!norm) return;
      const list = keyToSkillIds.get(norm) ?? [];
      if (!list.includes(skillId)) list.push(skillId);
      keyToSkillIds.set(norm, list);
      // Also register underscore<->hyphen variant (e.g. antigravity_guide vs antigravity-guide)
      const hyphenVariant = norm.replace(/_/g, '-');
      if (hyphenVariant !== norm) {
        const hList = keyToSkillIds.get(hyphenVariant) ?? [];
        if (!hList.includes(skillId)) hList.push(skillId);
        keyToSkillIds.set(hyphenVariant, hList);
      }
    };

    for (const s of knownSkills) {
      skillNameById.set(s.id, s.name || s.dirName);
      registerKey(s.dirName, s.id);
      if (s.name) registerKey(s.name, s.id);
    }

    const cache = this.loadCache();
    let cacheDirty = false;
    const allRawEvents: UsageEvent[] = [...this.readPanelEvents()];

    if (existsSync(this.brainDir)) {
      let convDirs: string[] = [];
      try {
        convDirs = readdirSync(this.brainDir);
      } catch {
        convDirs = [];
      }

      for (const convId of convDirs) {
        const logsDir = join(this.brainDir, convId, '.system_generated', 'logs');
        const fullPath = join(logsDir, 'transcript_full.jsonl');
        const compactPath = join(logsDir, 'transcript.jsonl');
        const targetPath = existsSync(fullPath) ? fullPath : existsSync(compactPath) ? compactPath : '';
        if (!targetPath) continue;

        let st;
        try {
          st = statSync(targetPath);
        } catch {
          continue;
        }

        const cached = cache.files[targetPath];
        if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
          allRawEvents.push(...cached.events);
        } else {
          const parsed = parseTranscriptEvents(targetPath, convId);
          cache.files[targetPath] = {
            mtimeMs: st.mtimeMs,
            size: st.size,
            events: parsed,
          };
          cacheDirty = true;
          allRawEvents.push(...parsed);
        }
      }
    }

    if (cacheDirty) {
      this.saveCache(cache);
    }

    // Resolve raw events against known skills & deduplicate within 5 minutes per (convId, skillId)
    allRawEvents.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const lastSeenByConvAndSkill = new Map<string, number>();
    const eventsBySkillId = new Map<string, UsageEvent[]>();
    const coUsageByConversation = new Map<string, Set<string>>();
    const resolvedGlobalEvents: Array<UsageEvent & { skillName: string; skillId?: string }> = [];

    for (const ev of allRawEvents) {
      const tsMs = Date.parse(ev.timestamp);
      if (Number.isNaN(tsMs)) continue;
      const matchedIds = keyToSkillIds.get(ev.skillKey) ?? keyToSkillIds.get(ev.skillKey.replace(/_/g, '-'));
      if (!matchedIds || matchedIds.length === 0) continue;

      for (const skillId of matchedIds) {
        const dedupKey = `${ev.conversationId}::${skillId}`;
        const prevMs = lastSeenByConvAndSkill.get(dedupKey);
        if (prevMs !== undefined && tsMs - prevMs < DEDUP_WINDOW_MS) {
          continue;
        }
        lastSeenByConvAndSkill.set(dedupKey, tsMs);

        const list = eventsBySkillId.get(skillId) ?? [];
        list.push(ev);
        eventsBySkillId.set(skillId, list);

        if (ev.conversationId !== 'panel-context') {
          const convSet = coUsageByConversation.get(ev.conversationId) ?? new Set<string>();
          convSet.add(skillId);
          coUsageByConversation.set(ev.conversationId, convSet);
        }

        resolvedGlobalEvents.push({
          ...ev,
          skillId,
          skillName: skillNameById.get(skillId) || ev.skillKey,
        });
      }
    }

    const cutoff30dMs = nowMs - 30 * DAY_MS;
    const cutoff365dMs = nowMs - 365 * DAY_MS;
    const globalDaily365: Record<string, number> = {};
    let totalActivations = 0;
    let last30dActivations = 0;
    const idleSkillIds: string[] = [];
    const bySkillId = new Map<string, UsageStats>();

    for (const s of knownSkills) {
      const list = eventsBySkillId.get(s.id) ?? [];
      const daily365: Record<string, number> = {};
      let last30dUses = 0;
      let lastUsedMs = 0;
      let lastUsedAt: string | undefined;

      for (const ev of list) {
        const tsMs = Date.parse(ev.timestamp);
        if (tsMs >= cutoff30dMs) {
          last30dUses += 1;
        }
        if (tsMs >= cutoff365dMs) {
          const dayKey = formatDateKey(new Date(tsMs));
          daily365[dayKey] = (daily365[dayKey] || 0) + 1;
          globalDaily365[dayKey] = (globalDaily365[dayKey] || 0) + 1;
        }
        if (tsMs > lastUsedMs) {
          lastUsedMs = tsMs;
          lastUsedAt = ev.timestamp;
        }
      }

      const idleDays = lastUsedMs > 0 ? Math.floor((nowMs - lastUsedMs) / DAY_MS) : null;
      if (idleDays === null || idleDays >= 30) {
        idleSkillIds.push(s.id);
      }

      totalActivations += list.length;
      last30dActivations += last30dUses;

      const sortedRecent = [...list].sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      );

      bySkillId.set(s.id, {
        totalUses: list.length,
        last30dUses,
        lastUsedAt,
        idleDays,
        dailyCounts365: daily365,
        recentEvents: sortedRecent.slice(0, 100),
      });
    }

    resolvedGlobalEvents.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    return {
      bySkillId,
      coUsageByConversation,
      globalSummary: {
        dailyCounts365: globalDaily365,
        recentEvents: resolvedGlobalEvents.slice(0, 150),
        totalActivations,
        last30dActivations,
        idleSkillIds,
      },
    };
  }
}
