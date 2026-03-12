import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import OrgSettings from './OrgSettings';
import MembersTab from './MembersTab';
import CreateOrgPage from './CreateOrgPage';

const ADMIN_TABS = [
  { path: '/admin',         label: 'Settings' },
  { path: '/admin/members', label: 'Team Members' },
  { path: '/admin/new-org', label: '+ New Org' },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Admin</h1>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {ADMIN_TABS.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              className={`btn ${active ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '.5rem 1rem', fontSize: '.85rem' }}
              onClick={() => navigate(tab.path)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <Routes>
        <Route path="/" element={<OrgSettings />} />
        <Route path="/members" element={<MembersTab />} />
        <Route path="/new-org" element={<CreateOrgPage />} />
      </Routes>
    </div>
  );
}
