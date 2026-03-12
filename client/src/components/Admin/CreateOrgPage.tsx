import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

export default function CreateOrgPage() {
  const api = useApi();
  const { setActiveOrg, orgs, login, token, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    licenseNumber: '',
    timezone: 'America/Chicago',
  });
  const [saving, setSaving] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post<{
        org: { id: string; name: string; slug: string };
        role: string;
      }>('/api/orgs', {
        name: form.name.trim(),
        address: form.address || undefined,
        phone: form.phone || undefined,
        licenseNumber: form.licenseNumber || undefined,
        timezone: form.timezone,
      });

      const newOrg = { org_id: res.org.id, name: res.org.name, slug: res.org.slug, role: 'owner' };
      const updatedOrgs = [...orgs, newOrg];
      login(token!, user, updatedOrgs, res.org.id);
      setActiveOrg(res.org.id);
      toast(`"${res.org.name}" created!`, 'success');
      navigate('/admin');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error creating org', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.2rem' }}>
        Create New Organization
      </h2>

      <div className="field">
        <label className="label">Establishment Name *</label>
        <input
          className="input"
          placeholder="The Rusty Anchor Bar & Grill"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label className="label">Address</label>
        <input
          className="input"
          placeholder="123 Main St, Austin, TX 78701"
          value={form.address}
          onChange={(e) => update('address', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label">Phone</label>
        <input
          className="input"
          placeholder="(512) 555-0100"
          value={form.phone}
          onChange={(e) => update('phone', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label">Liquor License Number</label>
        <input
          className="input"
          placeholder="Optional"
          value={form.licenseNumber}
          onChange={(e) => update('licenseNumber', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label">Timezone</label>
        <select
          className="input"
          value={form.timezone}
          onChange={(e) => update('timezone', e.target.value)}
        >
          <option value="America/New_York">Eastern</option>
          <option value="America/Chicago">Central</option>
          <option value="America/Denver">Mountain</option>
          <option value="America/Los_Angeles">Pacific</option>
          <option value="America/Anchorage">Alaska</option>
          <option value="Pacific/Honolulu">Hawaii</option>
        </select>
      </div>

      <button type="submit" className="btn btn-primary btn-full" disabled={saving || !form.name.trim()}>
        {saving ? 'Creating…' : 'Create Organization'}
      </button>
    </form>
  );
}
