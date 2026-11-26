import type { GraphEdge, RelationReason, SkillRelation } from '../shared/types.ts';

export interface SkillRelInput {
  id: string;
  name: string;
  dirName: string;
  scopeId: string;
  scopeLabel: string;
  description: string;
  bodyAndScriptsText: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'when', 'use', 'this', 'skill', 'user', 'asks', 'that', 'from',
  'your', 'into', 'are', 'you', 'can', 'not', 'only', 'also', 'have', 'will', 'how', 'all',
  'about', 'any', 'more', 'need', 'needs', 'make', 'run', 'using', 'used', 'file', 'files',
  'tool', 'tools', 'work', 'task', 'tasks', 'agent', 'agents', 'help', 'create', 'manage',
  'should', 'would', 'could', 'which', 'what', 'where', 'them', 'then', 'than', 'its', 'their',
  '的', '了', '和', '與', '在', '是', '使用', '技能', '可以', '進行', '透過', '這個', '一個',
]);

const DOMAIN_KEYWORDS = new Set([
  'mcp', 'plugin', 'plugins', 'sidecar', 'sidecars', 'skill', 'skills', 'hook', 'hooks',
  'rule', 'rules', 'workflow', 'workflows', 'swarm', 'subagent', 'subagents', 'browser',
  'react', 'vite', 'typescript', 'node', 'python', 'docker', 'git', 'github', 'cron',
  'schedule', 'automation', 'conversation', 'conversations', 'markdown', 'yaml', 'json',
  'api', 'cli', 'ui', 'html', 'css', 'svg', 'test', 'testing', 'lint', 'deploy', 'database',
  'sql', 'gemini', 'antigravity', 'config', 'settings', 'sandbox', 'permission',
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // English / identifier words
  const asciiMatches = lower.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  for (const w of asciiMatches) {
    if (!STOP_WORDS.has(w) && w.length >= 2) {
      tokens.add(w);
      for (const part of w.split(/[-_]+/)) {
        if (part.length >= 2 && !STOP_WORDS.has(part)) {
          tokens.add(part);
        }
      }
    }
  }

  // CJK 2-grams for Chinese/Japanese descriptions
  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i <= run.length - 2; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) tokens.add(bigram);
    }
  }

  return tokens;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectsExplicitReference(sourceText: string, targetName: string, targetDirName: string): boolean {
  const candidates = new Set<string>();
  if (targetName) candidates.add(targetName.toLowerCase());
  if (targetDirName) candidates.add(targetDirName.toLowerCase());

  const lower = sourceText.toLowerCase();
  for (const cand of candidates) {
    if (!cand || cand.length < 3) continue;
    const escaped = escapeRegExp(cand);
    if (cand.includes('-') || cand.includes('_')) {
      const re = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, 'i');
      if (re.test(lower)) return true;
    } else {
      // Single word: require explicit invocation context (`name`, /name, or "name skill") to avoid false positives
      const re = new RegExp(
        `(\`${escaped}\`|/${escaped}(?![a-z0-9_-])|(?<![a-z0-9_-])${escaped}\\s+skill\\b|\\bskill\\s+${escaped}(?![a-z0-9_-]))`,
        'i',
      );
      if (re.test(lower)) return true;
    }
  }
  return false;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
  const shared: string[] = [];
  for (const item of a) {
    if (b.has(item)) shared.push(item);
  }
  const unionSize = a.size + b.size - shared.length;
  return {
    score: unionSize > 0 ? shared.length / unionSize : 0,
    shared,
  };
}

export function analyzeSkillRelationships(
  skills: SkillRelInput[],
  coUsageByConversation: Map<string, Set<string>>,
): {
  relationsBySkillId: Map<string, SkillRelation[]>;
  graphEdges: GraphEdge[];
} {
  const skillById = new Map<string, SkillRelInput>();
  const descTokensById = new Map<string, Set<string>>();
  for (const s of skills) {
    skillById.set(s.id, s);
    descTokensById.set(s.id, tokenize(`${s.name} ${s.description}`));
  }

  // Count co-usage pairs across conversations
  const coCountMap = new Map<string, number>();
  for (const [, convSkills] of coUsageByConversation) {
    const arr = [...convSkills].filter((id) => skillById.has(id)).sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const pairKey = `${arr[i]}||${arr[j]}`;
        coCountMap.set(pairKey, (coCountMap.get(pairKey) || 0) + 1);
      }
    }
  }

  const relationsBySkillId = new Map<string, SkillRelation[]>();
  for (const s of skills) relationsBySkillId.set(s.id, []);

  const graphEdges: GraphEdge[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i];
      const b = skills[j];

      // Skip identical skill names across scopes (already flagged as duplicate_name by validator)
      const normA = (a.name || a.dirName).toLowerCase();
      const normB = (b.name || b.dirName).toLowerCase();
      if (normA === normB) continue;

      const reasonsForA: RelationReason[] = [];
      const reasonsForB: RelationReason[] = [];

      const aRefsB = detectsExplicitReference(a.bodyAndScriptsText, b.name, b.dirName);
      const bRefsA = detectsExplicitReference(b.bodyAndScriptsText, a.name, a.dirName);

      if (aRefsB) {
        reasonsForA.push({
          type: 'explicit_ref',
          label: '明確引用',
          detail: `本文件主文或腳本提及「${b.name || b.dirName}」`,
          weight: 0.9,
          meta: { targetSkillName: b.name || b.dirName, isReverseRef: false },
        });
        reasonsForB.push({
          type: 'explicit_ref',
          label: '被引用協作',
          detail: `被「${a.name || a.dirName}」的說明或腳本點名搭配使用`,
          weight: 0.9,
          meta: { targetSkillName: a.name || a.dirName, isReverseRef: true },
        });
      }
      if (bRefsA) {
        reasonsForB.push({
          type: 'explicit_ref',
          label: '明確引用',
          detail: `本文件主文或腳本提及「${a.name || a.dirName}」`,
          weight: 0.9,
          meta: { targetSkillName: a.name || a.dirName, isReverseRef: false },
        });
        reasonsForA.push({
          type: 'explicit_ref',
          label: '被引用協作',
          detail: `被「${b.name || b.dirName}」的說明或腳本點名搭配使用`,
          weight: 0.9,
          meta: { targetSkillName: b.name || b.dirName, isReverseRef: true },
        });
      }

      // Co-usage in conversation transcripts
      const pairKey = a.id < b.id ? `${a.id}||${b.id}` : `${b.id}||${a.id}`;
      const coCount = coCountMap.get(pairKey) || 0;
      if (coCount > 0) {
        const r: RelationReason = {
          type: 'co_usage',
          label: '同對話搭配',
          detail: `曾在 ${coCount} 次對話中一起搭配使用`,
          weight: Math.min(0.95, 0.5 + coCount * 0.15),
          meta: { coCount },
        };
        reasonsForA.push(r);
        reasonsForB.push(r);
      }

      // Domain / description similarity
      const tokensA = descTokensById.get(a.id)!;
      const tokensB = descTokensById.get(b.id)!;
      const { score: simScore, shared } = jaccardSimilarity(tokensA, tokensB);
      const sharedDomainTokens = shared.filter((t) => DOMAIN_KEYWORDS.has(t));

      if (simScore >= 0.45) {
        const simPercent = Math.round(simScore * 100);
        const r: RelationReason = {
          type: 'high_similarity',
          label: '⚠️ 觸發描述重疊',
          detail: `觸發描述相似度達 ${simPercent}%（共同關鍵詞：${shared.slice(0, 5).join(', ')}），建議釐清分工以免 Agent 選錯`,
          weight: simScore,
          meta: { simPercent, sharedTokens: shared.slice(0, 5) },
        };
        reasonsForA.push(r);
        reasonsForB.push(r);
      } else if (sharedDomainTokens.length >= 2 && simScore >= 0.14) {
        const r: RelationReason = {
          type: 'domain_overlap',
          label: '工具／領域相近',
          detail: `共用領域工具關鍵詞：${sharedDomainTokens.slice(0, 5).join(', ')}`,
          weight: Math.min(0.65, 0.25 + sharedDomainTokens.length * 0.1),
          meta: { sharedTokens: sharedDomainTokens.slice(0, 5) },
        };
        reasonsForA.push(r);
        reasonsForB.push(r);
      }

      if (reasonsForA.length === 0 && reasonsForB.length === 0) continue;

      const scoreA = Math.min(1, reasonsForA.reduce((acc, r) => Math.max(acc, r.weight), 0) + (reasonsForA.length - 1) * 0.1);
      const scoreB = Math.min(1, reasonsForB.reduce((acc, r) => Math.max(acc, r.weight), 0) + (reasonsForB.length - 1) * 0.1);

      relationsBySkillId.get(a.id)!.push({
        targetId: b.id,
        targetName: b.name || b.dirName,
        targetScopeId: b.scopeId,
        targetScopeLabel: b.scopeLabel,
        targetDescription: b.description,
        score: Number(scoreA.toFixed(2)),
        reasons: reasonsForA,
      });

      relationsBySkillId.get(b.id)!.push({
        targetId: a.id,
        targetName: a.name || a.dirName,
        targetScopeId: a.scopeId,
        targetScopeLabel: a.scopeLabel,
        targetDescription: a.description,
        score: Number(scoreB.toFixed(2)),
        reasons: reasonsForB,
      });

      const mergedEdgeReasons = [...reasonsForA];
      for (const r of reasonsForB) {
        if (!mergedEdgeReasons.some((x) => x.type === r.type && x.detail === r.detail)) {
          if (r.type === 'explicit_ref') mergedEdgeReasons.push(r);
        }
      }
      graphEdges.push({
        sourceId: a.id,
        targetId: b.id,
        score: Number(Math.max(scoreA, scoreB).toFixed(2)),
        reasons: mergedEdgeReasons,
      });
    }
  }

  for (const [, list] of relationsBySkillId) {
    list.sort((x, y) => y.score - x.score);
  }
  graphEdges.sort((x, y) => y.score - x.score);

  return { relationsBySkillId, graphEdges };
}
