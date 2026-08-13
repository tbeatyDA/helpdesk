import React, { useEffect, useState } from 'react';
import { useAuth } from '../App.jsx';
import {
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getAdminUsers, updateAdminUser, addUserDepartment, removeUserDepartment,
  logout as apiLogout,
} from '../api.js';
import { COLUMNS } from './Queue.jsx';
import TopBar from '../components/TopBar.jsx';

const TABS = [
  { key: 'departments', label: 'Departments' },
  { key: 'users', label: 'Users' },
];

export default function Admin() {
  const { user, setUser } = useAuth();
  const [tab, setTab] = useState('departments');

  async function handleLogout() {
    try { await apiLogout(); } catch { /* ignore */ }
    setUser(null);
  }

  return (
    <div style={styles.page}>
      <TopBar user={user} onLogout={handleLogout} />
      <main style={styles.main}>
        <nav style={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              className="btn"
              style={tab === t.key ? styles.tabActive : styles.tabInactive}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'departments' ? <DepartmentsPanel /> : <UsersPanel />}
      </main>
    </div>
  );
}

// ---- Departments -----------------------------------------------------------

function emptyDeptForm() {
  return { name: '', slug: '', mailbox: '', columns: new Set(COLUMNS.map((c) => c.key)) };
}

function DepartmentsPanel() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = not editing, 'new' = creating, id = editing that row
  const [form, setForm] = useState(emptyDeptForm());
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    getDepartments()
      .then(setDepartments)
      .catch((err) => setError(err.message || 'Failed to load departments.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startCreate() {
    setForm(emptyDeptForm());
    setEditingId('new');
  }

  function startEdit(dept) {
    setForm({
      name: dept.name,
      slug: dept.slug,
      mailbox: dept.mailbox_email || '',
      columns: new Set(dept.visible_columns || COLUMNS.map((c) => c.key)),
    });
    setEditingId(dept.id);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function toggleColumn(key) {
    setForm((f) => {
      const next = new Set(f.columns);
      next.has(key) ? next.delete(key) : next.add(key);
      return { ...f, columns: next };
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    // Showing every column is the common case — store it as "no restriction"
    // (null) rather than an explicit list of everything, matching what a
    // brand-new department already means today.
    const visible_columns = form.columns.size === COLUMNS.length ? null : [...form.columns];
    const mailbox_email = form.mailbox.trim();
    try {
      if (editingId === 'new') {
        const created = await createDepartment({ name: form.name, slug: form.slug, visible_columns, mailbox_email });
        setDepartments((prev) => [...prev, created]);
      } else {
        const updated = await updateDepartment(editingId, { name: form.name, slug: form.slug, visible_columns, mailbox_email });
        setDepartments((prev) => prev.map((d) => (d.id === editingId ? updated : d)));
      }
      setEditingId(null);
    } catch (err) {
      setError(err.message || 'Failed to save department.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(dept) {
    if (!window.confirm(`Delete "${dept.name}"? Its tickets and memberships will be unassigned, not deleted.`)) return;
    setError('');
    try {
      await deleteDepartment(dept.id);
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    } catch (err) {
      setError(err.message || 'Failed to delete department.');
    }
  }

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <p className="section-label" style={{ margin: 0 }}>Departments</p>
        {editingId === null && (
          <button className="btn btn-primary" onClick={startCreate}>+ New Department</button>
        )}
      </div>

      {error && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {editingId !== null && (
        <div className="card" style={styles.form}>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>
              Name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Human Resources"
              />
            </label>
            <label style={styles.formLabel}>
              Slug
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
                placeholder="e.g. hr"
              />
            </label>
            <label style={styles.formLabel}>
              Mailbox email
              <input
                type="email"
                value={form.mailbox}
                onChange={(e) => setForm((f) => ({ ...f, mailbox: e.target.value }))}
                placeholder="e.g. hr@dayair.org (leave blank for no email intake)"
              />
            </label>
          </div>
          {form.mailbox.trim() && (
            <p style={styles.helpText}>
              This mailbox must already exist in Microsoft 365 and be added to the{' '}
              <code>helpdesk-app-scope</code> access group in Exchange Online before mail sent
              to it will create tickets here — that step can't be done from this page. Allow up
              to 30 minutes after adding it for the change to take effect.
            </p>
          )}

          <p className="section-label" style={{ marginTop: '0.75rem' }}>Visible ticket columns</p>
          <div style={styles.checkGrid}>
            {COLUMNS.map((c) => (
              <label key={c.key} style={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={form.columns.has(c.key)}
                  onChange={() => toggleColumn(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>

          <div style={styles.formActions}>
            <button className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !form.name.trim() || !form.slug.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" /></div>
        ) : departments.length === 0 ? (
          <div className="empty-state"><p>No departments yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Mailbox</th>
                  <th>Columns</th>
                  <th style={{ textAlign: 'right' }}>Members</th>
                  <th style={{ textAlign: 'right' }}>Tickets</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id} style={{ cursor: 'default' }}>
                    <td>{d.name}</td>
                    <td style={{ color: 'var(--muted)' }}>{d.slug}</td>
                    <td style={{ color: d.mailbox_email ? 'var(--body)' : 'var(--muted)' }}>
                      {d.mailbox_email || 'None'}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {d.visible_columns ? `${d.visible_columns.length} of ${COLUMNS.length}` : 'All'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.member_count}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.ticket_count}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-ghost" onClick={() => startEdit(d)}>Edit</button>{' '}
                      <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={() => remove(d)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Users -------------------------------------------------------------------

function UsersPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    Promise.all([getAdminUsers(), getDepartments()])
      .then(([u, d]) => { setUsers(u); setDepartments(d); })
      .catch((err) => setError(err.message || 'Failed to load users.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function changeRole(u, role) {
    setError('');
    try {
      const updated = await updateAdminUser(u.id, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err.message || 'Failed to update role.');
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      const updated = await updateAdminUser(u.id, { is_active: !u.is_active });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err.message || 'Failed to update user.');
    }
  }

  async function addDept(u, departmentId) {
    if (!departmentId) return;
    setError('');
    try {
      await addUserDepartment(u.id, Number(departmentId));
      load();
    } catch (err) {
      setError(err.message || 'Failed to add department.');
    }
  }

  async function removeDept(u, departmentId) {
    setError('');
    try {
      await removeUserDepartment(u.id, departmentId);
      setUsers((prev) => prev.map((x) => (
        x.id === u.id ? { ...x, departments: x.departments.filter((d) => d.id !== departmentId) } : x
      )));
    } catch (err) {
      setError(err.message || 'Failed to remove department.');
    }
  }

  return (
    <div style={styles.panel}>
      <p className="section-label">Users</p>

      {error && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Active</th>
                  <th>Departments</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === me?.id;
                  const availableDepts = departments.filter(
                    (d) => !u.departments.some((ud) => ud.id === d.id)
                  );
                  return (
                    <tr key={u.id} style={{ cursor: 'default' }}>
                      <td>{u.display_name}</td>
                      <td style={{ color: 'var(--muted)' }}>{u.email}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          value={u.role}
                          onChange={(e) => changeRole(u, e.target.value)}
                          disabled={isSelf}
                          title={isSelf ? "You can't change your own role" : undefined}
                          style={{ width: 'auto' }}
                        >
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={u.is_active}
                          onChange={() => toggleActive(u)}
                          disabled={isSelf}
                          title={isSelf ? "You can't deactivate your own account" : undefined}
                        />
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 260 }}>
                        <div style={styles.deptChips}>
                          {u.departments.map((d) => (
                            <span key={d.id} className="badge" style={styles.deptChip}>
                              {d.name}
                              <button
                                className="btn-ghost"
                                style={styles.chipRemove}
                                onClick={() => removeDept(u, d.id)}
                                title={`Remove from ${d.name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {availableDepts.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => addDept(u, e.target.value)}
                              style={{ width: 'auto', fontSize: 12, padding: '2px 6px' }}
                            >
                              <option value="">+ Add…</option>
                              {availableDepts.map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Styles ------------------------------------------------------------------

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
    maxWidth: '1100px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  tabs: {
    display: 'flex',
    gap: '0.5rem',
  },
  tabActive: {
    background: 'var(--surface2)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  tabInactive: {
    background: 'transparent',
    color: 'var(--muted)',
    borderColor: 'transparent',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  formRow: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  formLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    fontSize: 12,
    color: 'var(--muted)',
    flex: 1,
    minWidth: 200,
  },
  helpText: {
    fontSize: 12,
    color: 'var(--muted)',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '0.5rem 0.75rem',
    marginTop: '0.5rem',
    lineHeight: 1.5,
  },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '0.4rem',
    marginTop: '0.4rem',
  },
  checkItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: 13,
    color: 'var(--body)',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  deptChips: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    flexWrap: 'wrap',
  },
  deptChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    background: 'var(--surface2)',
    color: 'var(--body)',
    textTransform: 'none',
    letterSpacing: 'normal',
  },
  chipRemove: {
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
  },
};
