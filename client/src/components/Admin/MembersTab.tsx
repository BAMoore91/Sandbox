import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface Member {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  active: number;
}

export default function MembersTab() {
  const { activeOrgId, orgs, user } = useAuth();
  const api = useApi();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviting, setInviting] = useState(false);

  const myRole = orgs.find((o) => o.org_id === activeOrgId)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';

  const fetchMembers = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const res = await api.get<{ members: Member[] }>(`/api/orgs/${activeOrgId}/members`);
      setMembers(res.members);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error loading members', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, api, toast]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId || !inviteEmail) return;
    setInviting(true);
    try {
      await api.post(`/api/orgs/${activeOrgId}/members`, {
        email: inviteEmail,
        role: inviteRole,
      });
      toast(`${inviteEmail} added as ${inviteRole}`, 'success');
      setInviteEmail('');
      fetchMembers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    if (!activeOrgId) return;
    try {
      await api.patch(`/api/orgs/${activeOrgId}/members/${userId}`, { role });
      toast('Role updated', 'success');
      fetchMembers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }

  async function handleRemove(userId: string, name: string) {
    if (!activeOrgId) return;
    if (!confirm(`Remove ${name} from this organization?`)) return;
    try {
      await api.delete(`/api/orgs/${activeOrgId}/members/${userId}`);
      toast(`${name} removed`, 'success');
      fetchMembers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }

  const ROLE_COLORS: Record<string, string> = {
    owner: 'badge-amber',
    admin: 'badge-blue',
    staff: 'badge-green',
  };

  return (
    <div>
      {/* Invite form */}
      {canManage && (
        <form className="card" onSubmit={handleInvite} style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Add Team Member</h2>
          <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
            The user must already have an account. They'll be added immediately.
          </p>
          <div className="field">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="staff@thebar.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">Role</label>
            <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              <option value="staff">Staff – can scan IDs</option>
              <option value="admin">Admin – can manage members &amp; settings</option>
              {myRole === 'owner' && <option value="owner">Owner – full access</option>}
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={inviting}>
            {inviting ? 'Adding…' : 'Add Member'}
          </button>
        </form>
      )}

      {/* Members list */}
      <div className="card" style={{ padding: '0 1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, padding: '1rem 0 .75rem', borderBottom: '1px solid var(--border)' }}>
          Team Members {loading ? '…' : `(${members.length})`}
        </h2>

        <ul className="patron-list">
          {members.map((m) => {
            const isMe = m.id === user?.id;
            return (
              <li key={m.id} className="patron-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="patron-item__name">
                    {m.first_name} {m.last_name}
                    {isMe && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '.8rem' }}> (you)</span>}
                  </div>
                  <div className="patron-item__meta">{m.email}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
                  {canManage && !isMe ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      style={{
                        background: 'var(--bg)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '.25rem .5rem',
                        fontSize: '.8rem',
                      }}
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      {myRole === 'owner' && <option value="owner">Owner</option>}
                    </select>
                  ) : (
                    <span className={`badge ${ROLE_COLORS[m.role] ?? 'badge-blue'}`}>{m.role}</span>
                  )}

                  {canManage && !isMe && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '.3rem .5rem', fontSize: '.75rem', color: 'var(--red)' }}
                      onClick={() => handleRemove(m.id, `${m.first_name} ${m.last_name}`)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
