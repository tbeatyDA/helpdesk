import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { getTickets, getStats, deleteTickets, getAssetsByUpns, getUsers, logout as apiLogout, pollEmails, updateTicket } from '../api.js';
import TopBar from '../components/TopBar.jsx';
import { playPing, showNotification } from '../sound.js';

// ---- Helpers -------------------------------------------------------------

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date)) return '—';

  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDisplayLabel(val) {
  if (!val) return '—';
  return val
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      {toDisplayLabel(status)}
    </span>
  );
}

function PriorityBadge({ priority }) {
  return (
    <span className={`badge badge-${priority}`}>
      {toDisplayLabel(priority)}
    </span>
  );
}

// ---- Inline selects -------------------------------------------------------

const STATUS_STYLES = {
  open:        { color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 15%, var(--surface))', border: 'color-mix(in srgb, var(--accent) 30%, var(--surface))' },
  in_progress: { color: 'var(--yellow)', bg: 'color-mix(in srgb, var(--yellow) 15%, var(--surface))', border: 'color-mix(in srgb, var(--yellow) 30%, var(--surface))' },
  pending:     { color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 15%, var(--surface))', border: 'color-mix(in srgb, var(--purple) 30%, var(--surface))' },
  resolved:    { color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 15%, var(--surface))', border: 'color-mix(in srgb, var(--green) 30%, var(--surface))' },
  closed:      { color: 'var(--muted)', bg: 'color-mix(in srgb, var(--gray) 25%, var(--surface))', border: 'color-mix(in srgb, var(--gray) 40%, var(--surface))' },
};

const PRIORITY_STYLES = {
  low:    { color: 'var(--muted)', bg: 'color-mix(in srgb, var(--gray) 20%, var(--surface))', border: 'color-mix(in srgb, var(--gray) 35%, var(--surface))' },
  normal: { color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 12%, var(--surface))', border: 'color-mix(in srgb, var(--accent) 25%, var(--surface))' },
  high:   { color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 15%, var(--surface))', border: 'color-mix(in srgb, var(--orange) 30%, var(--surface))' },
  urgent: { color: 'var(--red)', bg: 'color-mix(in srgb, var(--red) 15%, var(--surface))', border: 'color-mix(in srgb, var(--red) 30%, var(--surface))' },
};

const selectBase = {
  borderRadius: 999,
  padding: '2px 6px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  outline: 'none',
};

function InlineStatusSelect({ value, onChange }) {
  const s = STATUS_STYLES[value] || STATUS_STYLES.open;
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      style={{ ...selectBase, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <option value="open">Open</option>
      <option value="in_progress">In Progress</option>
      <option value="pending">Pending</option>
      <option value="resolved">Resolved</option>
      <option value="closed">Closed</option>
    </select>
  );
}

function InlinePrioritySelect({ value, onChange }) {
  const s = PRIORITY_STYLES[value] || PRIORITY_STYLES.normal;
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      style={{ ...selectBase, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <option value="low">Low</option>
      <option value="normal">Normal</option>
      <option value="high">High</option>
      <option value="urgent">Urgent</option>
    </select>
  );
}

function InlineAssignSelect({ value, users, onChange }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      onClick={e => e.stopPropagation()}
      style={{ ...selectBase, textTransform: 'none', fontSize: 12, color: value ? 'var(--body)' : 'var(--accent)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}
    >
      <option value=''>Unassigned</option>
      {users.map(u => (
        <option key={u.id} value={u.id}>{u.display_name}</option>
      ))}
    </select>
  );
}

// ---- Column registry -------------------------------------------------------
// Header and body rows both map over this same array, so they can't drift out
// of sync (they used to be two separately-hardcoded lists). It's also the one
// place a future per-department visible_columns filter, or a custom-field
// column, plugs in — filter this array before rendering, nothing else changes.
export const COLUMNS = [
  {
    key: 'number',
    label: '#',
    renderCell: (t) => (
      <td style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        #{t.number ?? t.id}
      </td>
    ),
  },
  {
    key: 'subject',
    label: 'Subject',
    renderCell: (t) => (
      <td style={{ maxWidth: 280 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          {t.has_unread && (
            <span title="New reply from user" style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          )}
          <span style={{ color: t.has_unread ? 'var(--text)' : 'var(--muted)', fontWeight: t.has_unread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.subject || '(No subject)'}
          </span>
        </span>
      </td>
    ),
  },
  {
    key: 'requester',
    label: 'Requester',
    renderCell: (t) => (
      <td style={{ color: 'var(--body)', whiteSpace: 'nowrap' }}>
        {t.requester_name || t.requester_email || '—'}
      </td>
    ),
  },
  {
    key: 'priority',
    label: 'Priority',
    renderCell: (t, ctx) => (
      <td onClick={(e) => e.stopPropagation()}>
        <InlinePrioritySelect
          value={t.priority || 'normal'}
          onChange={(val) => ctx.handleInlineUpdate(t.id, { priority: val })}
        />
      </td>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    renderCell: (t, ctx) => (
      <td onClick={(e) => e.stopPropagation()}>
        <InlineStatusSelect
          value={t.status || 'open'}
          onChange={(val) => ctx.handleInlineUpdate(t.id, { status: val })}
        />
      </td>
    ),
  },
  {
    key: 'assigned',
    label: 'Assigned To',
    renderCell: (t, ctx) => (
      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <InlineAssignSelect
          value={t.assigned_to?.id ?? t.assigned_to_id ?? null}
          users={ctx.users}
          onChange={(val) => ctx.handleInlineUpdate(t.id, { assigned_to_id: val })}
        />
      </td>
    ),
  },
  {
    key: 'asset',
    label: 'Asset',
    // Not a Ticket field — a live join against the inventory app's assets
    // table, keyed by requester email. Needs ctx.assetMap, not just the ticket.
    renderCell: (t, ctx) => (
      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        {(() => {
          const asset = ctx.assetMap[t.requester_email];
          if (!asset) return <span style={{ color: 'var(--gray)' }}>—</span>;
          return (
            <a
              href={`https://inventory.dayair.org/assets?q=${encodeURIComponent(asset.asset_tag)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
              title="Open in inventory"
            >
              <span style={{ display: 'block', color: 'var(--accent)', fontWeight: 600, fontSize: 12 }}>
                {asset.device_name || asset.asset_tag}
              </span>
              {asset.name && (
                <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>
                  {asset.name}
                </span>
              )}
            </a>
          );
        })()}
      </td>
    ),
  },
  {
    key: 'received',
    label: 'Received',
    renderCell: (t) => (
      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {formatDate(t.email_received_at || t.created_at)}
      </td>
    ),
  },
  {
    key: 'updated',
    label: 'Updated',
    renderCell: (t) => (
      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {formatDate(t.updated_at)}
      </td>
    ),
  },
];

// ---- Stats bar -----------------------------------------------------------

function StatsBar({ stats, onStatClick, activeStatus }) {
  const items = [
    { key: 'open', label: 'Open', color: 'var(--accent)' },
    { key: 'in_progress', label: 'In Progress', color: 'var(--yellow)' },
    { key: 'pending', label: 'Pending', color: 'var(--purple)' },
    { key: 'resolved', label: 'Resolved', color: 'var(--green)' },
  ];

  return (
    <div style={styles.statsBar}>
      {items.map(({ key, label, color }) => (
        <button
          key={key}
          className="stat-pill"
          onClick={() => onStatClick(key)}
          style={{
            cursor: 'pointer',
            border: activeStatus === key ? `1px solid ${color}` : '1px solid var(--border)',
            background: activeStatus === key ? `rgba(0,0,0,0.2)` : 'var(--surface)',
          }}
          title={`Filter by ${label}`}
        >
          <span className="stat-count" style={{ color }}>
            {stats ? (stats[key] ?? 0) : '—'}
          </span>
          <span className="stat-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ---- Queue page ----------------------------------------------------------

const STATUS_OPTIONS = [
  { value: 'active', label: 'All Active' },
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export default function Queue() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const memberships = user?.departments || [];
  // A picker only matters once someone belongs to (or, as admin, can see across)
  // more than one department — dormant today, since there's exactly one.
  const showDeptPicker = isAdmin || memberships.length > 1;

  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [assetMap, setAssetMap] = useState({});
  const [users, setUsers] = useState([]);

  // Filters
  const [status, setStatus] = useState('active');
  const [priority, setPriority] = useState('all');
  const [searchRaw, setSearchRaw] = useState('');
  const [q, setQ] = useState(''); // debounced value
  // Admins default to "All Departments" (omit the filter — unchanged today's
  // behavior); everyone else defaults to their first (today, only) membership.
  const [departmentId, setDepartmentId] = useState(() => (isAdmin ? null : memberships[0]?.id ?? null));

  const activeDept = departmentId != null ? memberships.find((d) => d.id === departmentId) : null;
  // No department selected (or its visible_columns is null) => show every column,
  // exactly matching today's look for the one real department.
  const displayColumns = activeDept?.visible_columns
    ? COLUMNS.filter((c) => activeDept.visible_columns.includes(c.key))
    : COLUMNS;

  // Sort
  const [sortCol, setSortCol] = useState('received');
  const [sortDir, setSortDir] = useState('desc');

  // Tracks known ticket IDs and unread IDs to detect new ones for the ping alert.
  // null = first load (no ping yet).
  const knownRef = useRef(null);

  // Debounce search input
  const debounceRef = useRef(null);
  function handleSearchChange(e) {
    const val = e.target.value;
    setSearchRaw(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQ(val), 300);
  }

  // ---- Fetch data --------------------------------------------------------
  // silent=true → background auto-refresh: no spinner, no selection reset
  const fetchAll = useCallback(
    async (isRefresh = false, silent = false) => {
      if (!silent) {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
      }
      setError('');
      try {
        const [ticketData, statsData] = await Promise.all([
          getTickets({ status, priority, q, department_id: departmentId }),
          getStats(departmentId),
        ]);
        const ticketList = Array.isArray(ticketData) ? ticketData : (ticketData.items ?? []);
        setTickets(ticketList);
        setStats(statsData);

        // Ping if new tickets or new unread messages appeared (skip on first load)
        const newIds = new Set(ticketList.map((t) => t.id));
        const newUnread = new Set(ticketList.filter((t) => t.has_unread).map((t) => t.id));
        if (knownRef.current !== null) {
          const { ids: prevIds, unread: prevUnread } = knownRef.current;
          const hasNewTicket = [...newIds].some((id) => !prevIds.has(id));
          const hasNewUnread = [...newUnread].some((id) => !prevUnread.has(id));
          if (hasNewTicket || hasNewUnread) {
            playPing();
            const body = hasNewTicket ? 'A new ticket has been submitted.' : 'A ticket has a new reply.';
            showNotification('IT Helpdesk', body);
          }
        }
        knownRef.current = { ids: newIds, unread: newUnread };

        // Fetch asset info for all unique requester emails
        const upns = [...new Set(ticketList.map((t) => t.requester_email).filter(Boolean))];
        getAssetsByUpns(upns).then(setAssetMap).catch(() => {});
      } catch (err) {
        if (!silent) setError(err.message || 'Failed to load tickets.');
      } finally {
        if (!silent) {
          setLoading(false);
          setRefreshing(false);
          setSelected(new Set());
        }
      }
    },
    [status, priority, q, departmentId]
  );

  // ---- Selection ---------------------------------------------------------
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === tickets.length && tickets.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tickets.map((t) => t.id)));
    }
  }

  // ---- Delete selected ---------------------------------------------------
  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Permanently delete ${selected.size} ticket${selected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTickets([...selected]);
      await fetchAll(true);
    } catch (err) {
      setError(err.message || 'Failed to delete tickets.');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    getUsers().then(setUsers).catch(() => {});
  }, []);

  // Auto-refresh every 10 seconds — silent so it doesn't flash the UI or clear selections
  useEffect(() => {
    const id = setInterval(() => fetchAll(false, true), 10_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ---- Sort --------------------------------------------------------------
  const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
  const STATUS_ORDER = { open: 0, in_progress: 1, pending: 2, resolved: 3, closed: 4 };

  function handleSortClick(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const sortedTickets = useMemo(() => {
    const copy = [...tickets];
    copy.sort((a, b) => {
      let av, bv;
      switch (sortCol) {
        case 'number':
          av = parseInt((a.number || '0').replace(/\D/g, ''), 10);
          bv = parseInt((b.number || '0').replace(/\D/g, ''), 10);
          break;
        case 'subject':
          av = (a.subject || '').toLowerCase();
          bv = (b.subject || '').toLowerCase();
          break;
        case 'requester':
          av = (a.requester_name || a.requester_email || '').toLowerCase();
          bv = (b.requester_name || b.requester_email || '').toLowerCase();
          break;
        case 'priority':
          av = PRIORITY_ORDER[a.priority] ?? 99;
          bv = PRIORITY_ORDER[b.priority] ?? 99;
          break;
        case 'status':
          av = STATUS_ORDER[a.status] ?? 99;
          bv = STATUS_ORDER[b.status] ?? 99;
          break;
        case 'assigned':
          av = (a.assigned_to_name || a.assigned_to?.display_name || '').toLowerCase();
          bv = (b.assigned_to_name || b.assigned_to?.display_name || '').toLowerCase();
          break;
        case 'asset':
          av = (assetMap[a.requester_email]?.device_name || assetMap[a.requester_email]?.asset_tag || '').toLowerCase();
          bv = (assetMap[b.requester_email]?.device_name || assetMap[b.requester_email]?.asset_tag || '').toLowerCase();
          break;
        case 'received':
          av = new Date(a.email_received_at || a.created_at || 0).getTime();
          bv = new Date(b.email_received_at || b.created_at || 0).getTime();
          break;
        case 'updated':
          av = new Date(a.updated_at || 0).getTime();
          bv = new Date(b.updated_at || 0).getTime();
          break;
        default:
          return 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [tickets, sortCol, sortDir]);

  // ---- Stat pill click ---------------------------------------------------
  function handleStatClick(key) {
    if (status === key) {
      setStatus('all'); // toggle off
    } else {
      setStatus(key);
    }
  }

  // ---- Inline field update -----------------------------------------------
  async function handleInlineUpdate(ticketId, changes) {
    try {
      await updateTicket(ticketId, changes);
      setTickets(prev => prev.map(t => {
        if (t.id !== ticketId) return t;
        const updated = { ...t, ...changes };
        if ('assigned_to_id' in changes) {
          updated.assigned_to = users.find(u => u.id === changes.assigned_to_id) || null;
        }
        return updated;
      }));
    } catch (err) {
      setError(err.message || 'Failed to update ticket.');
    }
  }

  // ---- Logout ------------------------------------------------------------
  async function handleLogout() {
    try {
      await apiLogout();
    } catch {
      // ignore errors — proceed anyway
    }
    setUser(null);
  }

  // ---- Render ------------------------------------------------------------
  return (
    <div style={styles.page}>
      <TopBar user={user} onLogout={handleLogout} />

      <main style={styles.main}>
        {/* Stats bar */}
        <StatsBar stats={stats} onStatClick={handleStatClick} activeStatus={status} />

        {/* Filter bar */}
        <div style={styles.filterBar}>
          <div style={styles.filterLeft}>
            {showDeptPicker && (
              <select
                value={departmentId ?? ''}
                onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}
                style={styles.filterSelect}
                aria-label="Filter by department"
              >
                {isAdmin && <option value="">All Departments</option>}
                {memberships.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={styles.filterSelect}
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={styles.filterSelect}
              aria-label="Filter by priority"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Search subject or requester…"
              value={searchRaw}
              onChange={handleSearchChange}
              style={styles.searchInput}
              aria-label="Search tickets"
            />
          </div>
          <div style={styles.filterRight}>
            {selected.size > 0 && (
              <button
                className="btn"
                onClick={handleDeleteSelected}
                disabled={deleting}
                style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
              >
                {deleting ? 'Deleting…' : `Delete ${selected.size} selected`}
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={async () => {
                setRefreshing(true);
                try { await pollEmails(); } catch { /* non-fatal */ }
                fetchAll(true);
              }}
              disabled={refreshing}
              title="Check for new emails and refresh ticket list"
            >
              {refreshing ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, display: 'inline-block' }} />
                  Refreshing…
                </>
              ) : (
                <>&#8635; Refresh</>
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 9h18M9 5v4M15 5v4" />
              </svg>
              <p>No tickets found</p>
              <p style={{ fontSize: 13, marginTop: 4, color: 'var(--gray)' }}>Try adjusting your filters or search.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36, padding: '0.5rem 0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={selected.size === tickets.length && tickets.length > 0}
                        ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < tickets.length; }}
                        onChange={toggleSelectAll}
                        aria-label="Select all tickets"
                      />
                    </th>
                    {displayColumns.map(({ key, label }) => (
                      <th
                        key={key}
                        onClick={() => handleSortClick(key)}
                        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                        title={`Sort by ${label}`}
                      >
                        {label}
                        {sortCol === key ? (
                          <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>
                            {sortDir === 'asc' ? '▲' : '▼'}
                          </span>
                        ) : (
                          <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.25 }}>⇅</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTickets.map((t) => (
                    <tr
                      key={t.id}
                      onClick={(e) => { if (e.target.type !== 'checkbox') navigate(`/tickets/${t.id}`); }}
                      title={`View ticket #${t.number ?? t.id}`}
                      style={selected.has(t.id) ? { background: 'rgba(56,189,248,0.07)' } : undefined}
                    >
                      <td style={{ width: 36, padding: '0.5rem 0.75rem' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          aria-label={`Select ticket ${t.number}`}
                        />
                      </td>
                      {displayColumns.map((col) => (
                        <React.Fragment key={col.key}>
                          {col.renderCell(t, { users, assetMap, handleInlineUpdate })}
                        </React.Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Row count */}
        {!loading && tickets.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: '0.5rem', textAlign: 'right' }}>
            Showing {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
          </p>
        )}
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    padding: '1.25rem 1.5rem',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  statsBar: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
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
    alignItems: 'center',
    gap: '0.5rem',
    flex: 1,
    flexWrap: 'wrap',
  },
  filterRight: {
    display: 'flex',
    gap: '0.5rem',
  },
  filterSelect: {
    width: 'auto',
    minWidth: '140px',
  },
  searchInput: {
    minWidth: '200px',
    flex: 1,
    maxWidth: '360px',
  },
};
