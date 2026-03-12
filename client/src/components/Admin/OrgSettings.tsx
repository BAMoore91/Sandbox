import { useState, useEffect } from 'react';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface OrgData {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  license_number: string | null;
  timezone: string;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export default function OrgSettings() {
  const { activeOrgId, orgs } = useAuth();
  const api = useApi();
  const toast = useToast();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [saving, setSaving] = useState(false);

  const membership = orgs.find((o) => o.org_id === activeOrgId);
  const canEdit = membership?.role === 'owner' || membership?.role === 'admin';

  useEffect(() => {
    if (!activeOrgId) return;
    api.get<{ org: OrgData }>(`/api/orgs/${activeOrgId}`)
      .then((r) => setOrg(r.org))
      .catch(() => toast('Failed to load org settings', 'error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !activeOrgId) return;
    setSaving(true);
    try {
      await api.patch(`/api/orgs/${activeOrgId}`, {
        name: org.name,
        address: org.address,
        phone: org.phone,
        licenseNumber: org.license_number,
        timezone: org.timezone,
      });
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!activeOrgId) {
    return (
      <div className="card" style={{ color: 'var(--muted)', textAlign: 'center' }}>
        No organization selected.
      </div>
    );
  }

  if (!org) return <div style={{ color: 'var(--muted)' }}>Loading…</div>;

  return (
    <form className="card" onSubmit={handleSave}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.2rem' }}>
        Organization Settings
      </h2>

      {!canEdit && (
        <div style={{ background: 'rgba(245,158,11,.1)', border: '1px solid var(--amber)', borderRadius: 'var(--radius-sm)', padding: '.75rem', marginBottom: '1rem', fontSize: '.85rem', color: 'var(--amber)' }}>
          You have read-only access (staff role).
        </div>
      )}

      <div className="field">
        <label className="label">Establishment Name</label>
        <input
          className="input"
          value={org.name}
          onChange={(e) => setOrg({ ...org, name: e.target.value })}
          disabled={!canEdit}
          required
        />
      </div>

      <div className="field">
        <label className="label">URL Slug</label>
        <input
          className="input"
          value={org.slug}
          disabled
          style={{ opacity: .5 }}
        />
      </div>

      <div className="field">
        <label className="label">Address</label>
        <input
          className="input"
          value={org.address ?? ''}
          onChange={(e) => setOrg({ ...org, address: e.target.value })}
          disabled={!canEdit}
          placeholder="123 Main St, Austin, TX"
        />
      </div>

      <div className="field">
        <label className="label">Phone</label>
        <input
          className="input"
          value={org.phone ?? ''}
          onChange={(e) => setOrg({ ...org, phone: e.target.value })}
          disabled={!canEdit}
          placeholder="(512) 555-0100"
        />
      </div>

      <div className="field">
        <label className="label">Liquor License Number</label>
        <input
          className="input"
          value={org.license_number ?? ''}
          onChange={(e) => setOrg({ ...org, license_number: e.target.value })}
          disabled={!canEdit}
          placeholder="Optional – for records"
        />
      </div>

      <div className="field">
        <label className="label">Timezone</label>
        <select
          className="input"
          value={org.timezone}
          onChange={(e) => setOrg({ ...org, timezone: e.target.value })}
          disabled={!canEdit}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>

      {canEdit && (
        <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      )}
    </form>
  );
}
