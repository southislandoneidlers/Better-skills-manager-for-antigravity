import React, { useMemo, useState } from 'react';
import type { SkillSummary, SnapshotPayload } from '../../shared/types.ts';

interface GraphViewProps {
  snapshot: SnapshotPayload;
  onSelectSkill: (skillId: string) => void;
  canAttachContext: boolean;
  onAttachSkills: (skills: SkillSummary[]) => void;
}

const REASON_COLOR: Record<string, string> = {
  explicit_ref: '#2563eb',
  co_usage: '#16a34a',
  domain_overlap: '#0284c7',
  high_similarity: '#d97706',
};

export const GraphView: React.FC<GraphViewProps> = ({
  snapshot,
  onSelectSkill,
  canAttachContext,
  onAttachSkills,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'explicit_ref' | 'co_usage' | 'high_similarity'>('all');
  const [focusId, setFocusId] = useState<string | null>(null);

  const skillMap = useMemo(() => {
    const m = new Map<string, SkillSummary>();
    for (const s of snapshot.skills) m.set(s.id, s);
    return m;
  }, [snapshot.skills]);

  const filteredEdges = useMemo(() => {
    return snapshot.graphEdges.filter((edge) => {
      if (filterType !== 'all' && !edge.reasons.some((r) => r.type === filterType)) {
        return false;
      }
      if (focusId && edge.sourceId !== focusId && edge.targetId !== focusId) {
        return false;
      }
      return true;
    });
  }, [snapshot.graphEdges, filterType, focusId]);

  const connectedNodes = useMemo(() => {
    const ids = new Set<string>();
    for (const e of filteredEdges) {
      ids.add(e.sourceId);
      ids.add(e.targetId);
    }
    if (ids.size === 0) {
      for (const s of snapshot.skills.slice(0, 12)) ids.add(s.id);
    }
    const list = [...ids]
      .map((id) => skillMap.get(id))
      .filter((x): x is SkillSummary => Boolean(x))
      .slice(0, 20);
    return list;
  }, [filteredEdges, snapshot.skills, skillMap]);

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const cx = 290;
    const cy = 165;
    const n = connectedNodes.length;
    if (n === 0) return pos;
    const rx = Math.min(220, 90 + n * 10);
    const ry = Math.min(125, 65 + n * 6);
    connectedNodes.forEach((node, idx) => {
      const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(node.id, {
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      });
    });
    return pos;
  }, [connectedNodes]);

  const overlapCount = snapshot.graphEdges.filter((e) =>
    e.reasons.some((r) => r.type === 'high_similarity'),
  ).length;

  return (
    <div className="scroll-y" style={{ padding: 14, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>🕸️ 多 Skills 協作關聯網絡</strong>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            自動分析「明確引用」「歷史對話共現」「領域重疊與職責衝突」，協助組裝多技能協作流程。
          </div>
        </div>
        <div className="tab-group">
          <button className={`tab-btn ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>
            全部 ({snapshot.graphEdges.length})
          </button>
          <button className={`tab-btn ${filterType === 'explicit_ref' ? 'active' : ''}`} onClick={() => setFilterType('explicit_ref')}>
            明確引用
          </button>
          <button className={`tab-btn ${filterType === 'co_usage' ? 'active' : ''}`} onClick={() => setFilterType('co_usage')}>
            實戰共現
          </button>
          <button className={`tab-btn ${filterType === 'high_similarity' ? 'active' : ''}`} onClick={() => setFilterType('high_similarity')}>
            ⚠️ 重疊警示 ({overlapCount})
          </button>
        </div>
      </div>

      {focusId && (
        <div style={{ marginBottom: 8 }}>
          <span className="badge badge-info">
            僅顯示與「{skillMap.get(focusId)?.name}」相關之連線
          </span>{' '}
          <button className="btn btn-sm" onClick={() => setFocusId(null)}>
            顯示全部節點
          </button>
        </div>
      )}

      <div className="card-box" style={{ overflowX: 'auto' }}>
        {connectedNodes.length === 0 ? (
          <div style={{ color: 'var(--text-2)' }}>目前尚未偵測到多技能關聯。</div>
        ) : (
          <svg viewBox="0 0 580 330" style={{ width: '100%', maxHeight: 320, display: 'block' }}>
            {filteredEdges.map((edge, idx) => {
              const p1 = nodePositions.get(edge.sourceId);
              const p2 = nodePositions.get(edge.targetId);
              if (!p1 || !p2) return null;
              const primaryType = edge.reasons[0]?.type || 'domain_overlap';
              const stroke = REASON_COLOR[primaryType] || '#64748b';
              return (
                <line
                  key={`${edge.sourceId}-${edge.targetId}-${idx}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={stroke}
                  strokeOpacity={0.55}
                  strokeWidth={Math.max(1.5, edge.score * 3.5)}
                  strokeDasharray={primaryType === 'high_similarity' ? '5 3' : undefined}
                >
                  <title>{edge.reasons.map((r) => `${r.label}: ${r.detail}`).join(' | ')}</title>
                </line>
              );
            })}

            {connectedNodes.map((node) => {
              const p = nodePositions.get(node.id);
              if (!p) return null;
              const isFocus = focusId === node.id;
              return (
                <g
                  key={node.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setFocusId(isFocus ? null : node.id)}
                  onDoubleClick={() => onSelectSkill(node.id)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isFocus ? 16 : 12}
                    fill={node.readOnly ? 'var(--bg-3)' : 'var(--accent)'}
                    stroke="var(--bg-1)"
                    strokeWidth={2}
                  />
                  <text
                    x={p.x}
                    y={p.y + 24}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight={isFocus ? '700' : '500'}
                    fill="var(--text-1)"
                  >
                    {node.name.length > 18 ? `${node.name.slice(0, 16)}…` : node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-2)', marginTop: 6, flexWrap: 'wrap' }}>
          <span>提示：點擊節點可篩選連線，雙擊節點直接開啟文件。</span>
          <span style={{ color: '#2563eb' }}>● 明確引用</span>
          <span style={{ color: '#16a34a' }}>● 實戰共現</span>
          <span style={{ color: '#0284c7' }}>● 領域相近</span>
          <span style={{ color: '#d97706' }}>┈ 觸發描述重疊</span>
        </div>
      </div>

      <div className="card-box">
        <strong style={{ display: 'block', marginBottom: 8 }}>協作關聯明細 ({filteredEdges.length})</strong>
        {filteredEdges.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>此篩選條件下沒有關聯配對。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredEdges.slice(0, 40).map((edge, idx) => {
              const s1 = skillMap.get(edge.sourceId);
              const s2 = skillMap.get(edge.targetId);
              if (!s1 || !s2) return null;
              return (
                <div
                  key={`${edge.sourceId}-${edge.targetId}-${idx}`}
                  style={{
                    border: '1px solid var(--border-1)',
                    borderRadius: 6,
                    padding: 8,
                    background: 'var(--bg-1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => onSelectSkill(s1.id)}>
                        📄 {s1.name}
                      </button>
                      <span>⇄</span>
                      <button className="btn btn-sm" onClick={() => onSelectSkill(s2.id)}>
                        📄 {s2.name}
                      </button>
                      {edge.reasons.map((r, rIdx) => (
                        <span
                          key={rIdx}
                          className={`badge ${r.type === 'high_similarity' ? 'badge-warn' : r.type === 'co_usage' ? 'badge-ok' : 'badge-info'}`}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
                      {edge.reasons.map((r) => r.detail).join('；')}
                    </div>
                  </div>
                  {canAttachContext && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => onAttachSkills([s1, s2])}
                    >
                      📎 整組附加至對話
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
