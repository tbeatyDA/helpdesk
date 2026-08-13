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

  return { periods, columns, table, grandTotal, maxRowTotal };
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

  const { columns, table, grandTotal, maxRowTotal } = useMemo(() => pivot(rows), [rows]);

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
};
