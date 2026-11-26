import React, { useMemo, useState } from 'react';
import { STRINGS, type UiLang } from '../i18n.ts';

interface Heatmap365Props {
  dailyCounts365: Record<string, number>;
  title?: string;
  lang: UiLang;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const Heatmap365: React.FC<Heatmap365Props> = ({ dailyCounts365, title, lang }) => {
  const t = STRINGS[lang];
  const [hovered, setHovered] = useState<{ date: string; count: number } | null>(null);

  const { weeks, maxCount, activeDays, totalCount } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay());

    const weekCols: Array<Array<{ date: string; count: number; inRange: boolean }>> = [];
    let max = 0;
    let active = 0;
    let total = 0;

    const cursor = new Date(start);
    while (cursor <= today) {
      const col: Array<{ date: string; count: number; inRange: boolean }> = [];
      for (let row = 0; row < 7; row++) {
        const key = toKey(cursor);
        const inRange = cursor <= today;
        const count = inRange ? (dailyCounts365[key] || 0) : 0;
        if (inRange && count > 0) {
          active += 1;
          total += count;
          if (count > max) max = count;
        }
        col.push({ date: key, count, inRange });
        cursor.setDate(cursor.getDate() + 1);
      }
      weekCols.push(col);
    }

    return { weeks: weekCols, maxCount: max, activeDays: active, totalCount: total };
  }, [dailyCounts365]);

  const cellSize = 10;
  const gap = 2;
  const svgW = weeks.length * (cellSize + gap) + 4;
  const svgH = 7 * (cellSize + gap) + 4;

  const fillForCount = (count: number, inRange: boolean): string => {
    if (!inRange) return 'transparent';
    if (count === 0) return 'var(--bg-3)';
    const ratio = maxCount > 0 ? count / maxCount : 0;
    if (ratio <= 0.25) return 'rgba(22, 163, 74, 0.32)';
    if (ratio <= 0.55) return 'rgba(22, 163, 74, 0.55)';
    if (ratio <= 0.8) return 'rgba(22, 163, 74, 0.78)';
    return 'rgba(22, 163, 74, 1)';
  };

  return (
    <div className="card-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <strong style={{ fontSize: 12 }}>{title || t.heatmapDefaultTitle}</strong>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
          {hovered
            ? t.heatmapHover(hovered.date, hovered.count)
            : t.heatmapSummary(totalCount, activeDays)}
        </span>
      </div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <svg width={svgW} height={svgH} style={{ display: 'block' }}>
          {weeks.map((col, wIdx) =>
            col.map((cell, rIdx) => (
              <rect
                key={`${wIdx}-${rIdx}`}
                x={wIdx * (cellSize + gap) + 2}
                y={rIdx * (cellSize + gap) + 2}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={fillForCount(cell.count, cell.inRange)}
                onMouseEnter={() => cell.inRange && setHovered({ date: cell.date, count: cell.count })}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{t.heatmapHover(cell.date, cell.count)}</title>
              </rect>
            )),
          )}
        </svg>
      </div>
    </div>
  );
};
