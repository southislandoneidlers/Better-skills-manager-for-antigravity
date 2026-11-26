import React, { useMemo, useState } from 'react';
import type { SnapshotPayload } from '../../shared/types.ts';
import { Heatmap365 } from './Heatmap365.tsx';

interface AnalyticsViewProps {
  snapshot: SnapshotPayload;
  onSelectSkill: (skillId: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  read_file: 'Agent 自動讀取',
  slash_command: '斜線指令 /',
  mention: '@ 提及引用',
  panel_attach: '面板附加至對話',
};

function formatDateTime(iso?: string): string {
  if (!iso) return '尚未紀錄';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ snapshot, onSelectSkill }) => {
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'idle'>('all');

  const sortedByUsage = useMemo(() => {
    const list = [...snapshot.skills];
    if (filterMode === 'active') {
      return list.filter((s) => s.last30dUses > 0).sort((a, b) => b.totalUses - a.totalUses);
    }
    if (filterMode === 'idle') {
      return list
        .filter((s) => s.idleDays === null || s.idleDays >= 30)
        .sort((a, b) => (b.idleDays ?? 9999) - (a.idleDays ?? 9999));
    }
    return list.sort((a, b) => b.totalUses - a.totalUses || b.last30dUses - a.last30dUses);
  }, [snapshot.skills, filterMode]);

  const idleCount = snapshot.analytics.idleSkillIds.length;
  const active30dSkills = snapshot.skills.filter((s) => s.last30dUses > 0).length;

  return (
    <div className="scroll-y" style={{ padding: 14, width: '100%' }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{snapshot.analytics.totalActivations}</div>
          <div className="stat-label">累積總使用次數</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--ok)' }}>
            {snapshot.analytics.last30dActivations}
          </div>
          <div className="stat-label">近 30 天使用次數</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            {active30dSkills} / {snapshot.skills.length}
          </div>
          <div className="stat-label">近 30 天活躍 Skills</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: idleCount > 0 ? 'var(--warn)' : 'var(--ok)' }}>
            {idleCount}
          </div>
          <div className="stat-label">超過 30 天未使用（閒置）</div>
        </div>
      </div>

      <Heatmap365
        dailyCounts365={snapshot.analytics.dailyCounts365}
        title="全技能庫 365 天使用頻率熱力圖"
      />

      <div className="card-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          <strong>各 Skill 使用頻率與閒置診斷</strong>
          <div className="tab-group">
            <button className={`tab-btn ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>
              全部 ({snapshot.skills.length})
            </button>
            <button className={`tab-btn ${filterMode === 'active' ? 'active' : ''}`} onClick={() => setFilterMode('active')}>
              近 30 天活躍 ({active30dSkills})
            </button>
            <button className={`tab-btn ${filterMode === 'idle' ? 'active' : ''}`} onClick={() => setFilterMode('idle')}>
              閒置待整理 ({idleCount})
            </button>
          </div>
        </div>

        <table className="table-clean">
          <thead>
            <tr>
              <th>Skill</th>
              <th>範圍</th>
              <th>總次數</th>
              <th>近 30 天</th>
              <th>最後使用時間</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {sortedByUsage.map((s) => (
              <tr
                key={s.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectSkill(s.id)}
              >
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td style={{ color: 'var(--text-2)' }}>{s.scopeLabel}</td>
                <td>{s.totalUses}</td>
                <td>{s.last30dUses}</td>
                <td style={{ color: 'var(--text-2)' }}>{formatDateTime(s.lastUsedAt)}</td>
                <td>
                  {s.idleDays === null ? (
                    <span className="badge badge-warn">從未使用</span>
                  ) : s.idleDays >= 30 ? (
                    <span className="badge badge-warn">閒置 {s.idleDays} 天</span>
                  ) : (
                    <span className="badge badge-ok">活躍中</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-box">
        <strong style={{ display: 'block', marginBottom: 8 }}>近期觸發時間軸明細（真實對話與面板記錄）</strong>
        {snapshot.analytics.recentEvents.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
            尚未偵測到歷史對話觸發紀錄。當你在對話中使用 Skill 或點擊「附加至對話」時，這裡會精確記錄每一次的時間點與來源。
          </div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr>
                <th>精確時間點</th>
                <th>Skill</th>
                <th>觸發方式</th>
                <th>對話 ID</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.analytics.recentEvents.slice(0, 60).map((ev, idx) => (
                <tr
                  key={`${ev.timestamp}-${ev.skillKey}-${idx}`}
                  style={{ cursor: ev.skillId ? 'pointer' : 'default' }}
                  onClick={() => ev.skillId && onSelectSkill(ev.skillId)}
                >
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{formatDateTime(ev.timestamp)}</td>
                  <td>
                    <strong>{ev.skillName}</strong>
                  </td>
                  <td>
                    <span className="badge">{SOURCE_LABELS[ev.source] || ev.source}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)' }}>
                    {ev.conversationId.slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
