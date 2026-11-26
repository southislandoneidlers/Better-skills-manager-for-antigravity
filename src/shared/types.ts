export type ScopeKind = 'global' | 'workspace' | 'external' | 'builtin';

export interface ScopeInfo {
  id: string;
  label: string;
  kind: ScopeKind;
  rootDir: string;
  skillsDir: string;
  readOnly: boolean;
  exists: boolean;
  skillCount: number;
  customAdded?: boolean;
}

export interface CategoryNode {
  id: string;
  name: string;
  path: string; // e.g. "" for root, "前端/React" for nested
  scopeId: string;
  children: CategoryNode[];
  skillCount: number;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code:
    | 'yaml_error'
    | 'missing_name'
    | 'invalid_name'
    | 'duplicate_name'
    | 'missing_description'
    | 'short_description'
    | 'broken_link';
  severity: ValidationSeverity;
  message: string;
  fixLabel?: string;
  missingRelPath?: string;
  suggestedName?: string;
}

export type SkillSourceType = 'git' | 'local_dir' | 'local_original' | 'builtin';

export interface SkillSourceMeta {
  sourceType: SkillSourceType;
  sourceUrl?: string;
  sourceBranch?: string;
  sourceSubpath?: string;
  sourceDir?: string;
  installedAt: string;
  publishedAt?: string;
  lastSyncedHash?: string;
  lastCheckedAt?: string;
  remoteLatestHash?: string;
  hasUpdate?: boolean;
  checkStatus?: 'up_to_date' | 'update_available' | 'local_original' | 'builtin' | 'error' | 'unchecked';
  checkMessage?: string;
}

export interface UsageEvent {
  timestamp: string;
  source: 'read_file' | 'slash_command' | 'mention' | 'panel_attach';
  conversationId: string;
  skillKey: string;
}

export interface UsageStats {
  totalUses: number;
  last30dUses: number;
  lastUsedAt?: string;
  idleDays: number | null;
  dailyCounts365: Record<string, number>;
  recentEvents: UsageEvent[];
}

export type UiLang = 'en' | 'zh-TW';

export interface RelationReason {
  type: 'explicit_ref' | 'co_usage' | 'domain_overlap' | 'high_similarity';
  label: string;
  detail: string;
  weight: number;
  meta?: {
    targetSkillName?: string;
    isReverseRef?: boolean;
    coCount?: number;
    simPercent?: number;
    sharedTokens?: string[];
  };
}

export interface SkillRelation {
  targetId: string;
  targetName: string;
  targetScopeId: string;
  targetScopeLabel: string;
  targetDescription: string;
  score: number;
  reasons: RelationReason[];
}

export interface SkillSummary {
  id: string;
  dirName: string;
  name: string;
  description: string;
  scopeId: string;
  scopeLabel: string;
  scopeKind: ScopeKind;
  readOnly: boolean;
  enabled: boolean;
  categoryPath: string;
  skillDir: string;
  skillMdPath: string;
  attachmentCount: number;
  validationStatus: 'ok' | 'warning' | 'error';
  issues: ValidationIssue[];
  installedAt: string;
  publishedAt: string;
  sourceMeta: SkillSourceMeta;
  totalUses: number;
  last30dUses: number;
  lastUsedAt?: string;
  idleDays: number | null;
  relationCount: number;
  hasOverlapWarning: boolean;
}

export interface AttachmentFile {
  relPath: string;
  name: string;
  folder: string;
  size: number;
  isBinary: boolean;
  executable: boolean;
}

export interface SkillDetail extends SkillSummary {
  version?: string;
  repository?: string;
  body: string;
  rawContent: string;
  extraFrontmatterKeys: string[];
  yamlError?: string;
  attachments: AttachmentFile[];
  usage: UsageStats;
  relations: SkillRelation[];
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  score: number;
  reasons: RelationReason[];
}

export interface GlobalAnalyticsSummary {
  dailyCounts365: Record<string, number>;
  recentEvents: Array<UsageEvent & { skillName: string; skillId?: string }>;
  totalActivations: number;
  last30dActivations: number;
  idleSkillIds: string[];
}

export interface SnapshotPayload {
  seq: number;
  generatedAt: string;
  uiLang?: UiLang;
  scopes: ScopeInfo[];
  folders: CategoryNode[];
  skills: SkillSummary[];
  analytics: GlobalAnalyticsSummary;
  graphEdges: GraphEdge[];
}
