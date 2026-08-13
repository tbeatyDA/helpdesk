import React from 'react';
import { NavLink } from 'react-router-dom';
import SettingsMenu from './SettingsMenu.jsx';

/** Shared top bar for every helpdesk page — app switcher on the left, in-app
 * page nav next to it (same slot as "Assets" in the inventory app's top bar),
 * user/settings/sign-out pushed to the right by the spacer. Same .topbar /
 * .app-pill classes as the inventory app, so both render identically. */
export default function TopBar({ user, onLogout }) {
  return (
    <header className="topbar">
      <div className="left">
        <span className="app-pill active">IT Helpdesk</span>
        <a className="app-pill" href="https://inventory.dayair.org">IT Inventory</a>
      </div>
      <nav>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Tickets
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Reports
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Admin
          </NavLink>
        )}
      </nav>
      <div className="spacer" />
      <div className="right">
        <span className="user">{user?.display_name || user?.email || 'User'}</span>
        <SettingsMenu />
        <button className="btn btn-secondary" onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </header>
  );
}
