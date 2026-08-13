import React from 'react';
import { NavLink } from 'react-router-dom';
import SettingsMenu from './SettingsMenu.jsx';

/** Shared top bar for every helpdesk page — app switcher on the left, in-app
 * page nav next to it (same slot as "Assets" in the inventory app's top bar),
 * user/settings/sign-out pushed to the right by the spacer. */
export default function TopBar({ user, onLogout }) {
  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <span style={styles.appPillActive}>IT Helpdesk</span>
        <a href="https://inventory.dayair.org" style={styles.appPillLink}>IT Inventory</a>
      </div>
      <nav style={styles.nav}>
        <NavLink to="/" end style={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
          Tickets
        </NavLink>
        <NavLink to="/reports" style={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
          Reports
        </NavLink>
      </nav>
      <div style={styles.spacer} />
      <div style={styles.right}>
        <span style={styles.userName}>{user?.display_name || user?.email || 'User'}</span>
        <SettingsMenu />
        <button className="btn btn-secondary" onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </header>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0 1.5rem',
    height: '56px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  left: {
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
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  navLink: {
    fontSize: '0.85rem',
    fontWeight: '500',
    color: '#94a3b8',
    textDecoration: 'none',
    padding: '0.35rem 0.65rem',
    borderRadius: '6px',
  },
  navLinkActive: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#e2e8f0',
    textDecoration: 'none',
    padding: '0.35rem 0.65rem',
    borderRadius: '6px',
    background: '#263347',
  },
  spacer: {
    flex: 1,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  userName: {
    fontSize: '13px',
    color: '#94a3b8',
  },
};
