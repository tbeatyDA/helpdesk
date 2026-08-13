import React, { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '../components/TopBar.jsx';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { getTicket, updateTicket, replyToTicket, getUsers, logout as apiLogout, markTicketRead } from '../api.js';

// ---- Helpers -------------------------------------------------------------

function formatDateFull(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date)) return '—';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateRelative(dateStr) {
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
  return <span className={`badge badge-${status}`}>{toDisplayLabel(status)}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`badge badge-${priority}`}>{toDisplayLabel(priority)}</span>;
}

// ---- Message card --------------------------------------------------------

function MessageCard({ msg }) {
  const isInbound = msg.direction === 'inbound';
  const hasHtml = Boolean(msg.body_html);
  const [showHtml, setShowHtml] = React.useState(hasHtml);

  const htmlDoc = msg.body_html
    ? `<!DOCTYPE html><html><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">
        <style>
        body{margin:0;padding:0;font-family:sans-serif;font-size:13.5px;background:transparent;word-break:break-word;}
        *{color:#cbd5e1 !important;background-color:transparent !important;}
        img{max-width:100%;height:auto;}
        a,a *{color:#38bdf8 !important;}
      </style></head><body>${msg.body_html}</body></html>`
    : '';

  return (
    <div style={{
      ...msgStyles.card,
      borderLeft: `3px solid ${isInbound ? '#38bdf8' : '#4ade80'}`,
    }}>
      <div style={msgStyles.header}>
        <div style={msgStyles.headerLeft}>
          <span style={msgStyles.direction}>
            {isInbound ? '← Inbound' : '→ Outbound'}
          </span>
          <span style={msgStyles.from}>
            {msg.from_name ? (
              <>{msg.from_name} <span style={{ color: '#64748b' }}>({msg.from_email})</span></>
            ) : (
              msg.from_email || '—'
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {hasHtml && (
            <button
              onClick={() => setShowHtml(v => !v)}
              style={{ fontSize: 11, color: '#64748b', background: 'none', border: '1px solid #334155', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
            >
              {showHtml ? 'Plain text' : 'Formatted'}
            </button>
          )}
          <span style={msgStyles.ts} title={formatDateFull(msg.created_at)}>
            {formatDateRelative(msg.created_at)}
          </span>
        </div>
      </div>

      {showHtml && hasHtml ? (
        <iframe
          srcDoc={htmlDoc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={{ width: '100%', border: 'none', minHeight: 80, display: 'block' }}
          onLoad={(e) => {
            try {
              const h = e.target.contentDocument?.body?.scrollHeight;
              if (h) e.target.style.height = h + 16 + 'px';
            } catch (_) {}
          }}
          title="Email content"
        />
      ) : (
        <div style={msgStyles.body}>
          {msg.body_text || msg.body_html || <em style={{ color: '#64748b' }}>(empty message)</em>}
        </div>
      )}
    </div>
  );
}

const msgStyles = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '0.9rem 1rem',
    marginBottom: '0.75rem',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.5rem',
    flexWrap: 'wrap',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.6rem',
    flexWrap: 'wrap',
  },
  direction: {
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#64748b',
  },
  from: {
    fontSize: '13px',
    color: '#f1f5f9',
    fontWeight: '500',
  },
  ts: {
    fontSize: '12px',
    color: '#64748b',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  body: {
    fontSize: '13.5px',
    color: '#cbd5e1',
    lineHeight: '1.65',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

// ---- Reply box -----------------------------------------------------------

function ReplyBox({ ticketId, onReplySent }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textRef = useRef(null);

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError('');
    try {
      await replyToTicket(ticketId, trimmed);
      setBody('');
      onReplySent();
    } catch (err) {
      setError(err.message || 'Failed to send reply.');
    } finally {
      setSending(false);
      textRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div style={replyStyles.wrap}>
      <p className="section-label">Reply</p>
      {error && <div className="error-banner" style={{ marginBottom: '0.5rem' }}>{error}</div>}
      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your reply… (Ctrl+Enter to send)"
        rows={5}
        disabled={sending}
        style={{ marginBottom: '0.6rem' }}
      />
      <div style={replyStyles.actions}>
        <span style={{ fontSize: '12px', color: '#475569' }}>Ctrl+Enter to send</span>
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={sending || !body.trim()}
        >
          {sending ? 'Sending…' : 'Send Reply'}
        </button>
      </div>
    </div>
  );
}

const replyStyles = {
  wrap: {
    marginTop: '1rem',
    padding: '1rem',
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
};

// ---- Sidebar field -------------------------------------------------------

function SidebarField({ label, children }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <p className="section-label">{label}</p>
      {children}
    </div>
  );
}

// ---- Event timeline item -------------------------------------------------

function EventItem({ ev }) {
  return (
    <div style={evStyles.item}>
      <div style={evStyles.dot} />
      <div style={evStyles.content}>
        <span style={evStyles.text}>{ev.description || ev.event_type || 'Event'}</span>
        <span style={evStyles.ts} title={formatDateFull(ev.created_at)}>
          {formatDateRelative(ev.created_at)}
        </span>
      </div>
    </div>
  );
}

const evStyles = {
  item: {
    display: 'flex',
    gap: '0.6rem',
    alignItems: 'flex-start',
    paddingBottom: '0.6rem',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#334155',
    marginTop: 5,
    flexShrink: 0,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    flex: 1,
  },
  text: {
    fontSize: '12.5px',
    color: '#cbd5e1',
    lineHeight: 1.4,
  },
  ts: {
    fontSize: '11px',
    color: '#64748b',
  },
};

// ---- Ticket page ---------------------------------------------------------

const STATUS_OPTIONS = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'];
const CATEGORY_OPTIONS = ['Hardware', 'Software', 'Network', 'Access', 'Account', 'Other'];

export default function Ticket() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [users, setUsers] = useState([]);

  // ---- Fetch ticket -------------------------------------------------------
  const fetchTicket = useCallback(async () => {
    setError('');
    try {
      const data = await getTicket(id);
      setTicket(data);
      if (data.has_unread) markTicketRead(id).catch(() => {});
    } catch (err) {
      setError(err.message || 'Failed to load ticket.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTicket();
    getUsers().then(setUsers).catch(() => {});
  }, [fetchTicket]);

  // ---- Update field -------------------------------------------------------
  async function handleUpdate(field, value) {
    setUpdateError('');
    // Optimistic UI: update local state first
    setTicket((prev) => ({ ...prev, [field]: value }));
    try {
      const updated = await updateTicket(id, { [field]: value });
      if (updated) setTicket(updated);
    } catch (err) {
      setUpdateError(err.message || 'Failed to save change.');
      // Revert by re-fetching
      fetchTicket();
    }
  }

  // ---- Assign to me -------------------------------------------------------
  async function handleAssignToMe() {
    if (!user?.id) return;
    setAssigning(true);
    setUpdateError('');
    try {
      const updated = await updateTicket(id, { assigned_to_id: user.id });
      if (updated) setTicket(updated);
      else fetchTicket();
    } catch (err) {
      setUpdateError(err.message || 'Failed to assign ticket.');
    } finally {
      setAssigning(false);
    }
  }

  // ---- Logout -------------------------------------------------------------
  async function handleLogout() {
    try { await apiLogout(); } catch { /* ignore */ }
    setUser(null);
  }

  // ---- Render loading / error --------------------------------------------
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a' }}>
        <TopBar user={user} onLogout={handleLogout} />
        <div className="spinner-page"><div className="spinner" /></div>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a' }}>
        <TopBar user={user} onLogout={handleLogout} />
        <div style={{ padding: '2rem 1.5rem' }}>
          <div className="error-banner">{error}</div>
          <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => navigate('/')}>
            ← Back to Queue
          </button>
        </div>
      </div>
    );
  }

  const messages = ticket?.messages || ticket?.emails || [];
  const events = ticket?.events || ticket?.timeline || [];
  const assignee = ticket?.assigned_to;

  return (
    <div style={pageStyles.page}>
      <TopBar user={user} onLogout={handleLogout} />

      <main style={pageStyles.main}>
        {/* Back link */}
        <button
          className="btn btn-ghost"
          onClick={() => navigate('/')}
          style={{ alignSelf: 'flex-start', marginBottom: '0.25rem', padding: '0.3rem 0' }}
        >
          ← Back to Queue
        </button>

        {/* Ticket header */}
        <div style={pageStyles.header}>
          <div style={pageStyles.headerLeft}>
            <span style={pageStyles.ticketNum}>
              #{ticket?.number ?? ticket?.id}
            </span>
            <h2 style={pageStyles.subject}>{ticket?.subject || '(No subject)'}</h2>
          </div>
          <div style={pageStyles.headerBadges}>
            <StatusBadge status={ticket?.status || 'open'} />
            <PriorityBadge priority={ticket?.priority || 'normal'} />
            {ticket?.status === 'closed' ? (
              <button
                className="btn btn-secondary"
                onClick={() => handleUpdate('status', 'open')}
                title="Reopen this ticket"
              >
                Reopen
              </button>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => handleUpdate('status', 'closed')}
                title="Close this ticket"
              >
                Close Ticket
              </button>
            )}
          </div>
        </div>

        {updateError && (
          <div className="error-banner" style={{ marginBottom: '0.5rem' }}>{updateError}</div>
        )}

        {/* Two-column layout */}
        <div style={pageStyles.columns}>
          {/* ---- Left: email thread ---- */}
          <div style={pageStyles.left}>
            <p className="section-label" style={{ marginBottom: '0.75rem' }}>
              Conversation ({messages.length} message{messages.length !== 1 ? 's' : ''})
            </p>

            {messages.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13, padding: '1.5rem 0' }}>
                No messages yet.
              </div>
            ) : (
              messages.map((msg, i) => <MessageCard key={msg.id ?? i} msg={msg} />)
            )}

            <ReplyBox ticketId={id} onReplySent={fetchTicket} />
          </div>

          {/* ---- Right: sidebar ---- */}
          <div style={pageStyles.right}>
            <div className="card" style={{ padding: '1.1rem' }}>
              {/* Requester info */}
              <SidebarField label="Requester">
                <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500 }}>
                  {ticket?.requester_name || '—'}
                </div>
                {ticket?.requester_email && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    <a href={`mailto:${ticket.requester_email}`}>{ticket.requester_email}</a>
                  </div>
                )}
              </SidebarField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <p className="section-label">Created</p>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }} title={formatDateFull(ticket?.created_at)}>
                    {formatDateRelative(ticket?.created_at)}
                  </span>
                </div>
                <div>
                  <p className="section-label">Updated</p>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }} title={formatDateFull(ticket?.updated_at)}>
                    {formatDateRelative(ticket?.updated_at)}
                  </span>
                </div>
              </div>

              <hr />

              {/* Status */}
              <SidebarField label="Status">
                <select
                  value={ticket?.status || 'open'}
                  onChange={(e) => handleUpdate('status', e.target.value)}
                  aria-label="Change ticket status"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{toDisplayLabel(s)}</option>
                  ))}
                </select>
              </SidebarField>

              {/* Priority */}
              <SidebarField label="Priority">
                <select
                  value={ticket?.priority || 'normal'}
                  onChange={(e) => handleUpdate('priority', e.target.value)}
                  aria-label="Change ticket priority"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{toDisplayLabel(p)}</option>
                  ))}
                </select>
              </SidebarField>

              {/* Category */}
              <SidebarField label="Category">
                <select
                  value={ticket?.category || ''}
                  onChange={(e) => handleUpdate('category', e.target.value)}
                  aria-label="Change ticket category"
                >
                  <option value="">— Select category —</option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </SidebarField>

              {/* Assigned to */}
              <SidebarField label="Assigned To">
                <select
                  value={ticket?.assigned_to_id ?? ''}
                  onChange={(e) => handleUpdate('assigned_to_id', e.target.value ? parseInt(e.target.value) : null)}
                  disabled={assigning}
                  aria-label="Assign ticket to tech"
                >
                  <option value="">— Unassigned —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}{u.id === user?.id ? ' (me)' : ''}
                    </option>
                  ))}
                </select>
              </SidebarField>

              <hr />

              {/* Events timeline */}
              <div>
                <p className="section-label" style={{ marginBottom: '0.6rem' }}>Timeline</p>
                {events.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#64748b' }}>No events yet.</p>
                ) : (
                  <div style={{ borderLeft: '2px solid #334155', paddingLeft: '0.75rem' }}>
                    {events.map((ev, i) => (
                      <EventItem key={ev.id ?? i} ev={ev} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}


const pageStyles = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    padding: '1.25rem 1.5rem',
    maxWidth: '1400px',
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    padding: '0.25rem 0',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.6rem',
    flex: 1,
    minWidth: 0,
  },
  ticketNum: {
    fontSize: '14px',
    color: '#64748b',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },
  subject: {
    fontSize: '1.2rem',
    fontWeight: '700',
    color: '#f1f5f9',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    margin: 0,
  },
  headerBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexShrink: 0,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 300px',
    gap: '1.25rem',
    alignItems: 'flex-start',
  },
  left: {
    minWidth: 0,
  },
  right: {
    minWidth: 0,
  },
};
