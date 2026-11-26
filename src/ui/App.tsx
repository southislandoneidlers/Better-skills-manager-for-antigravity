import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import type {
  CategoryNode,
  SkillDetail,
  SkillSummary,
  SnapshotPayload,
  UiLang,
} from '../shared/types.ts';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { DocumentView } from './components/DocumentView.tsx';
import { GraphView } from './components/GraphView.tsx';
import { detectInitialLang, formatScopeLabel, STRINGS } from './i18n.ts';
import { buildPreviewDataset } from './previewData.ts';

type MainTab = 'finder' | 'analytics' | 'graph';
type FilterKind = 'all' | 'enabled' | 'disabled' | 'issues' | 'updates';
type SortKey = 'name' | 'publishedAt' | 'installedAt' | 'totalUses' | 'last30dUses';

const mcpApp = new App({ name: 'Better-skills-manager', version: '1.1.0' }, {});

function parseToolResultJson<T>(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): T | null {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as T;
  }
  const textBlock = result.content?.find((c) => c.type === 'text' && c.text);
  if (textBlock?.text) {
    try {
      return JSON.parse(textBlock.text) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function formatDateShort(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const AppRoot: React.FC = () => {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isPreviewMode = urlParams.get('preview') === '1';
  const paramLang = urlParams.get('lang');
  const paramTab = urlParams.get('tab');

  const [lang, setLang] = useState<UiLang>(
    paramLang === 'en' || paramLang === 'zh-TW' ? paramLang : detectInitialLang(),
  );
  const t = STRINGS[lang];

  const [connected, setConnected] = useState(isPreviewMode);
  const [canUpdateContext, setCanUpdateContext] = useState(isPreviewMode);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [previewDetails, setPreviewDetails] = useState<Record<string, SkillDetail>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SkillDetail | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>(
    paramTab === 'analytics' || paramTab === 'graph' || paramTab === 'finder' ? paramTab : 'finder',
  );
  const [selectedScopeId, setSelectedScopeId] = useState<string>('ALL_USER');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalUses');
  const [sortAsc, setSortAsc] = useState(false);

  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [narrowShowEditor, setNarrowShowEditor] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSkillScope, setNewSkillScope] = useState('global');
  const [newSkillCat, setNewSkillCat] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillTemplate, setNewSkillTemplate] = useState<'blank' | 'script-workflow' | 'reference-guide'>('blank');

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderScopeId, setFolderScopeId] = useState('global');
  const [folderPathInput, setFolderPathInput] = useState('');

  const [showScopeModal, setShowScopeModal] = useState(false);
  const [scopeAction, setScopeAction] = useState<'add_workspace' | 'add_external'>('add_workspace');
  const [scopePathInput, setScopePathInput] = useState('');
  const [scopeLabelInput, setScopeLabelInput] = useState('');

  const seqRef = useRef<number>(0);
  const initializedScopeRef = useRef<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? null : curr)), 2800);
  }, []);

  const callTool = useCallback(async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = await mcpApp.callServerTool({ name, arguments: args });
    if (res.isError) {
      const msg = res.content?.find((c) => c.type === 'text')?.text || 'Operation failed';
      throw new Error(msg);
    }
    const parsed = parseToolResultJson<T>(res as never);
    if (!parsed) throw new Error('Invalid server response');
    return parsed;
  }, []);

  const loadSnapshot = useCallback(async (forceRefresh = false) => {
    const res = await callTool<{ snapshot: SnapshotPayload }>('app_get_snapshot', { forceRefresh });
    seqRef.current = res.snapshot.seq;
    if (res.snapshot.uiLang) {
      setLang(res.snapshot.uiLang);
    }
    if (!initializedScopeRef.current) {
      initializedScopeRef.current = true;
      const hasUserSkills = res.snapshot.skills.some((s) => !s.readOnly);
      if (!hasUserSkills) {
        setSelectedScopeId('ALL');
      }
    }
    setSnapshot(res.snapshot);
    return res.snapshot;
  }, [callTool]);

  const loadDetail = useCallback(async (id: string) => {
    if (isPreviewMode) {
      setSelectedDetail(previewDetails[id] ?? null);
      return previewDetails[id];
    }
    const res = await callTool<{ detail: SkillDetail }>('app_get_skill_detail', { id });
    setSelectedDetail(res.detail);
    return res.detail;
  }, [callTool, isPreviewMode, previewDetails]);

  // Preview mode initialization or MCP Apps connection
  useEffect(() => {
    if (isPreviewMode) {
      const theme = urlParams.get('theme');
      if (theme === 'dark' || theme === 'light') {
        applyDocumentTheme(theme);
      } else {
        applyDocumentTheme('light');
      }
      const preview = buildPreviewDataset(lang);
      setSnapshot(preview.snapshot);
      setPreviewDetails(preview.details);
      const firstId = preview.snapshot.skills[0]?.id ?? null;
      setSelectedSkillId((curr) => curr || firstId);
      if (firstId && preview.details[firstId]) {
        setSelectedDetail(preview.details[firstId]);
      }
      return;
    }

    mcpApp.ontoolinput = (params) => {
      const args = params.arguments as Record<string, unknown> | undefined;
      if (args?.tab === 'analytics' || args?.tab === 'graph' || args?.tab === 'finder') {
        setMainTab(args.tab);
      }
      if (typeof args?.scopeId === 'string') setSelectedScopeId(args.scopeId);
      if (typeof args?.skillId === 'string') setSelectedSkillId(args.skillId);
    };

    mcpApp.ontoolresult = (result) => {
      const sc = result.structuredContent as Record<string, unknown> | undefined;
      if (sc?.initialTab === 'analytics' || sc?.initialTab === 'graph' || sc?.initialTab === 'finder') {
        setMainTab(sc.initialTab);
      }
      if (typeof sc?.initialScopeId === 'string') setSelectedScopeId(sc.initialScopeId);
      if (typeof sc?.initialSkillId === 'string') {
        setSelectedSkillId(sc.initialSkillId);
        setNarrowShowEditor(true);
      }
    };

    mcpApp.onhostcontextchanged = (ctx) => {
      if (ctx.theme) applyDocumentTheme(ctx.theme);
      if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    };

    mcpApp.connect().then(async () => {
      const ctx = mcpApp.getHostContext();
      if (ctx?.theme) applyDocumentTheme(ctx.theme);
      if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
      if (ctx?.locale) {
        setLang((curr) => curr || detectInitialLang(ctx.locale));
      }
      const caps = mcpApp.getHostCapabilities();
      setCanUpdateContext(Boolean(caps?.updateModelContext));
      setConnected(true);
      try {
        await loadSnapshot(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  }, [isPreviewMode, lang, loadSnapshot, showToast, urlParams]);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!connected || isPreviewMode) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await callTool<{ seq: number; changed: boolean }>('app_poll_changes', {
          sinceSeq: seqRef.current,
        });
        if (res.changed) {
          await loadSnapshot(true);
          if (selectedSkillId) {
            loadDetail(selectedSkillId).catch(() => undefined);
          }
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [connected, isPreviewMode, callTool, loadSnapshot, loadDetail, selectedSkillId]);

  useEffect(() => {
    if (!selectedSkillId || !connected) return;
    if (isPreviewMode) {
      setSelectedDetail(previewDetails[selectedSkillId] ?? null);
      return;
    }
    loadDetail(selectedSkillId).catch(() => {
      setSelectedDetail(null);
    });
  }, [selectedSkillId, connected, isPreviewMode, previewDetails, loadDetail]);

  const handleToggleLanguage = async (nextLang: UiLang) => {
    setLang(nextLang);
    if (isPreviewMode) {
      const preview = buildPreviewDataset(nextLang);
      setSnapshot(preview.snapshot);
      setPreviewDetails(preview.details);
      if (selectedSkillId && preview.details[selectedSkillId]) {
        setSelectedDetail(preview.details[selectedSkillId]);
      }
      return;
    }
    try {
      await callTool('app_set_preferences', { uiLang: nextLang });
    } catch {
      // keep local state even if server call fails
    }
  };

  const isNarrow = windowWidth < 820;

  const filteredSkills = useMemo(() => {
    if (!snapshot) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = snapshot.skills.filter((s) => {
      if (selectedScopeId === 'ALL_USER') {
        if (s.readOnly) return false;
      } else if (selectedScopeId !== 'ALL') {
        if (s.scopeId !== selectedScopeId) return false;
      }

      if (selectedCategory) {
        if (s.categoryPath !== selectedCategory && !s.categoryPath.startsWith(`${selectedCategory}/`)) {
          return false;
        }
      }

      if (filterKind === 'enabled' && !s.enabled) return false;
      if (filterKind === 'disabled' && s.enabled) return false;
      if (filterKind === 'issues' && s.validationStatus === 'ok') return false;
      if (filterKind === 'updates' && !s.sourceMeta.hasUpdate) return false;

      if (q) {
        const hay = `${s.name} ${s.description} ${s.categoryPath} ${s.scopeLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'publishedAt') cmp = a.publishedAt.localeCompare(b.publishedAt);
      else if (sortKey === 'installedAt') cmp = a.installedAt.localeCompare(b.installedAt);
      else if (sortKey === 'totalUses') cmp = a.totalUses - b.totalUses;
      else if (sortKey === 'last30dUses') cmp = a.last30dUses - b.last30dUses;
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [snapshot, selectedScopeId, selectedCategory, filterKind, searchQuery, sortKey, sortAsc]);

  useEffect(() => {
    if (!isNarrow && !selectedSkillId && filteredSkills.length > 0) {
      setSelectedSkillId(filteredSkills[0].id);
    }
  }, [isNarrow, selectedSkillId, filteredSkills]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  };

  const handleSelectSkill = (id: string) => {
    setSelectedSkillId(id);
    setMainTab('finder');
    if (isNarrow) setNarrowShowEditor(true);
  };

  const handleAttachToChat = async (skills: SkillSummary[]) => {
    if (!canUpdateContext || skills.length === 0) return;
    if (isPreviewMode) {
      showToast(t.toastAttached(skills.length));
      return;
    }
    const summaryText = skills
      .map((s) => `- Skill「${s.name}」(${s.skillMdPath}): ${s.description}`)
      .join('\n');
    await mcpApp.updateModelContext({
      content: [
        {
          type: 'text',
          text: `Attached Skills from Better-skills-manager:\n${summaryText}`,
        },
      ],
    });
    await callTool('app_record_panel_attach', { ids: skills.map((s) => s.id) });
    await loadSnapshot(true);
    showToast(t.toastAttached(skills.length));
  };

  const handleOpenNativeFile = async (absPath: string) => {
    if (isPreviewMode) return;
    try {
      const req = {
        method: 'com.google.antigravity/toggle-aux-pane',
        params: { tabType: 'fileView', uri: `file://${absPath}` },
      } as unknown as Parameters<typeof mcpApp.request>[0];
      await mcpApp.request(
        req,
        z.object({ isError: z.boolean().optional() }).passthrough(),
      );
    } catch {
      await callTool('app_reveal_in_finder', { path: absPath });
    }
  };

  const renderCategoryTree = (nodes: CategoryNode[], depth = 0): React.ReactNode => {
    return nodes.map((node) => {
      const isSelected = selectedScopeId === node.scopeId && selectedCategory === node.path;
      const dropKey = `${node.scopeId}::${node.path}`;
      return (
        <div key={node.id}>
          <div
            className={`tree-row ${isSelected ? 'selected' : ''} ${dragOverTarget === dropKey ? 'drag-over' : ''}`}
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => {
              setSelectedScopeId(node.scopeId);
              setSelectedCategory(node.path);
              setFilterKind('all');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverTarget(dropKey);
            }}
            onDragLeave={() => setDragOverTarget(null)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverTarget(null);
              const draggedId = e.dataTransfer.getData('text/skill-id');
              if (!draggedId || isPreviewMode) return;
              try {
                const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                  'app_move_skill',
                  { id: draggedId, targetScopeId: node.scopeId, targetCategoryPath: node.path },
                );
                seqRef.current = res.snapshot.seq;
                setSnapshot(res.snapshot);
                setSelectedSkillId(res.detail.id);
                setSelectedDetail(res.detail);
                showToast(t.toastMovedFolder(node.path));
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📁 {node.name}
            </span>
            <span className="count-chip">{node.skillCount}</span>
          </div>
          {node.children.length > 0 && renderCategoryTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  if (!snapshot) {
    return (
      <div className="empty-state">
        <strong>{t.loadingTitle}</strong>
        <span style={{ fontSize: 12 }}>{t.loadingDesc}</span>
      </div>
    );
  }

  const issueCount = snapshot.skills.filter((s) => !s.readOnly && s.validationStatus !== 'ok').length;
  const updateCount = snapshot.skills.filter((s) => s.sourceMeta.hasUpdate).length;
  const disabledCount = snapshot.skills.filter((s) => !s.enabled).length;

  const docViewProps = selectedDetail
    ? {
        detail: selectedDetail,
        scopes: snapshot.scopes,
        folders: snapshot.folders,
        allSkills: snapshot.skills,
        lang,
        canAttachContext: canUpdateContext,
        onSaveStructured: async (fields: {
          id: string;
          name: string;
          description: string;
          version: string;
          repository: string;
          body: string;
        }) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_save_skill',
            { ...fields, mode: 'structured' },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
        },
        onSaveRaw: async (id: string, raw: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_save_skill',
            { id, mode: 'raw', rawContent: raw },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastSavedRaw);
        },
        onToggleEnabled: async (id: string, enabled: boolean) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_toggle_skill',
            { id, enabled },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedSkillId(res.detail.id);
          setSelectedDetail(res.detail);
          showToast(enabled ? t.toastEnabled : t.toastDisabled);
        },
        onMoveCategory: async (id: string, targetCategoryPath: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_move_skill',
            { id, targetCategoryPath },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedSkillId(res.detail.id);
          setSelectedDetail(res.detail);
          showToast(t.toastMovedFolder(targetCategoryPath));
        },
        onCopyToScope: async (id: string, targetScopeId: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_move_skill',
            { id, targetScopeId, targetCategoryPath: '', copy: true },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedScopeId(targetScopeId);
          setSelectedSkillId(res.detail.id);
          setSelectedDetail(res.detail);
          showToast(t.toastCopied(res.detail.name));
        },
        onDelete: async (id: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ snapshot: SnapshotPayload }>('app_delete_skill', { id });
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedSkillId(null);
          setSelectedDetail(null);
          setNarrowShowEditor(false);
          showToast(t.toastDeleted);
        },
        onFixIssue: async (id: string, action: 'create_attachment' | 'slugify_name', missingRelPath?: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_fix_issue',
            { id, action, missingRelPath },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastFixed);
        },
        onReadAttachment: async (id: string, relPath: string) => {
          if (isPreviewMode) {
            return { content: `# ${relPath}\n\nPreview attachment content.`, isBinary: false, size: 42 };
          }
          const res = await callTool<{ file: { content: string; isBinary: boolean; size: number } }>(
            'app_read_attachment',
            { id, relPath },
          );
          return res.file;
        },
        onSaveAttachment: async (id: string, relPath: string, content: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_save_attachment',
            { id, relPath, content },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastSavedAttach(relPath));
        },
        onDeleteAttachment: async (id: string, relPath: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_delete_attachment',
            { id, relPath },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastDeletedAttach(relPath));
        },
        onBindSource: async (id: string, sourceType: 'git' | 'local_dir' | 'local_original', location?: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_bind_source',
            { id, sourceType, location },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastBoundSource);
        },
        onCheckUpdate: async (id: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ updatesAvailable: number; snapshot: SnapshotPayload }>(
            'app_check_updates',
            { id },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          await loadDetail(id);
          showToast(res.updatesAvailable > 0 ? t.toastFoundUpdate : t.toastUpToDate);
        },
        onApplyUpdate: async (id: string) => {
          if (isPreviewMode) return;
          const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
            'app_apply_update',
            { id },
          );
          seqRef.current = res.snapshot.seq;
          setSnapshot(res.snapshot);
          setSelectedDetail(res.detail);
          showToast(t.toastUpdated);
        },
        onRevealInFinder: async (path: string) => {
          if (isPreviewMode) return;
          await callTool('app_reveal_in_finder', { path });
        },
        onOpenNativeFile: handleOpenNativeFile,
        onAttachToChat: handleAttachToChat,
        onSelectSkill: handleSelectSkill,
      }
    : null;

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-brand">
          <span>📚</span>
          <span>{t.brand}</span>
        </div>

        <div className="tab-group">
          <button
            className={`tab-btn ${mainTab === 'finder' ? 'active' : ''}`}
            onClick={() => setMainTab('finder')}
          >
            {t.tabFinder}
          </button>
          <button
            className={`tab-btn ${mainTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setMainTab('analytics')}
          >
            {t.tabAnalytics}
          </button>
          <button
            className={`tab-btn ${mainTab === 'graph' ? 'active' : ''}`}
            onClick={() => setMainTab('graph')}
          >
            {t.tabGraph} ({snapshot.graphEdges.length})
          </button>
        </div>

        {mainTab === 'finder' && (
          <input
            className="search-box"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <div className="tab-group" title="Switch UI Language / 切換介面語言">
            <button
              className={`tab-btn ${lang === 'en' ? 'active' : ''}`}
              style={{ padding: '3px 7px', fontSize: 11 }}
              onClick={() => void handleToggleLanguage('en')}
            >
              EN
            </button>
            <button
              className={`tab-btn ${lang === 'zh-TW' ? 'active' : ''}`}
              style={{ padding: '3px 7px', fontSize: 11 }}
              onClick={() => void handleToggleLanguage('zh-TW')}
            >
              繁中
            </button>
          </div>

          <button
            className="btn btn-sm"
            disabled={checkingAll}
            onClick={async () => {
              if (isPreviewMode) return;
              setCheckingAll(true);
              try {
                const res = await callTool<{ checkedCount: number; updatesAvailable: number; snapshot: SnapshotPayload }>(
                  'app_check_updates',
                  {},
                );
                seqRef.current = res.snapshot.seq;
                setSnapshot(res.snapshot);
                if (selectedSkillId) loadDetail(selectedSkillId).catch(() => undefined);
                showToast(t.toastCheckedAll(res.checkedCount, res.updatesAvailable));
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              } finally {
                setCheckingAll(false);
              }
            }}
          >
            {checkingAll ? t.checkingUpdates : t.checkUpdates}
          </button>

          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              const firstWritable = snapshot.scopes.find((s) => !s.readOnly);
              setNewSkillScope(
                selectedScopeId !== 'ALL' && selectedScopeId !== 'ALL_USER' && selectedScopeId !== 'builtin'
                  ? selectedScopeId
                  : firstWritable?.id || 'global',
              );
              setNewSkillCat(selectedCategory);
              setNewSkillName('');
              setNewSkillDesc('');
              setShowCreateModal(true);
            }}
          >
            {t.newSkillBtn}
          </button>
        </div>
      </div>

      {/* Filter Strip */}
      {mainTab === 'finder' && (
        <div className="filter-strip">
          <button className={`pill ${filterKind === 'all' ? 'active' : ''}`} onClick={() => setFilterKind('all')}>
            {t.filterAll} ({snapshot.skills.length})
          </button>
          <button className={`pill ${filterKind === 'enabled' ? 'active' : ''}`} onClick={() => setFilterKind('enabled')}>
            {t.filterEnabled}
          </button>
          <button className={`pill ${filterKind === 'disabled' ? 'active' : ''}`} onClick={() => setFilterKind('disabled')}>
            {t.filterDisabled} ({disabledCount})
          </button>
          <button className={`pill ${filterKind === 'issues' ? 'active' : ''}`} onClick={() => setFilterKind('issues')}>
            {t.filterIssues} ({issueCount})
          </button>
          <button className={`pill ${filterKind === 'updates' ? 'active' : ''}`} onClick={() => setFilterKind('updates')}>
            {t.filterUpdates} ({updateCount})
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="main-area">
        {mainTab === 'analytics' && (
          <AnalyticsView snapshot={snapshot} lang={lang} onSelectSkill={handleSelectSkill} />
        )}

        {mainTab === 'graph' && (
          <GraphView
            snapshot={snapshot}
            lang={lang}
            onSelectSkill={handleSelectSkill}
            canAttachContext={canUpdateContext}
            onAttachSkills={(skills) => void handleAttachToChat(skills)}
          />
        )}

        {mainTab === 'finder' && !isNarrow && (
          <div className="finder-wide">
            {/* Left Sidebar: Scopes & Category Folders */}
            <div className="pane-col">
              <div className="pane-header">
                <span>{t.foldersHeader}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-sm"
                    title={t.newFolderTitle}
                    onClick={() => {
                      const targetScope =
                        selectedScopeId !== 'ALL' && selectedScopeId !== 'ALL_USER' && selectedScopeId !== 'builtin'
                          ? selectedScopeId
                          : 'global';
                      setFolderScopeId(targetScope);
                      setFolderPathInput(selectedCategory ? `${selectedCategory}/` : '');
                      setShowFolderModal(true);
                    }}
                  >
                    +📁
                  </button>
                  <button
                    className="btn btn-sm"
                    title={t.mountTitle}
                    onClick={() => setShowScopeModal(true)}
                  >
                    {t.mountBtn}
                  </button>
                </div>
              </div>
              <div className="scroll-y tree-section">
                <div
                  className={`tree-row ${selectedScopeId === 'ALL_USER' && !selectedCategory ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedScopeId('ALL_USER');
                    setSelectedCategory('');
                    setFilterKind('all');
                  }}
                >
                  <span>{t.allMySkills}</span>
                  <span className="count-chip">
                    {snapshot.skills.filter((s) => !s.readOnly).length}
                  </span>
                </div>
                <div
                  className={`tree-row ${selectedScopeId === 'ALL' && !selectedCategory ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedScopeId('ALL');
                    setSelectedCategory('');
                    setFilterKind('all');
                  }}
                >
                  <span>{t.allWithBuiltin}</span>
                  <span className="count-chip">{snapshot.skills.length}</span>
                </div>

                {snapshot.scopes.map((sc) => {
                  const scopeFolders = snapshot.folders.filter((f) => f.scopeId === sc.id);
                  const rootDropKey = `${sc.id}::`;
                  const label = formatScopeLabel(sc, lang);
                  return (
                    <div key={sc.id} style={{ marginTop: 8 }}>
                      <div
                        className={`tree-row ${selectedScopeId === sc.id && !selectedCategory ? 'selected' : ''} ${dragOverTarget === rootDropKey ? 'drag-over' : ''}`}
                        onClick={() => {
                          setSelectedScopeId(sc.id);
                          setSelectedCategory('');
                          setFilterKind('all');
                        }}
                        onDragOver={(e) => {
                          if (sc.readOnly) return;
                          e.preventDefault();
                          setDragOverTarget(rootDropKey);
                        }}
                        onDragLeave={() => setDragOverTarget(null)}
                        onDrop={async (e) => {
                          if (sc.readOnly || isPreviewMode) return;
                          e.preventDefault();
                          setDragOverTarget(null);
                          const draggedId = e.dataTransfer.getData('text/skill-id');
                          if (!draggedId) return;
                          try {
                            const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                              'app_move_skill',
                              { id: draggedId, targetScopeId: sc.id, targetCategoryPath: '' },
                            );
                            seqRef.current = res.snapshot.seq;
                            setSnapshot(res.snapshot);
                            setSelectedSkillId(res.detail.id);
                            setSelectedDetail(res.detail);
                            showToast(t.toastMovedFolder(''));
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sc.kind === 'builtin' ? '🔒' : sc.kind === 'global' ? '🏠' : '💼'} {label}
                        </span>
                        <span className="count-chip">{sc.skillCount}</span>
                      </div>
                      {scopeFolders.length > 0 && renderCategoryTree(scopeFolders, 1)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Middle Column: Sortable Skill Documents List */}
            <div className="pane-col">
              <div className="skill-table-header">
                <span className="sort-col" onClick={() => handleSort('name')}>
                  {t.colSkillDoc} {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('publishedAt')}>
                  {t.colDates} {sortKey === 'publishedAt' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('totalUses')}>
                  {t.colTotal} {sortKey === 'totalUses' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('last30dUses')}>
                  {t.col30d} {sortKey === 'last30dUses' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span>{t.colStatus}</span>
              </div>
              <div className="scroll-y">
                {filteredSkills.length === 0 ? (
                  <div className="empty-state">
                    <span>{t.noMatchingSkills}</span>
                  </div>
                ) : (
                  filteredSkills.map((s) => (
                    <div
                      key={s.id}
                      draggable={!s.readOnly}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/skill-id', s.id);
                      }}
                      className={`skill-row ${selectedSkillId === s.id ? 'selected' : ''} ${!s.enabled ? 'disabled-row' : ''}`}
                      onClick={() => setSelectedSkillId(s.id)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>{s.validationStatus === 'error' ? '❌' : s.validationStatus === 'warning' ? '⚠️' : '📄'}</span>
                          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </strong>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.categoryPath ? `📁 ${s.categoryPath} · ` : ''}
                          {s.description || t.noDesc}
                        </div>
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                        <div>{t.pubShort} {formatDateShort(s.publishedAt)}</div>
                        <div>{t.instShort} {formatDateShort(s.installedAt)}</div>
                      </div>

                      <div style={{ fontWeight: 600 }}>{s.totalUses}</div>
                      <div style={{ color: s.last30dUses > 0 ? 'var(--ok)' : 'var(--text-3)' }}>
                        {s.last30dUses}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {s.sourceMeta.hasUpdate ? (
                          <span className="badge badge-warn">{t.badgeUpdate}</span>
                        ) : s.sourceMeta.checkStatus === 'up_to_date' ? (
                          <span className="badge badge-ok">{t.badgeLatest}</span>
                        ) : !s.enabled ? (
                          <span className="badge">{t.badgeDisabled}</span>
                        ) : (
                          <span className="badge">{s.relationCount > 0 ? `🔗${s.relationCount}` : t.badgeOk}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Single-Document Editor */}
            <div className="pane-col">
              {docViewProps ? (
                <DocumentView {...docViewProps} isNarrow={false} />
              ) : (
                <div className="empty-state">
                  <span>{t.emptySelectDoc}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Narrow Side-Pane Master/Detail Mode */}
        {mainTab === 'finder' && isNarrow && (
          <div className="finder-narrow">
            {narrowShowEditor && docViewProps ? (
              <DocumentView
                {...docViewProps}
                isNarrow={true}
                onBack={() => setNarrowShowEditor(false)}
              />
            ) : (
              <>
                <div className="narrow-controls">
                  <select
                    value={selectedScopeId}
                    onChange={(e) => {
                      setSelectedScopeId(e.target.value);
                      setSelectedCategory('');
                    }}
                    style={{ flex: 1, minWidth: 140 }}
                  >
                    <option value="ALL_USER">{t.allMySkills}</option>
                    <option value="ALL">{t.allWithBuiltin}</option>
                    {snapshot.scopes.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {formatScopeLabel(sc, lang)} ({sc.skillCount})
                      </option>
                    ))}
                  </select>

                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    <option value="totalUses">{t.sortByTotal}</option>
                    <option value="last30dUses">{t.sortBy30d}</option>
                    <option value="publishedAt">{t.sortByPub}</option>
                    <option value="installedAt">{t.sortByInst}</option>
                    <option value="name">{t.sortByName}</option>
                  </select>

                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const targetScope =
                        selectedScopeId !== 'ALL' && selectedScopeId !== 'ALL_USER' && selectedScopeId !== 'builtin'
                          ? selectedScopeId
                          : 'global';
                      setFolderScopeId(targetScope);
                      setFolderPathInput('');
                      setShowFolderModal(true);
                    }}
                  >
                    +📁
                  </button>
                  <button className="btn btn-sm" onClick={() => setShowScopeModal(true)}>
                    {t.mountBtn}
                  </button>
                </div>

                <div className="scroll-y">
                  {filteredSkills.length === 0 ? (
                    <div className="empty-state">
                      <span>{t.noMatchingSkills}</span>
                    </div>
                  ) : (
                    filteredSkills.map((s) => {
                      const scObj = snapshot.scopes.find((sc) => sc.id === s.scopeId);
                      const scDisplay = scObj ? formatScopeLabel(scObj, lang) : s.scopeLabel;
                      return (
                        <div
                          key={s.id}
                          className={`skill-card ${selectedSkillId === s.id ? 'selected' : ''}`}
                          onClick={() => handleSelectSkill(s.id)}
                        >
                          <div className="skill-title-line">
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.validationStatus === 'error' ? '❌' : s.validationStatus === 'warning' ? '⚠️' : '📄'} {s.name}
                            </span>
                            <span className="badge">{scDisplay}</span>
                          </div>
                          <div className="skill-desc-clamp">{s.description || t.noDesc}</div>
                          <div className="meta-badges">
                            {s.categoryPath && <span className="badge">📁 {s.categoryPath}</span>}
                            <span className="badge">📅 {t.pubShort} {formatDateShort(s.publishedAt)} / {t.instShort} {formatDateShort(s.installedAt)}</span>
                            <span className="badge">{t.sortTotalShort} {s.totalUses} / {t.sort30dShort} {s.last30dUses}</span>
                            {s.sourceMeta.hasUpdate && <span className="badge badge-warn">{t.updateAvailable}</span>}
                            {!s.enabled && <span className="badge">{t.badgeDisabled}</span>}
                            {s.relationCount > 0 && <span className="badge badge-info">🔗 {s.relationCount}</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Skill Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>{t.modalNewSkillTitle}</strong>
            <div className="field-group">
              <div className="field-label">{t.modalLocation}</div>
              <select
                className="input-text"
                value={newSkillScope}
                onChange={(e) => setNewSkillScope(e.target.value)}
              >
                {snapshot.scopes
                  .filter((s) => !s.readOnly)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatScopeLabel(s, lang)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalFolder}</div>
              <input
                className="input-text"
                placeholder={t.modalFolderPlaceholder}
                value={newSkillCat}
                onChange={(e) => setNewSkillCat(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalSkillName}</div>
              <input
                className="input-text"
                placeholder={t.modalSkillNamePlaceholder}
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalSkillDesc}</div>
              <textarea
                className="textarea-text"
                rows={3}
                placeholder={t.modalSkillDescPlaceholder}
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalTemplate}</div>
              <select
                className="input-text"
                value={newSkillTemplate}
                onChange={(e) =>
                  setNewSkillTemplate(e.target.value as 'blank' | 'script-workflow' | 'reference-guide')
                }
              >
                <option value="blank">{t.tplBlank}</option>
                <option value="script-workflow">{t.tplScript}</option>
                <option value="reference-guide">{t.tplRef}</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowCreateModal(false)}>
                {t.cancelBtn}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (isPreviewMode) {
                    setShowCreateModal(false);
                    return;
                  }
                  try {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_create_skill',
                      {
                        scopeId: newSkillScope,
                        categoryPath: newSkillCat,
                        name: newSkillName || 'new-skill',
                        description: newSkillDesc,
                        template: newSkillTemplate,
                      },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedScopeId(res.detail.scopeId);
                    setSelectedSkillId(res.detail.id);
                    setSelectedDetail(res.detail);
                    if (isNarrow) setNarrowShowEditor(true);
                    setShowCreateModal(false);
                    showToast(t.toastCreatedSkill(res.detail.name));
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                {t.createAndOpenBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Category Folder Modal */}
      {showFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowFolderModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>{t.modalNewFolderTitle}</strong>
            <div className="field-group">
              <div className="field-label">{t.modalScopeBelong}</div>
              <select
                className="input-text"
                value={folderScopeId}
                onChange={(e) => setFolderScopeId(e.target.value)}
              >
                {snapshot.scopes
                  .filter((s) => !s.readOnly)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatScopeLabel(s, lang)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalFolderPathLabel}</div>
              <input
                className="input-text"
                placeholder={t.modalFolderPathPlaceholder}
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowFolderModal(false)}>
                {t.cancelBtn}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (isPreviewMode) {
                    setShowFolderModal(false);
                    return;
                  }
                  try {
                    const res = await callTool<{ snapshot: SnapshotPayload }>('app_manage_folder', {
                      scopeId: folderScopeId,
                      action: 'create',
                      folderPath: folderPathInput,
                    });
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setShowFolderModal(false);
                    showToast(t.toastCreatedFolder(folderPathInput));
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                {t.createFolderBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mount Scope Modal */}
      {showScopeModal && (
        <div className="modal-backdrop" onClick={() => setShowScopeModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>{t.modalMountTitle}</strong>
            <div className="field-group">
              <div className="field-label">{t.modalMountType}</div>
              <select
                className="input-text"
                value={scopeAction}
                onChange={(e) => setScopeAction(e.target.value as 'add_workspace' | 'add_external')}
              >
                <option value="add_workspace">{t.mountTypeWs}</option>
                <option value="add_external">{t.mountTypeExt}</option>
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalMountPath}</div>
              <input
                className="input-text"
                placeholder="/Users/yourname/projects/my-app"
                value={scopePathInput}
                onChange={(e) => setScopePathInput(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">{t.modalMountLabel}</div>
              <input
                className="input-text"
                placeholder={t.modalMountLabelPlaceholder}
                value={scopeLabelInput}
                onChange={(e) => setScopeLabelInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowScopeModal(false)}>
                {t.cancelBtn}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (isPreviewMode) {
                    setShowScopeModal(false);
                    return;
                  }
                  try {
                    const res = await callTool<{ snapshot: SnapshotPayload }>('app_manage_scopes', {
                      action: scopeAction,
                      path: scopePathInput,
                      label: scopeLabelInput,
                    });
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setShowScopeModal(false);
                    setScopePathInput('');
                    setScopeLabelInput('');
                    showToast(t.toastMounted);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                {t.mountConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
};
