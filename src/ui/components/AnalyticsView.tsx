import React, { useMemo, useState } from 'react';
import type { SnapshotPayload } from '../../shared/types.ts';
import { formatScopeLabel, STRINGS, type UiLang } from '../i18n.ts';
import { Heatmap365 } from './Heatmap365.tsx';

interface AnalyticsViewProps {
  snapshot: SnapshotPayload;
  lang: UiLang;
  onSelectSkill: (skillId: string) => void;
}

function formatDateTime(iso: string | undefined, neverText: string): string {
  if (!iso) return neverText;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ snapshot, lang, onSelectSkill }) => {
  const t = STRINGS[lang];
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'idle'>('all');

  const scopeMap = useMemo(() => {
    const m = new Map(snapshot.scopes.map((sc) => [sc.id, formatScopeLabel(sc, lang)]));
    return m;
  }, [snapshot.scopes, lang]);

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

  const sourceLabel = (src: string) => {
    if (src === 'read_file') return t.srcReadFile;
    if (src === 'slash_command') return t.srcSlash;
    if (src === 'mention') return t.srcMention;
    if (src === 'panel_attach') return t.srcPanelAttach;
    return src;
  };

  return (
    <div className="scroll-y" style={{ padding: 14, width: '100%' }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{snapshot.analytics.totalActivations}</div>
          <div className="stat-label">{t.analyticsTotalCard}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--ok)' }}>
            {snapshot.analytics.last30dActivations}
          </div>
          <div className="stat-label">{t.analytics30dCard}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            {active30dSkills} / {snapshot.skills.length}
          </div>
          <div className="stat-label">{t.analyticsActiveCard}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: idleCount > 0 ? 'var(--warn)' : 'var(--ok)' }}>
            {idleCount}
          </div>
          <div className="stat-label">{t.analyticsIdleCard}</div>
        </div>
      </div>

      <Heatmap365
        dailyCounts365={snapshot.analytics.dailyCounts365}
        title={t.analyticsGlobalHeatmap}
        lang={lang}
      />

      <div className="card-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          <strong>{t.analyticsDiagTitle}</strong>
          <div className="tab-group">
            <button className={`tab-btn ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>
              {t.analyticsFilterAll(snapshot.skills.length)}
            </button>
            <button className={`tab-btn ${filterMode === 'active' ? 'active' : ''}`} onClick={() => setFilterMode('active')}>
              {t.analyticsFilterActive(active30dSkills)}
            </button>
            <button className={`tab-btn ${filterMode === 'idle' ? 'active' : ''}`} onClick={() => setFilterMode('idle')}>
              {t.analyticsFilterIdle(idleCount)}
            </button>
          </div>
        </div>

        <table className="table-clean">
          <thead>
            <tr>
              <th>{t.colSkill}</th>
              <th>{t.colScope}</th>
              <th>{t.colTotalUses}</th>
              <th>{t.col30dUses}</th>
              <th>{t.colLastUsed}</th>
              <th>{t.colHealthState}</th>
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
                <td style={{ color: 'var(--text-2)' }}>{scopeMap.get(s.scopeId) || s.scopeLabel}</td>
                <td>{s.totalUses}</td>
                <td>{s.last30dUses}</td>
                <td style={{ color: 'var(--text-2)' }}>{formatDateTime(s.lastUsedAt, t.neverUsed)}</td>
                <td>
                  {s.idleDays === null ? (
                    <span className="badge badge-warn">{t.neverUsed}</span>
                  ) : s.idleDays >= 30 ? (
                    <span className="badge badge-warn">{t.idleDaysBadge(s.idleDays)}</span>
                  ) : (
                    <span className="badge badge-ok">{t.activeBadge}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-box">
        <strong style={{ display: 'block', marginBottom: 8 }}>{t.recentTimelineTitle}</strong>
        {snapshot.analytics.recentEvents.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
            {t.noGlobalEvents}
          </div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr>
                <th>{t.colTimestamp}</th>
                <th>{t.colSkill}</th>
                <th>{t.colTriggerSource}</th>
                <th>{t.colConvId}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.analytics.recentEvents.slice(0, 60).map((ev, idx) => (
                <tr
                  key={`${ev.timestamp}-${ev.skillKey}-${idx}`}
                  style={{ cursor: ev.skillId ? 'pointer' : 'default' }}
                  onClick={() => ev.skillId && onSelectSkill(ev.skillId)}
                >
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{formatDateTime(ev.timestamp, '—')}</td>
                  <td>
                    <strong>{ev.skillName}</strong>
                  </td>
                  <td>
                    <span className="badge">{sourceLabel(ev.source)}</span>
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
