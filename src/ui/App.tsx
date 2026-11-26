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
} from '../shared/types.ts';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { DocumentView } from './components/DocumentView.tsx';
import { GraphView } from './components/GraphView.tsx';

type MainTab = 'finder' | 'analytics' | 'graph';
type FilterKind = 'all' | 'enabled' | 'disabled' | 'issues' | 'updates';
type SortKey = 'name' | 'publishedAt' | 'installedAt' | 'totalUses' | 'last30dUses';

const mcpApp = new App({ name: 'Skill 文件庫', version: '1.0.0' }, {});

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
  const [connected, setConnected] = useState(false);
  const [canUpdateContext, setCanUpdateContext] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SkillDetail | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>('finder');
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

  // Modals
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

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? null : curr)), 2800);
  }, []);

  const callTool = useCallback(async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = await mcpApp.callServerTool({ name, arguments: args });
    if (res.isError) {
      const msg = res.content?.find((c) => c.type === 'text')?.text || '操作失敗';
      throw new Error(msg);
    }
    const parsed = parseToolResultJson<T>(res as never);
    if (!parsed) throw new Error('伺服器未回傳有效資料');
    return parsed;
  }, []);

  const loadSnapshot = useCallback(async (forceRefresh = false) => {
    const res = await callTool<{ snapshot: SnapshotPayload }>('app_get_snapshot', { forceRefresh });
    seqRef.current = res.snapshot.seq;
    setSnapshot(res.snapshot);
    return res.snapshot;
  }, [callTool]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await callTool<{ detail: SkillDetail }>('app_get_skill_detail', { id });
    setSelectedDetail(res.detail);
    return res.detail;
  }, [callTool]);

  // Connect to MCP Apps host once on mount
  useEffect(() => {
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
      const caps = mcpApp.getHostCapabilities();
      setCanUpdateContext(Boolean(caps?.updateModelContext));
      setConnected(true);
      try {
        await loadSnapshot(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  }, [loadSnapshot, showToast]);

  // Window resize listener for adaptive narrow vs 3-pane wide mode
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Poll filesystem changes every 2s for real-time 2-way Finder sync
  useEffect(() => {
    if (!connected) return;
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
  }, [connected, callTool, loadSnapshot, loadDetail, selectedSkillId]);

  useEffect(() => {
    if (!selectedSkillId || !connected) return;
    loadDetail(selectedSkillId).catch(() => {
      setSelectedDetail(null);
    });
  }, [selectedSkillId, connected, loadDetail]);

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

  // Auto-select first skill in wide mode if none selected
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
    const summaryText = skills
      .map(
        (s) =>
          `- Skill「${s.name}」(${s.skillMdPath})：${s.description}`,
      )
      .join('\n');
    await mcpApp.updateModelContext({
      content: [
        {
          type: 'text',
          text: `使用者從「Skill 文件庫」附加了以下 Skills 供本輪協作參考：\n${summaryText}`,
        },
      ],
    });
    await callTool('app_record_panel_attach', { ids: skills.map((s) => s.id) });
    await loadSnapshot(true);
    showToast(`已將 ${skills.length} 份 Skill 附加至對話`);
  };

  const handleOpenNativeFile = async (absPath: string) => {
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
              if (!draggedId) return;
              try {
                const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                  'app_move_skill',
                  { id: draggedId, targetScopeId: node.scopeId, targetCategoryPath: node.path },
                );
                seqRef.current = res.snapshot.seq;
                setSnapshot(res.snapshot);
                setSelectedSkillId(res.detail.id);
                setSelectedDetail(res.detail);
                showToast(`已移入資料夾「${node.path}」`);
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
        <strong>正在載入 Skill 文件庫…</strong>
        <span style={{ fontSize: 12 }}>正在掃描本機 Skills、對話使用紀錄與協作關聯</span>
      </div>
    );
  }

  const issueCount = snapshot.skills.filter((s) => !s.readOnly && s.validationStatus !== 'ok').length;
  const updateCount = snapshot.skills.filter((s) => s.sourceMeta.hasUpdate).length;
  const disabledCount = snapshot.skills.filter((s) => !s.enabled).length;

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-brand">
          <span>📚</span>
          <span>Skill 文件庫</span>
        </div>

        <div className="tab-group">
          <button
            className={`tab-btn ${mainTab === 'finder' ? 'active' : ''}`}
            onClick={() => setMainTab('finder')}
          >
            🗂️ 文件管理
          </button>
          <button
            className={`tab-btn ${mainTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setMainTab('analytics')}
          >
            📊 使用時間軸
          </button>
          <button
            className={`tab-btn ${mainTab === 'graph' ? 'active' : ''}`}
            onClick={() => setMainTab('graph')}
          >
            🕸️ 協作關聯 ({snapshot.graphEdges.length})
          </button>
        </div>

        {mainTab === 'finder' && (
          <input
            className="search-box"
            placeholder="搜尋名稱、描述或分類…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button
            className="btn btn-sm"
            disabled={checkingAll}
            onClick={async () => {
              setCheckingAll(true);
              try {
                const res = await callTool<{ checkedCount: number; updatesAvailable: number; snapshot: SnapshotPayload }>(
                  'app_check_updates',
                  {},
                );
                seqRef.current = res.snapshot.seq;
                setSnapshot(res.snapshot);
                if (selectedSkillId) loadDetail(selectedSkillId).catch(() => undefined);
                showToast(`檢查完畢：${res.checkedCount} 份中共有 ${res.updatesAvailable} 份可用更新`);
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              } finally {
                setCheckingAll(false);
              }
            }}
          >
            {checkingAll ? '檢查中…' : '🔄 檢查更新'}
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
            + 新增文件
          </button>
        </div>
      </div>

      {/* Filter Strip */}
      {mainTab === 'finder' && (
        <div className="filter-strip">
          <button className={`pill ${filterKind === 'all' ? 'active' : ''}`} onClick={() => setFilterKind('all')}>
            全部 ({snapshot.skills.length})
          </button>
          <button className={`pill ${filterKind === 'enabled' ? 'active' : ''}`} onClick={() => setFilterKind('enabled')}>
            啟用中
          </button>
          <button className={`pill ${filterKind === 'disabled' ? 'active' : ''}`} onClick={() => setFilterKind('disabled')}>
            已停用封存 ({disabledCount})
          </button>
          <button className={`pill ${filterKind === 'issues' ? 'active' : ''}`} onClick={() => setFilterKind('issues')}>
            ⚠️ 需修正 ({issueCount})
          </button>
          <button className={`pill ${filterKind === 'updates' ? 'active' : ''}`} onClick={() => setFilterKind('updates')}>
            ⬆️ 有更新 ({updateCount})
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="main-area">
        {mainTab === 'analytics' && (
          <AnalyticsView snapshot={snapshot} onSelectSkill={handleSelectSkill} />
        )}

        {mainTab === 'graph' && (
          <GraphView
            snapshot={snapshot}
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
                <span>位置與分類資料夾</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-sm"
                    title="建立新分類資料夾"
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
                    title="掛載專案或外部通用目錄"
                    onClick={() => setShowScopeModal(true)}
                  >
                    +掛載
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
                  <span>🌟 我的全部 Skills</span>
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
                  <span>📚 含內建總覽</span>
                  <span className="count-chip">{snapshot.skills.length}</span>
                </div>

                {snapshot.scopes.map((sc) => {
                  const scopeFolders = snapshot.folders.filter((f) => f.scopeId === sc.id);
                  const rootDropKey = `${sc.id}::`;
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
                          if (sc.readOnly) return;
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
                            showToast(`已移至「${sc.label}」根目錄`);
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sc.kind === 'builtin' ? '🔒' : sc.kind === 'global' ? '🏠' : '💼'} {sc.label}
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
                  Skill 文件 {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('publishedAt')}>
                  發布/安裝 {sortKey === 'publishedAt' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('totalUses')}>
                  總次數 {sortKey === 'totalUses' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span className="sort-col" onClick={() => handleSort('last30dUses')}>
                  30天 {sortKey === 'last30dUses' ? (sortAsc ? '↑' : '↓') : ''}
                </span>
                <span>更新 / 狀態</span>
              </div>
              <div className="scroll-y">
                {filteredSkills.length === 0 ? (
                  <div className="empty-state">
                    <span>此篩選條件下沒有 Skill 文件</span>
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
                          {s.description || '(無描述)'}
                        </div>
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                        <div>發 {formatDateShort(s.publishedAt)}</div>
                        <div>裝 {formatDateShort(s.installedAt)}</div>
                      </div>

                      <div style={{ fontWeight: 600 }}>{s.totalUses}</div>
                      <div style={{ color: s.last30dUses > 0 ? 'var(--ok)' : 'var(--text-3)' }}>
                        {s.last30dUses}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {s.sourceMeta.hasUpdate ? (
                          <span className="badge badge-warn">有更新</span>
                        ) : s.sourceMeta.checkStatus === 'up_to_date' ? (
                          <span className="badge badge-ok">最新</span>
                        ) : !s.enabled ? (
                          <span className="badge">停用</span>
                        ) : (
                          <span className="badge">{s.relationCount > 0 ? `🔗${s.relationCount}` : '正常'}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Single-Document Editor */}
            <div className="pane-col">
              {selectedDetail ? (
                <DocumentView
                  detail={selectedDetail}
                  scopes={snapshot.scopes}
                  folders={snapshot.folders}
                  allSkills={snapshot.skills}
                  isNarrow={false}
                  canAttachContext={canUpdateContext}
                  onSaveStructured={async (fields) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_save_skill',
                      { ...fields, mode: 'structured' },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                  }}
                  onSaveRaw={async (id, raw) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_save_skill',
                      { id, mode: 'raw', rawContent: raw },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast('已儲存原始 SKILL.md');
                  }}
                  onToggleEnabled={async (id, enabled) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_toggle_skill',
                      { id, enabled },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedSkillId(res.detail.id);
                    setSelectedDetail(res.detail);
                    showToast(enabled ? '已重新啟用並歸位原分類' : '已移入 _disabled 封存夾');
                  }}
                  onMoveCategory={async (id, targetCategoryPath) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_move_skill',
                      { id, targetCategoryPath },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedSkillId(res.detail.id);
                    setSelectedDetail(res.detail);
                    showToast(`已分類至 ${targetCategoryPath || '根目錄'}`);
                  }}
                  onCopyToScope={async (id, targetScopeId) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_move_skill',
                      { id, targetScopeId, targetCategoryPath: '', copy: true },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedScopeId(targetScopeId);
                    setSelectedSkillId(res.detail.id);
                    setSelectedDetail(res.detail);
                    showToast(`已複製掛載：${res.detail.name}`);
                  }}
                  onDelete={async (id) => {
                    const res = await callTool<{ snapshot: SnapshotPayload }>('app_delete_skill', { id });
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedSkillId(null);
                    setSelectedDetail(null);
                    showToast('已刪除 Skill 文件');
                  }}
                  onFixIssue={async (id, action, missingRelPath) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_fix_issue',
                      { id, action, missingRelPath },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast('已完成格式修復');
                  }}
                  onReadAttachment={async (id, relPath) => {
                    const res = await callTool<{ file: { content: string; isBinary: boolean; size: number } }>(
                      'app_read_attachment',
                      { id, relPath },
                    );
                    return res.file;
                  }}
                  onSaveAttachment={async (id, relPath, content) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_save_attachment',
                      { id, relPath, content },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast(`已儲存附件 ${relPath}`);
                  }}
                  onDeleteAttachment={async (id, relPath) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_delete_attachment',
                      { id, relPath },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast(`已刪除附件 ${relPath}`);
                  }}
                  onBindSource={async (id, sourceType, location) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_bind_source',
                      { id, sourceType, location },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast('已更新來源設定');
                  }}
                  onCheckUpdate={async (id) => {
                    const res = await callTool<{ updatesAvailable: number; snapshot: SnapshotPayload }>(
                      'app_check_updates',
                      { id },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    await loadDetail(id);
                    showToast(res.updatesAvailable > 0 ? '發現可用更新！' : '已是最新版本');
                  }}
                  onApplyUpdate={async (id) => {
                    const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                      'app_apply_update',
                      { id },
                    );
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setSelectedDetail(res.detail);
                    showToast('已備份舊版並完成更新！');
                  }}
                  onRevealInFinder={async (path) => {
                    await callTool('app_reveal_in_finder', { path });
                  }}
                  onOpenNativeFile={handleOpenNativeFile}
                  onAttachToChat={handleAttachToChat}
                  onSelectSkill={handleSelectSkill}
                />
              ) : (
                <div className="empty-state">
                  <span>點擊左側任一 Skill 文件即可像一般文件般讀寫與管理</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Narrow Side-Pane Master/Detail Mode */}
        {mainTab === 'finder' && isNarrow && (
          <div className="finder-narrow">
            {narrowShowEditor && selectedDetail ? (
              <DocumentView
                detail={selectedDetail}
                scopes={snapshot.scopes}
                folders={snapshot.folders}
                allSkills={snapshot.skills}
                isNarrow={true}
                canAttachContext={canUpdateContext}
                onBack={() => setNarrowShowEditor(false)}
                onSaveStructured={async (fields) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_save_skill',
                    { ...fields, mode: 'structured' },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                }}
                onSaveRaw={async (id, raw) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_save_skill',
                    { id, mode: 'raw', rawContent: raw },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                  showToast('已儲存原始 SKILL.md');
                }}
                onToggleEnabled={async (id, enabled) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_toggle_skill',
                    { id, enabled },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedSkillId(res.detail.id);
                  setSelectedDetail(res.detail);
                  showToast(enabled ? '已重新啟用' : '已停用封存');
                }}
                onMoveCategory={async (id, targetCategoryPath) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_move_skill',
                    { id, targetCategoryPath },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedSkillId(res.detail.id);
                  setSelectedDetail(res.detail);
                }}
                onCopyToScope={async (id, targetScopeId) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_move_skill',
                    { id, targetScopeId, targetCategoryPath: '', copy: true },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedSkillId(res.detail.id);
                  setSelectedDetail(res.detail);
                  showToast(`已複製掛載：${res.detail.name}`);
                }}
                onDelete={async (id) => {
                  const res = await callTool<{ snapshot: SnapshotPayload }>('app_delete_skill', { id });
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedSkillId(null);
                  setSelectedDetail(null);
                  setNarrowShowEditor(false);
                }}
                onFixIssue={async (id, action, missingRelPath) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_fix_issue',
                    { id, action, missingRelPath },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                  showToast('已完成格式修復');
                }}
                onReadAttachment={async (id, relPath) => {
                  const res = await callTool<{ file: { content: string; isBinary: boolean; size: number } }>(
                    'app_read_attachment',
                    { id, relPath },
                  );
                  return res.file;
                }}
                onSaveAttachment={async (id, relPath, content) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_save_attachment',
                    { id, relPath, content },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                  showToast(`已儲存附件 ${relPath}`);
                }}
                onDeleteAttachment={async (id, relPath) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_delete_attachment',
                    { id, relPath },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                }}
                onBindSource={async (id, sourceType, location) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_bind_source',
                    { id, sourceType, location },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                }}
                onCheckUpdate={async (id) => {
                  const res = await callTool<{ updatesAvailable: number; snapshot: SnapshotPayload }>(
                    'app_check_updates',
                    { id },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  await loadDetail(id);
                  showToast(res.updatesAvailable > 0 ? '發現可用更新！' : '已是最新版本');
                }}
                onApplyUpdate={async (id) => {
                  const res = await callTool<{ detail: SkillDetail; snapshot: SnapshotPayload }>(
                    'app_apply_update',
                    { id },
                  );
                  seqRef.current = res.snapshot.seq;
                  setSnapshot(res.snapshot);
                  setSelectedDetail(res.detail);
                  showToast('已更新完成！');
                }}
                onRevealInFinder={async (path) => {
                  await callTool('app_reveal_in_finder', { path });
                }}
                onOpenNativeFile={handleOpenNativeFile}
                onAttachToChat={handleAttachToChat}
                onSelectSkill={handleSelectSkill}
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
                    <option value="ALL_USER">🌟 我的全部 Skills</option>
                    <option value="ALL">📚 含內建總覽</option>
                    {snapshot.scopes.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.label} ({sc.skillCount})
                      </option>
                    ))}
                  </select>

                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    <option value="totalUses">依總使用排序</option>
                    <option value="last30dUses">依近30天排序</option>
                    <option value="publishedAt">依發布日期</option>
                    <option value="installedAt">依安裝日期</option>
                    <option value="name">依名稱 A-Z</option>
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
                    +掛載
                  </button>
                </div>

                <div className="scroll-y">
                  {filteredSkills.length === 0 ? (
                    <div className="empty-state">
                      <span>沒有符合條件的 Skill 文件</span>
                    </div>
                  ) : (
                    filteredSkills.map((s) => (
                      <div
                        key={s.id}
                        className={`skill-card ${selectedSkillId === s.id ? 'selected' : ''}`}
                        onClick={() => handleSelectSkill(s.id)}
                      >
                        <div className="skill-title-line">
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.validationStatus === 'error' ? '❌' : s.validationStatus === 'warning' ? '⚠️' : '📄'} {s.name}
                          </span>
                          <span className="badge">{s.scopeLabel}</span>
                        </div>
                        <div className="skill-desc-clamp">{s.description || '(尚未填寫觸發描述)'}</div>
                        <div className="meta-badges">
                          {s.categoryPath && <span className="badge">📁 {s.categoryPath}</span>}
                          <span className="badge">📅 發 {formatDateShort(s.publishedAt)} / 裝 {formatDateShort(s.installedAt)}</span>
                          <span className="badge">總 {s.totalUses} / 30天 {s.last30dUses}</span>
                          {s.sourceMeta.hasUpdate && <span className="badge badge-warn">⬆️ 有更新</span>}
                          {!s.enabled && <span className="badge">已停用</span>}
                          {s.relationCount > 0 && <span className="badge badge-info">🔗 {s.relationCount}</span>}
                        </div>
                      </div>
                    ))
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
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>+ 新增 Skill 文件</strong>
            <div className="field-group">
              <div className="field-label">儲存位置</div>
              <select
                className="input-text"
                value={newSkillScope}
                onChange={(e) => setNewSkillScope(e.target.value)}
              >
                {snapshot.scopes
                  .filter((s) => !s.readOnly)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">分類資料夾 (選填，例如：開發/前端)</div>
              <input
                className="input-text"
                placeholder="留空代表放在根目錄"
                value={newSkillCat}
                onChange={(e) => setNewSkillCat(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">Skill 名稱</div>
              <input
                className="input-text"
                placeholder="例如：deploy-helper"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">觸發描述 (告訴 Agent 何時使用)</div>
              <textarea
                className="textarea-text"
                rows={3}
                placeholder="例如：當使用者要求部署服務或檢查發布設定時啟用此 Skill。"
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">初始範本</div>
              <select
                className="input-text"
                value={newSkillTemplate}
                onChange={(e) =>
                  setNewSkillTemplate(e.target.value as 'blank' | 'script-workflow' | 'reference-guide')
                }
              >
                <option value="blank">空白文件（僅 SKILL.md）</option>
                <option value="script-workflow">附帶執行腳本（含 scripts/run.sh）</option>
                <option value="reference-guide">附帶參考手冊（含 references/guide.md）</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
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
                    showToast(`已建立「${res.detail.name}」`);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                建立並開啟編輯
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Category Folder Modal */}
      {showFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowFolderModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>📁 新增分類資料夾</strong>
            <div className="field-group">
              <div className="field-label">所屬範圍</div>
              <select
                className="input-text"
                value={folderScopeId}
                onChange={(e) => setFolderScopeId(e.target.value)}
              >
                {snapshot.scopes
                  .filter((s) => !s.readOnly)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">資料夾路徑（支援多層，例如：前端/React）</div>
              <input
                className="input-text"
                placeholder="例如：自動化工具"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowFolderModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const res = await callTool<{ snapshot: SnapshotPayload }>('app_manage_folder', {
                      scopeId: folderScopeId,
                      action: 'create',
                      folderPath: folderPathInput,
                    });
                    seqRef.current = res.snapshot.seq;
                    setSnapshot(res.snapshot);
                    setShowFolderModal(false);
                    showToast(`已建立分類資料夾「${folderPathInput}」`);
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                建立資料夾
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mount Scope Modal */}
      {showScopeModal && (
        <div className="modal-backdrop" onClick={() => setShowScopeModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: 15, display: 'block', marginBottom: 10 }}>💼 掛載專案或外部 Skill 目錄</strong>
            <div className="field-group">
              <div className="field-label">目錄類型</div>
              <select
                className="input-text"
                value={scopeAction}
                onChange={(e) => setScopeAction(e.target.value as 'add_workspace' | 'add_external')}
              >
                <option value="add_workspace">專案 Workspace 根目錄（自動管理 .agents/skills）</option>
                <option value="add_external">外部通用 Skills 目錄（例如 ~/.claude/skills）</option>
              </select>
            </div>
            <div className="field-group">
              <div className="field-label">目錄完整路徑</div>
              <input
                className="input-text"
                placeholder="/Users/yourname/projects/my-app"
                value={scopePathInput}
                onChange={(e) => setScopePathInput(e.target.value)}
              />
            </div>
            <div className="field-group">
              <div className="field-label">顯示名稱 (選填)</div>
              <input
                className="input-text"
                placeholder="例如：我的網站專案"
                value={scopeLabelInput}
                onChange={(e) => setScopeLabelInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setShowScopeModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
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
                    showToast('已掛載目錄');
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                掛載目錄
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
};
