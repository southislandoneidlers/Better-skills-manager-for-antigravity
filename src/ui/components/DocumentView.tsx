import React, { useEffect, useRef, useState } from 'react';
import type { CategoryNode, ScopeInfo, SkillDetail, SkillSummary } from '../../shared/types.ts';
import { Heatmap365 } from './Heatmap365.tsx';

interface DocumentViewProps {
  detail: SkillDetail;
  scopes: ScopeInfo[];
  folders: CategoryNode[];
  allSkills: SkillSummary[];
  isNarrow: boolean;
  canAttachContext: boolean;
  onBack?: () => void;
  onSaveStructured: (fields: {
    id: string;
    name: string;
    description: string;
    version: string;
    repository: string;
    body: string;
  }) => Promise<void>;
  onSaveRaw: (id: string, rawContent: string) => Promise<void>;
  onToggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  onMoveCategory: (id: string, targetCategoryPath: string) => Promise<void>;
  onCopyToScope: (id: string, targetScopeId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFixIssue: (id: string, action: 'create_attachment' | 'slugify_name', missingRelPath?: string) => Promise<void>;
  onReadAttachment: (id: string, relPath: string) => Promise<{ content: string; isBinary: boolean; size: number }>;
  onSaveAttachment: (id: string, relPath: string, content: string) => Promise<void>;
  onDeleteAttachment: (id: string, relPath: string) => Promise<void>;
  onBindSource: (id: string, sourceType: 'git' | 'local_dir' | 'local_original', location?: string) => Promise<void>;
  onCheckUpdate: (id: string) => Promise<void>;
  onApplyUpdate: (id: string) => Promise<void>;
  onRevealInFinder: (path: string) => Promise<void>;
  onOpenNativeFile: (absPath: string) => Promise<void>;
  onAttachToChat: (skills: SkillSummary[]) => Promise<void>;
  onSelectSkill: (id: string) => void;
}

function formatDateShort(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function flattenCategories(nodes: CategoryNode[], scopeId: string): string[] {
  const out: string[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const n of list) {
      if (n.scopeId === scopeId) {
        out.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export const DocumentView: React.FC<DocumentViewProps> = ({
  detail,
  scopes,
  folders,
  allSkills,
  isNarrow,
  canAttachContext,
  onBack,
  onSaveStructured,
  onSaveRaw,
  onToggleEnabled,
  onMoveCategory,
  onCopyToScope,
  onDelete,
  onFixIssue,
  onReadAttachment,
  onSaveAttachment,
  onDeleteAttachment,
  onBindSource,
  onCheckUpdate,
  onApplyUpdate,
  onRevealInFinder,
  onOpenNativeFile,
  onAttachToChat,
  onSelectSkill,
}) => {
  const [subTab, setSubTab] = useState<'doc' | 'attachments' | 'usage' | 'relations'>('doc');
  const [rawMode, setRawMode] = useState(false);

  // Form states synced when switching skill ID
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description);
  const [version, setVersion] = useState(detail.version || '');
  const [repository, setRepository] = useState(detail.repository || '');
  const [body, setBody] = useState(detail.body);
  const [rawContent, setRawContent] = useState(detail.rawContent);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');

  // Attachment editor states
  const [selectedAttach, setSelectedAttach] = useState<string | null>(null);
  const [attachContent, setAttachContent] = useState('');
  const [attachIsBinary, setAttachIsBinary] = useState(false);
  const [attachSize, setAttachSize] = useState(0);
  const [newAttachPath, setNewAttachPath] = useState('');
  const [showNewAttach, setShowNewAttach] = useState(false);

  // Source bind popover
  const [showBindSource, setShowBindSource] = useState(false);
  const [bindType, setBindType] = useState<'git' | 'local_dir' | 'local_original'>(
    detail.sourceMeta.sourceType === 'git' || detail.sourceMeta.sourceType === 'local_dir'
      ? detail.sourceMeta.sourceType
      : 'git',
  );
  const [bindLocation, setBindLocation] = useState(
    detail.sourceMeta.sourceUrl || detail.sourceMeta.sourceDir || '',
  );

  // Copy scope selector
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const lastIdRef = useRef(detail.id);

  useEffect(() => {
    if (lastIdRef.current !== detail.id) {
      lastIdRef.current = detail.id;
      setName(detail.name);
      setDescription(detail.description);
      setVersion(detail.version || '');
      setRepository(detail.repository || '');
      setBody(detail.body);
      setRawContent(detail.rawContent);
      setSaveState('saved');
      setSelectedAttach(detail.attachments[0]?.relPath ?? null);
      setShowBindSource(false);
      setShowCopyMenu(false);
      setBindType(
        detail.sourceMeta.sourceType === 'git' || detail.sourceMeta.sourceType === 'local_dir'
          ? detail.sourceMeta.sourceType
          : 'git',
      );
      setBindLocation(detail.sourceMeta.sourceUrl || detail.sourceMeta.sourceDir || '');
    } else if (saveState === 'saved') {
      // External sync update while user wasn't mid-edit
      setName(detail.name);
      setDescription(detail.description);
      setVersion(detail.version || '');
      setRepository(detail.repository || '');
      setBody(detail.body);
      setRawContent(detail.rawContent);
    }
  }, [detail, saveState]);

  useEffect(() => {
    if (!selectedAttach) return;
    let cancelled = false;
    onReadAttachment(detail.id, selectedAttach)
      .then((res) => {
        if (cancelled) return;
        setAttachContent(res.content);
        setAttachIsBinary(res.isBinary);
        setAttachSize(res.size);
      })
      .catch(() => {
        if (!cancelled) setAttachContent('');
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, selectedAttach, detail.attachments.length]);

  const flushStructuredSave = async (
    next: { name: string; description: string; version: string; repository: string; body: string },
  ) => {
    if (detail.readOnly) return;
    setSaveState('saving');
    try {
      await onSaveStructured({ id: detail.id, ...next });
      setSaveState('saved');
    } catch {
      setSaveState('dirty');
    }
  };

  const scheduleStructuredSave = (
    next: { name: string; description: string; version: string; repository: string; body: string },
  ) => {
    if (detail.readOnly) return;
    setSaveState('dirty');
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void flushStructuredSave(next);
    }, 400);
  };

  const scopeCategories = flattenCategories(folders, detail.scopeId);
  const writableScopes = scopes.filter((s) => !s.readOnly);

  const sourceLabel =
    detail.sourceMeta.sourceType === 'builtin'
      ? '🔒 內建技能'
      : detail.sourceMeta.sourceType === 'git'
        ? '🔗 Git 遠端'
        : detail.sourceMeta.sourceType === 'local_dir'
          ? '📂 本機上游'
          : '📍 本機原創';

  return (
    <div className="doc-pane">
      {/* Header */}
      <div className="doc-header">
        <div className="doc-header-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isNarrow && onBack && (
              <button className="btn btn-sm" onClick={onBack}>
                ← 返回
              </button>
            )}
            <span style={{ fontSize: 15 }}>📄</span>
            <strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {detail.name}
            </strong>
            <span className="badge">{detail.scopeLabel}</span>
            {!detail.readOnly && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {saveState === 'saving' ? '儲存中…' : saveState === 'dirty' ? '未儲存' : '已自動儲存'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {!detail.readOnly && (
              <label className="switch" title={detail.enabled ? '點擊停用封存' : '點擊重新啟用'}>
                <input
                  type="checkbox"
                  checked={detail.enabled}
                  onChange={(e) => void onToggleEnabled(detail.id, e.target.checked)}
                />
                <span className="slider" />
              </label>
            )}

            {canAttachContext && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void onAttachToChat([detail])}
                title="將此 Skill 附加為對話 Context"
              >
                📎 附加至對話
              </button>
            )}

            <button
              className="btn btn-sm"
              onClick={() => setShowCopyMenu((v) => !v)}
              title="複製掛載到其他範圍（全域或專案）"
            >
              📋 複製掛載
            </button>

            <button
              className="btn btn-sm"
              onClick={() => void onRevealInFinder(detail.skillDir)}
              title="在 macOS Finder 中打開實體目錄"
            >
              Finder
            </button>

            {!detail.readOnly && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  if (window.confirm(`確定要刪除 Skill「${detail.name}」嗎？此動作會移除實體目錄。`)) {
                    void onDelete(detail.id);
                  }
                }}
              >
                刪除
              </button>
            )}
          </div>
        </div>

        {/* Copy to scope menu */}
        {showCopyMenu && (
          <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-1)', border: '1px solid var(--border-1)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12 }}>複製掛載至：</span>
            {writableScopes.map((sc) => (
              <button
                key={sc.id}
                className="btn btn-sm"
                onClick={async () => {
                  setShowCopyMenu(false);
                  await onCopyToScope(detail.id, sc.id);
                }}
              >
                {sc.label}
              </button>
            ))}
          </div>
        )}

        {/* Lifecycle & Update & Category bar */}
        <div className="doc-lifecycle-bar">
          <span>📅 發布：{formatDateShort(detail.publishedAt)}</span>
          <span>📥 安裝：{formatDateShort(detail.installedAt)}</span>
          <span className="badge">{sourceLabel}</span>

          {detail.sourceMeta.checkStatus === 'update_available' && (
            <span className="badge badge-warn">⬆️ 有可用更新</span>
          )}
          {detail.sourceMeta.checkStatus === 'up_to_date' && (
            <span className="badge badge-ok">✅ 已是最新</span>
          )}

          {!detail.readOnly && (
            <>
              <button
                className="btn btn-sm"
                disabled={busyAction}
                onClick={async () => {
                  setBusyAction(true);
                  try {
                    await onCheckUpdate(detail.id);
                  } finally {
                    setBusyAction(false);
                  }
                }}
              >
                🔄 檢查更新
              </button>

              {detail.sourceMeta.hasUpdate && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busyAction}
                  onClick={async () => {
                    setBusyAction(true);
                    try {
                      await onApplyUpdate(detail.id);
                    } finally {
                      setBusyAction(false);
                    }
                  }}
                >
                  ⬆️ 立即更新
                </button>
              )}

              <button
                className="btn btn-sm"
                onClick={() => setShowBindSource((v) => !v)}
              >
                來源設定
              </button>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                📁 分類：
                <select
                  value={detail.categoryPath}
                  onChange={(e) => void onMoveCategory(detail.id, e.target.value)}
                  style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'var(--bg-1)' }}
                >
                  <option value="">(根目錄)</option>
                  {scopeCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {detail.sourceMeta.checkMessage && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
            更新狀態：{detail.sourceMeta.checkMessage}
            {detail.sourceMeta.lastCheckedAt ? `（上次檢查：${formatDateTime(detail.sourceMeta.lastCheckedAt)}）` : ''}
          </div>
        )}

        {showBindSource && !detail.readOnly && (
          <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-1)', border: '1px solid var(--border-1)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={bindType}
                onChange={(e) => setBindType(e.target.value as 'git' | 'local_dir' | 'local_original')}
                style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-1)', background: 'var(--bg-1)' }}
              >
                <option value="git">Git / GitHub 遠端網址</option>
                <option value="local_dir">本機上游目錄路徑</option>
                <option value="local_original">設為本機原創（無上游）</option>
              </select>
              {bindType !== 'local_original' && (
                <input
                  className="input-text"
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder={
                    bindType === 'git'
                      ? 'https://github.com/org/repo/tree/main/skills/my-skill'
                      : '/path/to/upstream/skill-folder'
                  }
                  value={bindLocation}
                  onChange={(e) => setBindLocation(e.target.value)}
                />
              )}
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  await onBindSource(detail.id, bindType, bindLocation);
                  setShowBindSource(false);
                }}
              >
                套用並檢查
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="doc-subtabs">
        <button className={`subtab ${subTab === 'doc' ? 'active' : ''}`} onClick={() => setSubTab('doc')}>
          📄 文件內容
        </button>
        <button className={`subtab ${subTab === 'attachments' ? 'active' : ''}`} onClick={() => setSubTab('attachments')}>
          📎 附件夾 ({detail.attachments.length})
        </button>
        <button className={`subtab ${subTab === 'usage' ? 'active' : ''}`} onClick={() => setSubTab('usage')}>
          📊 使用紀錄 (總 {detail.totalUses} / 30天 {detail.last30dUses})
        </button>
        <button className={`subtab ${subTab === 'relations' ? 'active' : ''}`} onClick={() => setSubTab('relations')}>
          🔗 協作關聯 ({detail.relations.length})
        </button>
      </div>

      {/* Body */}
      <div className="doc-body">
        {/* Validation Health Banner */}
        {detail.issues.length === 0 ? (
          <div className="issue-banner ok">
            ✅ 格式合格 — Frontmatter 與附件連結皆完整，可被 Agent 正常載入
          </div>
        ) : (
          <div className={`issue-banner ${detail.validationStatus === 'error' ? 'err' : 'warn'}`}>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              {detail.validationStatus === 'error' ? '❌ 格式異常（需修正）' : '⚠️ 格式建議優化'}
            </strong>
            {detail.issues.map((issue, idx) => (
              <div key={`${issue.code}-${idx}`} className="issue-item">
                <span>• {issue.message}</span>
                {!detail.readOnly && issue.code === 'broken_link' && issue.missingRelPath && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => void onFixIssue(detail.id, 'create_attachment', issue.missingRelPath)}
                  >
                    {issue.fixLabel || '+ 一鍵建立此附件'}
                  </button>
                )}
                {!detail.readOnly && (issue.code === 'invalid_name' || issue.code === 'missing_name') && (
                  <button
                    className="btn btn-sm btn-warn"
                    onClick={() => void onFixIssue(detail.id, 'slugify_name')}
                  >
                    {issue.fixLabel || '修正命名'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB 1: Document Content */}
        {subTab === 'doc' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {detail.extraFrontmatterKeys.length > 0
                  ? `保留其他 YAML 欄位：${detail.extraFrontmatterKeys.join(', ')}`
                  : '單一文件檢視（自動維持合法 SKILL.md 結構）'}
              </span>
              <div className="tab-group">
                <button className={`tab-btn ${!rawMode ? 'active' : ''}`} onClick={() => setRawMode(false)}>
                  文件表單
                </button>
                <button className={`tab-btn ${rawMode ? 'active' : ''}`} onClick={() => setRawMode(true)}>
                  原始碼 SKILL.md
                </button>
              </div>
            </div>

            {!rawMode ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                  <div className="field-group">
                    <div className="field-label">Skill 識別名稱 (name)</div>
                    <input
                      className="input-text"
                      disabled={detail.readOnly}
                      value={name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setName(val);
                        scheduleStructuredSave({ name: val, description, version, repository, body });
                      }}
                      onBlur={() => saveState === 'dirty' && void flushStructuredSave({ name, description, version, repository, body })}
                    />
                  </div>
                  <div className="field-group">
                    <div className="field-label">版本 (選填)</div>
                    <input
                      className="input-text"
                      disabled={detail.readOnly}
                      placeholder="1.0.0"
                      value={version}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVersion(val);
                        scheduleStructuredSave({ name, description, version: val, repository, body });
                      }}
                      onBlur={() => saveState === 'dirty' && void flushStructuredSave({ name, description, version, repository, body })}
                    />
                  </div>
                </div>

                <div className="field-group">
                  <div className="field-label">
                    <span>觸發描述 (description — Agent 依此判斷何時使用)</span>
                    <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{description.length} 字</span>
                  </div>
                  <textarea
                    className="textarea-text"
                    rows={3}
                    disabled={detail.readOnly}
                    value={description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDescription(val);
                      scheduleStructuredSave({ name, description: val, version, repository, body });
                    }}
                    onBlur={() => saveState === 'dirty' && void flushStructuredSave({ name, description, version, repository, body })}
                  />
                </div>

                <div className="field-group">
                  <div className="field-label">
                    <span>操作指令與規範正文 (Markdown)</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => void onOpenNativeFile(detail.skillMdPath)}
                      title="在 Antigravity 原生檔案檢視器中開啟"
                    >
                      在編輯器分頁開啟
                    </button>
                  </div>
                  <textarea
                    className="textarea-text textarea-code"
                    disabled={detail.readOnly}
                    value={body}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBody(val);
                      scheduleStructuredSave({ name, description, version, repository, body: val });
                    }}
                    onBlur={() => saveState === 'dirty' && void flushStructuredSave({ name, description, version, repository, body })}
                  />
                </div>
              </>
            ) : (
              <div>
                <textarea
                  className="textarea-text textarea-code"
                  style={{ minHeight: 360 }}
                  disabled={detail.readOnly}
                  value={rawContent}
                  onChange={(e) => {
                    setRawContent(e.target.value);
                    setSaveState('dirty');
                  }}
                />
                {!detail.readOnly && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        setSaveState('saving');
                        await onSaveRaw(detail.id, rawContent);
                        setSaveState('saved');
                      }}
                    >
                      儲存原始 SKILL.md
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Attachments */}
        {subTab === 'attachments' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                所有 scripts/、references/、examples/ 附屬檔案皆集中於此管理
              </span>
              {!detail.readOnly && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowNewAttach((v) => !v)}>
                  + 新增附件檔案
                </button>
              )}
            </div>

            {showNewAttach && !detail.readOnly && (
              <div className="card-box" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="input-text"
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder="例如：scripts/setup.sh 或 references/api.md"
                  value={newAttachPath}
                  onChange={(e) => setNewAttachPath(e.target.value)}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    const rel = newAttachPath.trim().replace(/^\.\//, '');
                    if (!rel) return;
                    await onSaveAttachment(detail.id, rel, `# ${rel}\n`);
                    setSelectedAttach(rel);
                    setNewAttachPath('');
                    setShowNewAttach(false);
                  }}
                >
                  建立
                </button>
              </div>
            )}

            {detail.attachments.length === 0 ? (
              <div className="card-box" style={{ color: 'var(--text-2)' }}>
                此 Skill 目前沒有額外附件檔案。你可以按上方「+ 新增附件檔案」，或在主文寫入相對連結後一鍵建立。
              </div>
            ) : (
              <div className="attachments-grid">
                <div className="attach-list">
                  {detail.attachments.map((att) => (
                    <div
                      key={att.relPath}
                      className={`attach-item ${selectedAttach === att.relPath ? 'selected' : ''}`}
                      onClick={() => setSelectedAttach(att.relPath)}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {att.executable ? '⚙️' : '📎'} {att.relPath}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{att.size}B</span>
                    </div>
                  ))}
                </div>

                <div className="attach-editor">
                  {selectedAttach ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <strong style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{selectedAttach}</strong>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {!detail.readOnly && (
                            <button
                              className="btn btn-sm"
                              onClick={async () => {
                                const linkMd = `[${selectedAttach.split('/').pop()}](./${selectedAttach})`;
                                const nextBody = `${body.trimEnd()}\n\n- 附件：${linkMd}\n`;
                                setBody(nextBody);
                                await flushStructuredSave({ name, description, version, repository, body: nextBody });
                                setSubTab('doc');
                              }}
                            >
                              插入連結至主文
                            </button>
                          )}
                          <button
                            className="btn btn-sm"
                            onClick={() => void onRevealInFinder(`${detail.skillDir}/${selectedAttach}`)}
                          >
                            Finder
                          </button>
                          {!detail.readOnly && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={async () => {
                                await onDeleteAttachment(detail.id, selectedAttach);
                                setSelectedAttach(null);
                              }}
                            >
                              刪除
                            </button>
                          )}
                        </div>
                      </div>

                      {attachIsBinary ? (
                        <div style={{ padding: 16, color: 'var(--text-2)', textAlign: 'center' }}>
                          二進位或媒體檔案（{attachSize} bytes），可使用 Finder 開啟預覽。
                        </div>
                      ) : (
                        <>
                          <textarea
                            className="textarea-text textarea-code"
                            disabled={detail.readOnly}
                            value={attachContent}
                            onChange={(e) => setAttachContent(e.target.value)}
                          />
                          {!detail.readOnly && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => void onSaveAttachment(detail.id, selectedAttach, attachContent)}
                              >
                                儲存附件變更
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-2)' }}>請在左側選取附件進行檢視或編輯。</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Usage Frequency & 365-Day Timeline */}
        {subTab === 'usage' && (
          <div>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value">{detail.totalUses}</div>
                <div className="stat-label">總使用次數</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--ok)' }}>{detail.last30dUses}</div>
                <div className="stat-label">近 30 天使用次數</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ fontSize: 14 }}>
                  {detail.idleDays === null ? '從未使用' : detail.idleDays === 0 ? '今天使用過' : `${detail.idleDays} 天前`}
                </div>
                <div className="stat-label">最後活躍距今</div>
              </div>
            </div>

            <Heatmap365
              dailyCounts365={detail.usage.dailyCounts365}
              title={`「${detail.name}」過去 365 天使用時間分佈`}
            />

            <div className="card-box">
              <strong style={{ display: 'block', marginBottom: 6 }}>每次使用時間點明細 ({detail.usage.recentEvents.length})</strong>
              {detail.usage.recentEvents.length === 0 ? (
                <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
                  目前尚未有此 Skill 的歷史觸發紀錄。
                </div>
              ) : (
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>時間點</th>
                      <th>觸發方式</th>
                      <th>對話 ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.usage.recentEvents.map((ev, i) => (
                      <tr key={`${ev.timestamp}-${i}`}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{formatDateTime(ev.timestamp)}</td>
                        <td>
                          <span className="badge">{ev.source}</span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)' }}>
                          {ev.conversationId.slice(0, 14)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Collaborating / Related Skills */}
        {subTab === 'relations' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                系統依據主文引用、歷史同對話共現與領域相似度自動計算協作關聯。
              </span>
              {canAttachContext && detail.relations.length > 0 && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    const targets = detail.relations
                      .slice(0, 3)
                      .map((r) => allSkills.find((s) => s.id === r.targetId))
                      .filter((x): x is SkillSummary => Boolean(x));
                    void onAttachToChat([detail, ...targets]);
                  }}
                >
                  📎 將此 Skill 與協作組附加至對話
                </button>
              )}
            </div>

            {detail.relations.length === 0 ? (
              <div className="card-box" style={{ color: 'var(--text-2)' }}>
                尚未偵測到與其他 Skill 的明顯引用、共現或領域重疊關聯。
              </div>
            ) : (
              detail.relations.map((rel) => (
                <div key={rel.targetId} className="card-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong>📄 {rel.targetName}</strong>
                      <span className="badge">{rel.targetScopeLabel}</span>
                      {rel.reasons.map((r, idx) => (
                        <span
                          key={idx}
                          className={`badge ${
                            r.type === 'high_similarity'
                              ? 'badge-warn'
                              : r.type === 'co_usage'
                                ? 'badge-ok'
                                : 'badge-info'
                          }`}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                    <button className="btn btn-sm" onClick={() => onSelectSkill(rel.targetId)}>
                      開啟此 Skill →
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                    {rel.targetDescription}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    關聯依據：{rel.reasons.map((r) => r.detail).join('；')}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
