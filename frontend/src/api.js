/**
 * API helper module. All requests go to /api/* on the same origin.
 * The backend sets a session cookie — no JWT handling needed here.
 */

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      message = data.detail || data.message || message;
    } catch {
      // non-JSON error body — keep generic message
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

/** Return the currently authenticated user, or throw with status 401. */
export function getMe() {
  return apiFetch('/auth/me');
}

/**
 * Fetch ticket list.
 * @param {Object} params - { status, priority, q }
 */
export function getTickets(params = {}) {
  const qs = new URLSearchParams();
  if (params.status === 'active') {
    qs.set('exclude_closed', 'true');
  } else if (params.status && params.status !== 'all') {
    qs.set('status', params.status);
  }
  if (params.priority && params.priority !== 'all') qs.set('priority', params.priority);
  if (params.q) qs.set('q', params.q);
  const query = qs.toString();
  return apiFetch(`/tickets/${query ? `?${query}` : ''}`);
}

/** Fetch a single ticket with messages and events. */
export function getTicket(id) {
  return apiFetch(`/tickets/${id}`);
}

/**
 * Update ticket fields.
 * @param {string|number} id
 * @param {Object} data - { status?, priority?, category?, assigned_to_id? }
 */
export function updateTicket(id, data) {
  return apiFetch(`/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Post a reply to a ticket.
 * @param {string|number} id
 * @param {string} body - reply text
 */
export function replyToTicket(id, body) {
  return apiFetch(`/tickets/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/** Fetch summary stats (counts per status). */
export function getStats() {
  return apiFetch('/tickets/stats/summary');
}

/**
 * Fetch ticket volume report, grouped by created date.
 * @param {Object} params - { interval: 'week'|'month'|'year', group_by: 'tech'|'department' }
 */
export function getTicketReport(params = {}) {
  const qs = new URLSearchParams();
  qs.set('interval', params.interval || 'month');
  qs.set('group_by', params.group_by || 'department');
  return apiFetch(`/tickets/stats/report?${qs.toString()}`);
}

/** Fetch all active users (for assignment dropdown). */
export function getUsers() {
  return apiFetch('/users/');
}

/** Look up primary assigned assets for a list of requester UPNs (emails). */
export function getAssetsByUpns(upns) {
  if (!upns || upns.length === 0) return Promise.resolve({});
  return apiFetch(`/assets/by-upns?upns=${encodeURIComponent(upns.join(','))}`);
}

/** Bulk delete tickets by ID array. */
export function deleteTickets(ids) {
  return apiFetch('/tickets/', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

/** Log out — clears the session cookie on the backend. */
export function logout() {
  return apiFetch('/auth/logout', { method: 'POST' });
}

/** Trigger an immediate mailbox poll for new emails. */
export function pollEmails() {
  return apiFetch('/tickets/poll', { method: 'POST' });
}

/** Mark a ticket's unread flag as cleared. */
export function markTicketRead(id) {
  return apiFetch(`/tickets/${id}/read`, { method: 'POST' });
}

// ---- Admin (require an admin session; backend enforces this) --------------

/** List departments, each with member/ticket counts. */
export function getDepartments() {
  return apiFetch('/admin/departments');
}

/** Create a department. @param {Object} data - { name, slug, visible_columns } */
export function createDepartment(data) {
  return apiFetch('/admin/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Update a department. @param {Object} data - { name?, slug?, visible_columns? } */
export function updateDepartment(id, data) {
  return apiFetch(`/admin/departments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Delete a department (blocked if it's the only one left). */
export function deleteDepartment(id) {
  return apiFetch(`/admin/departments/${id}`, { method: 'DELETE' });
}

/** List every user with their department memberships. */
export function getAdminUsers() {
  return apiFetch('/admin/users');
}

/** Update a user's global role/active state. @param {Object} data - { role?, is_active? } */
export function updateAdminUser(id, data) {
  return apiFetch(`/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/** Add a user to a department. */
export function addUserDepartment(userId, departmentId) {
  return apiFetch(`/admin/users/${userId}/departments`, {
    method: 'POST',
    body: JSON.stringify({ department_id: departmentId }),
  });
}

/** Remove a user from a department. */
export function removeUserDepartment(userId, departmentId) {
  return apiFetch(`/admin/users/${userId}/departments/${departmentId}`, {
    method: 'DELETE',
  });
}
