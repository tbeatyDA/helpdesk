import React, { useEffect, useRef, useState } from 'react';
import {
  isSoundEnabled, setSoundEnabled, playPing,
  isNotifyEnabled, setNotifyEnabled, notifyPermission, requestNotifyPermission, showNotification,
} from '../sound.js';

const THEMES = [
  { id: 'dark',          label: 'Dark' },
  { id: 'light',         label: 'Light' },
  { id: 'dracula',       label: 'Dracula' },
  { id: 'nord',          label: 'Nord' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'monokai',       label: 'Monokai' },
];

const COOKIE_KEY = 'it-theme';
const STORAGE_KEY = 'it.theme';
const DEFAULT_THEME = 'dark';

function getCookieTheme() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)it-theme=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

export function getStoredTheme() {
  return getCookieTheme() || localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
}

export function applyTheme(id) {
  if (id === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  // Write shared cookie so inventory.dayair.org picks it up too
  try {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(id)}; Domain=.dayair.org; Path=/; SameSite=Lax; Expires=${expires}`;
  } catch {}
}

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme);
  const [sound, setSound] = useState(isSoundEnabled);
  const [notify, setNotify] = useState(isNotifyEnabled);
  const [notifyDenied, setNotifyDenied] = useState(() => notifyPermission() === 'denied');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function pickTheme(id) {
    setTheme(id);
    applyTheme(id);
    setOpen(false);
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playPing();
  }

  async function toggleNotify() {
    if (notifyDenied) return;
    if (notify) {
      setNotify(false);
      setNotifyEnabled(false);
      return;
    }
    const permission = await requestNotifyPermission();
    if (permission === 'granted') {
      setNotify(true);
      setNotifyEnabled(true);
      showNotification('IT Helpdesk', 'Browser notifications are on.');
    } else if (permission === 'denied') {
      setNotifyDenied(true);
      setNotify(false);
      setNotifyEnabled(false);
    }
  }

  async function testNotification() {
    // Always request permission first if not yet granted
    if (notifyPermission() !== 'granted') {
      const permission = await requestNotifyPermission();
      if (permission === 'granted') {
        setNotify(true);
        setNotifyEnabled(true);
        setNotifyDenied(false);
      } else if (permission === 'denied') {
        setNotifyDenied(true);
        setNotify(false);
        setNotifyEnabled(false);
        return;
      } else {
        return; // dismissed without choosing
      }
    }
    playPing();
    showNotification('IT Helpdesk', 'Test — new ticket or reply notifications will look like this.');
  }

  return (
    <div className="settings-menu" ref={ref}>
      <button
        className="gear"
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="dropdown" role="menu">
          <div className="section-title">Notifications</div>
          <div
            className="menu-item"
            role="menuitemcheckbox"
            aria-checked={sound}
            onClick={toggleSound}
          >
            <span>Alert sound</span>
            <span className="check">{sound ? '✓' : ''}</span>
          </div>
          <div
            className="menu-item"
            role="menuitemcheckbox"
            aria-checked={notify}
            onClick={toggleNotify}
            title={notifyDenied ? 'Blocked by browser — check site settings' : ''}
            style={notifyDenied ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
          >
            <span>Browser notifications{notifyDenied ? ' (blocked)' : ''}</span>
            <span className="check">{notify ? '✓' : ''}</span>
          </div>
          <div
            className="menu-item"
            onClick={testNotification}
            title={notifyDenied ? 'Blocked by browser — check site settings' : 'Request permission and send a test notification'}
            style={notifyDenied ? { opacity: 0.45, cursor: 'not-allowed' } : { color: 'var(--accent)' }}
          >
            <span>Test notification</span>
            <span style={{ fontSize: 12 }}>▶</span>
          </div>
          <hr className="divider" />
          <div className="section-title">Appearance · Theme</div>
          {THEMES.map(t => (
            <div
              key={t.id}
              className="menu-item"
              role="menuitemradio"
              aria-checked={theme === t.id}
              onClick={() => pickTheme(t.id)}
            >
              <span>{t.label}</span>
              {theme === t.id && <span className="check">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
