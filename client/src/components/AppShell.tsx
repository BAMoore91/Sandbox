import { type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const NAV_ITEMS = [
  { path: '/',        label: 'Dashboard', icon: '📊' },
  { path: '/scan',    label: 'Scan',      icon: '📷' },
  { path: '/patrons', label: 'Patrons',   icon: '👥' },
  { path: '/admin',   label: 'Admin',     icon: '⚙️' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, orgs, activeOrgId, setActiveOrg, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const activeOrg = orgs.find((o) => o.org_id === activeOrgId);

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <span className="topbar__logo">🚪 Doorman</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {orgs.length > 1 ? (
            <select
              value={activeOrgId ?? ''}
              onChange={(e) => setActiveOrg(e.target.value)}
              style={{
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '.3rem .6rem',
                fontSize: '.8rem',
              }}
            >
              {orgs.map((o) => (
                <option key={o.org_id} value={o.org_id}>{o.name}</option>
              ))}
            </select>
          ) : (
            <span className="topbar__org">{activeOrg?.name ?? 'No organization'}</span>
          )}

          <button
            className="btn btn-ghost"
            style={{ padding: '.4rem .8rem', fontSize: '.8rem' }}
            title={`Logged in as ${user?.firstName} ${user?.lastName}`}
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="page-content" style={{ paddingBottom: '5rem' }}>
        {children}
      </main>

      {/* Bottom nav tabs */}
      <nav
        className="nav-tabs"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              className={`nav-tab ${active ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <div>{item.icon}</div>
              <div style={{ fontSize: '.7rem', marginTop: '.1rem' }}>{item.label}</div>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
