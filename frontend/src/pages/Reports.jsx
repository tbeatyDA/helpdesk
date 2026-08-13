import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { getTicketReport, logout as apiLogout } from '../api.js';
import SettingsMenu from '../components/SettingsMenu.jsx';

// ---- Helpers ---------------------------------------------------------------

function formatPeriodLabel(interval, isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d)) return isoDate;
  if (interval === 'year') {
    return String(d.getUTCFullYear());
  }
  if (interval === 'month') {
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  // week — show the week's start date
  return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
}

/** Pivot flat rows [{period, key, label, count}] into { periods, columns, table, totalsByColumn } */
function pivot(rows) {
  const periodSet = new Map(); // period -> true, preserves first-seen order (already sorted asc from API)
  const columnSet = new Map(); // key -> label
  const cellMap = new Map(); // `${period}|${key}` -> count

  for (const r of rows) {
    periodSet.set(r.period, true);
    columnSet.set(r.key, r.label);
    cellMap.set(`${r.period}|${r.key}`, r.count);
  }

  const periods = Array.from(periodSet.keys()).sort().reverse(); // most recent first
  const totalsByColumn = new Map();
  for (const key of columnSet.keys()) totalsByColumn.set(key, 0);
  for (const r of rows) {
    totalsByColumn.set(r.key, (totalsByColumn.get(r.key) || 0) + r.count);
  }

  // Order columns by total count descending, so busiest techs appear first
  const columns = Array.from(columnSet.entries())
    .sort((a, b) => (totalsByColumn.get(b[0]) || 0) - (totalsByColumn.get(a[0]) || 0))
    .map(([key, label]) => ({ key, label }));

  const table = periods.map((period) => {
    const cells = columns.map((c) => cellMap.get(`${period}|${c.key}`) || 0);
    const rowTotal = cells.reduce((a, b) => a + b, 0);
    return { period, cells, rowTotal };
  });

  const grandTotal = table.reduce((a, r) => a + r.rowTotal, 0);
  const maxRowTotal = table.reduce((m, r) => Math.max(m, r.rowTotal), 0);

  return { periods, columns, table, grandTotal, maxRowTotal, totalsByColumn };
}

// ---- Donut chart (share of tickets per tech, aggregated over the range) ----

// Fixed categorical hue order — identity, never rank. Colors live in CSS vars
// (see DONUT_STYLE) so they can differ between the light theme and the rest.
const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];
const MAX_SLICES = SERIES_VARS.length;

const DONUT_STYLE = `
  .donut-wrap {
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --series-5: #d55181;
    --series-6: #008300;
  }
  :root[data-theme="light"] .donut-wrap {
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    --series-4: #eda100;
    --series-5: #e87ba4;
    --series-6: #008300;
  }
`;

/**
 * Build donut slices from the pivoted columns/totals. Colors are assigned in a
 * fixed identity order (alphabetical by label, "Unassigned" pinned last) so a
 * given tech keeps the same color across filter changes — never by rank.
 * Beyond MAX_SLICES, the smallest-by-value columns fold into a gray "Other".
 */
function buildDonutSeries(columns, totalsByColumn) {
  if (columns.length < 2) return [];

  const ordered = [...columns].sort((a, b) => {
    if (a.key === 'unassigned') return 1;
    if (b.key === 'unassigned') return -1;
    return a.label.localeCompare(b.label);
  });

  let kept = ordered;
  let otherTotal = 0;
  if (ordered.length > MAX_SLICES) {
    const byValueDesc = [...ordered].sort(
      (a, b) => (totalsByColumn.get(b.key) || 0) - (totalsByColumn.get(a.key) || 0)
    );
    const keepSet = new Set(byValueDesc.slice(0, MAX_SLICES - 1).map((c) => c.key));
    kept = ordered.filter((c) => keepSet.has(c.key));
    otherTotal = ordered
      .filter((c) => !keepSet.has(c.key))
      .reduce((sum, c) => sum + (totalsByColumn.get(c.key) || 0), 0);
  }

  const series = kept.map((c, i) => ({
    key: c.key,
    label: c.label,
    count: totalsByColumn.get(c.key) || 0,
    colorVar: `var(${SERIES_VARS[i % SERIES_VARS.length]})`,
  }));
  if (otherTotal > 0) {
    series.push({ key: '__other__', label: 'Other', count: otherTotal, colorVar: 'var(--muted)' });
  }
  return series.filter((s) => s.count > 0);
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, rOuter, startAngle);
  const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle);
  const innerStart = polarToCartesian(cx, cy, rInner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

const GAP_DEG = 1.8; // visual separation between slices, skipped on slivers too thin to carry it

function DonutChart({ series }) {
  const [activeKey, setActiveKey] = useState(null);
  const total = series.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 100;
  const rInner = 62;

  let cursor = 0;
  const slices = series.map((s) => {
    const sweep = (s.count / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    const gap = sweep > GAP_DEG * 2 ? GAP_DEG : 0;
    return { ...s, start: start + gap / 2, end: end - gap / 2, pct: (s.count / total) * 100 };
  });

  const active = activeKey ? series.find((s) => s.key === activeKey) : null;

  return (
    <div className="donut-wrap" style={styles.donutRow}>
      <style>{DONUT_STYLE}</style>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Ticket share by tech: ${series
          .map((s) => `${s.label} ${Math.round((s.count / total) * 100)}%`)
          .join(', ')}`}
      >
        {slices.map((s) => (
          <path
            key={s.key}
            d={donutSlicePath(cx, cy, rOuter, rInner, s.start, s.end)}
            opacity={activeKey && activeKey !== s.key ? 0.45 : 1}
            style={{ fill: s.colorVar, cursor: 'pointer', transition: 'opacity 0.15s' }}
            tabIndex={0}
            role="button"
            aria-label={`${s.label}: ${s.count} tickets, ${Math.round(s.pct)} percent`}
            onPointerEnter={() => setActiveKey(s.key)}
            onPointerLeave={() => setActiveKey(null)}
            onFocus={() => setActiveKey(s.key)}
            onBlur={() => setActiveKey(null)}
          >
            <title>{`${s.label}: ${s.count} (${Math.round(s.pct)}%)`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" style={styles.donutCenterValue}>
          {active ? active.count : total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={styles.donutCenterLabel}>
          {active ? active.label : 'Total'}
        </text>
      </svg>

      <ul style={styles.legend}>
        {series.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              style={{
                ...styles.legendRow,
                opacity: activeKey && activeKey !== s.key ? 0.55 : 1,
              }}
              onPointerEnter={() => setActiveKey(s.key)}
              onPointerLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(s.key)}
              onBlur={() => setActiveKey(null)}
            >
              <span style={{ ...styles.legendSwatch, background: s.colorVar }} />
              <span style={styles.legendLabel}>{s.label}</span>
              <span style={styles.legendValue}>
                {s.count} · {Math.round((s.count / total) * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Page -------------------------------------------------------------------

export default function Reports() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [interval, setInterval_] = useState('month');
  const [groupBy, setGroupBy] = useState('department');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTicketReport({ interval, group_by: groupBy })
      .then((data) => {
        if (!cancelled) setRows(data.rows || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load report');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [interval, groupBy]);

  const { columns, table, grandTotal, maxRowTotal, totalsByColumn } = useMemo(() => pivot(rows), [rows]);
  const donutSeries = useMemo(
    () => (groupBy === 'tech' ? buildDonutSeries(columns, totalsByColumn) : []),
    [groupBy, columns, totalsByColumn]
  );

  async function handleLogout() {
    await apiLogout();
    setUser(null);
  }

  return (
    <div style={styles.page}>
      <header style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <a href="/" style={styles.appPillLink} onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            IT Helpdesk
          </a>
          <span style={styles.appPillActive}>Reports</span>
          <a href="https://inventory.dayair.org" style={styles.appPillLink}>IT Inventory</a>
        </div>
        <div style={styles.topBarRight}>
          <span style={styles.userName}>{user?.display_name || user?.email || 'User'}</span>
          <SettingsMenu />
          <button className="btn btn-secondary" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.filterBar}>
          <div style={styles.filterLeft}>
            <select
              value={interval}
              onChange={(e) => setInterval_(e.target.value)}
              style={styles.filterSelect}
              aria-label="Time granularity"
            >
              <option value="week">By Week</option>
              <option value="month">By Month</option>
              <option value="year">By Year</option>
            </select>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              style={styles.filterSelect}
              aria-label="Breakdown"
            >
              <option value="department">Whole Department</option>
              <option value="tech">By Tech</option>
            </select>
          </div>
          <div style={styles.filterRight}>
            <span style={styles.totalPill}>
              {grandTotal} ticket{grandTotal === 1 ? '' : 's'} in range
            </span>
          </div>
        </div>

        {!loading && !error && donutSeries.length >= 2 && (
          <div className="card" style={styles.card}>
            <div style={styles.cardHeader}>Share of tickets by tech</div>
            <DonutChart series={donutSeries} />
          </div>
        )}

        <div className="card" style={styles.card}>
          {loading ? (
            <div style={styles.emptyState}>Loading…</div>
          ) : error ? (
            <div style={{ ...styles.emptyState, color: '#f87171' }}>{error}</div>
          ) : table.length === 0 ? (
            <div style={styles.emptyState}>No tickets in this range.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    {columns.map((c) => (
                      <th key={c.key} style={styles.numCol}>{c.label}</th>
                    ))}
                    {columns.length > 1 && <th style={styles.numCol}>Total</th>}
                    <th style={styles.barCell}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr key={row.period}>
                      <td>{formatPeriodLabel(interval, row.period)}</td>
                      {row.cells.map((count, i) => (
                        <td key={columns[i].key} style={styles.numCol}>{count}</td>
                      ))}
                      {columns.length > 1 && (
                        <td style={styles.numCol}>
                          <strong>{row.rowTotal}</strong>
                        </td>
                      )}
                      <td style={styles.barCell}>
                        <div
                          style={{
                            ...styles.bar,
                            width: maxRowTotal ? `${(row.rowTotal / maxRowTotal) * 100}%` : '0%',
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ---- Styles -----------------------------------------------------------------

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 1.5rem',
    height: '56px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  appPillActive: {
    fontSize: '0.85rem',
    fontWeight: '700',
    color: '#38bdf8',
    background: 'rgba(56,189,248,0.12)',
    border: '1px solid rgba(56,189,248,0.4)',
    borderRadius: '6px',
    padding: '0.25rem 0.65rem',
  },
  appPillLink: {
    fontSize: '0.85rem',
    fontWeight: '500',
    color: '#94a3b8',
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '0.25rem 0.65rem',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  userName: {
    fontSize: '13px',
    color: '#94a3b8',
  },
  main: {
    flex: 1,
    padding: '1.25rem 1.5rem',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  filterLeft: {
    display: 'flex',
    gap: '0.5rem',
  },
  filterRight: {
    display: 'flex',
    alignItems: 'center',
  },
  filterSelect: {
    background: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '0.4rem 0.6rem',
    fontSize: '0.85rem',
  },
  totalPill: {
    fontSize: '0.8rem',
    color: '#94a3b8',
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '1rem 1.25rem 0',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  emptyState: {
    padding: '2.5rem',
    textAlign: 'center',
    color: '#64748b',
  },
  numCol: {
    textAlign: 'right',
  },
  barCell: {
    width: '120px',
  },
  bar: {
    height: '10px',
    borderRadius: '3px',
    background: '#38bdf8',
    minWidth: '2px',
  },
  donutRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '2rem',
    flexWrap: 'wrap',
    padding: '1rem 1.25rem 1.25rem',
  },
  donutCenterValue: {
    fontSize: '28px',
    fontWeight: 700,
    fill: 'var(--text)',
    fontFamily: 'inherit',
  },
  donutCenterLabel: {
    fontSize: '12px',
    fill: 'var(--muted)',
    fontFamily: 'inherit',
  },
  legend: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    minWidth: '220px',
  },
  legendRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '0.35rem 0.5rem',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  legendSwatch: {
    width: '10px',
    height: '10px',
    minWidth: '10px',
    borderRadius: '3px',
  },
  legendLabel: {
    flex: 1,
    fontSize: '0.85rem',
    color: 'var(--text)',
  },
  legendValue: {
    fontSize: '0.8rem',
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
};
