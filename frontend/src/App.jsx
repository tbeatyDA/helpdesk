import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getMe } from './api.js';
import Login from './pages/Login.jsx';
import Queue from './pages/Queue.jsx';
import Ticket from './pages/Ticket.jsx';
import Reports from './pages/Reports.jsx';
import { applyTheme, getStoredTheme } from './components/SettingsMenu.jsx';

// Apply persisted theme immediately on load
applyTheme(getStoredTheme());

// ---- Auth context -------------------------------------------------------
export const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

// ---- App ----------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((data) => setUser(data))
      .catch((err) => {
        if (err.status === 401) {
          setUser(null);
        } else {
          // Network error or unexpected — still show login
          console.error('Auth check failed:', err);
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/" element={<Queue />} />
        <Route path="/tickets/:id" element={<Ticket />} />
        <Route path="/reports" element={<Reports />} />
        {/* Catch-all: redirect unknown paths to queue */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
