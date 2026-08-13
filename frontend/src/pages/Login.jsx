import React from 'react';

// Inline Microsoft logo SVG (official four-square mark)
function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Logo / branding */}
        <div style={styles.logoWrap}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Monitor icon */}
            <rect x="4" y="8" width="40" height="26" rx="3" stroke="#38bdf8" strokeWidth="2.5" fill="none" />
            <rect x="16" y="36" width="16" height="3" rx="1" fill="#38bdf8" />
            <rect x="11" y="39" width="26" height="2" rx="1" fill="#38bdf8" />
            {/* Wrench / tool indicator */}
            <circle cx="24" cy="21" r="6" stroke="#38bdf8" strokeWidth="2" fill="none" />
            <line x1="28.2" y1="25.2" x2="33" y2="30" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <h1 style={styles.title}>Day Air IT Helpdesk</h1>
        <p style={styles.subtitle}>Sign in to manage IT support tickets</p>

        <hr style={styles.divider} />

        {/* Sign in button — direct link to backend OAuth redirect */}
        <a href="/api/auth/login" style={styles.btnWrap}>
          <button className="btn-microsoft" style={styles.msBtn} type="button">
            <MicrosoftLogo />
            Sign in with Microsoft
          </button>
        </a>

        <p style={styles.footer}>
          Day Air Credit Union &mdash; IT Department
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
    padding: '1rem',
  },
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '2.5rem 2.25rem',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0',
    textAlign: 'center',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  },
  logoWrap: {
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: '0.4rem',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '0',
  },
  divider: {
    width: '100%',
    border: 'none',
    borderTop: '1px solid #334155',
    margin: '1.5rem 0',
  },
  btnWrap: {
    textDecoration: 'none',
    width: '100%',
  },
  msBtn: {
    width: '100%',
    justifyContent: 'center',
    fontSize: '15px',
    padding: '0.7rem 1.5rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  footer: {
    marginTop: '1.75rem',
    fontSize: '12px',
    color: '#475569',
  },
};
