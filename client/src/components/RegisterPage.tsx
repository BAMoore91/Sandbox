import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';

export default function RegisterPage() {
  const { login } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
    orgName: '',
  });
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'account' | 'org'>('account');

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }

    setLoading(true);
    try {
      // 1. Register user
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
        }),
      });
      const regData = await regRes.json() as {
        token: string;
        user: { id: string; email: string; firstName: string; lastName: string };
        error?: string;
      };
      if (!regRes.ok) throw new Error(regData.error ?? 'Registration failed');

      let orgs: Array<{ org_id: string; name: string; slug: string; role: string }> = [];
      let defaultOrgId: string | undefined;

      // 2. Create org if name provided
      if (form.orgName.trim()) {
        const orgRes = await fetch('/api/orgs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regData.token}`,
          },
          body: JSON.stringify({ name: form.orgName.trim() }),
        });
        const orgData = await orgRes.json() as {
          org: { id: string; name: string; slug: string };
          error?: string;
        };
        if (orgRes.ok) {
          orgs = [{ org_id: orgData.org.id, name: orgData.org.name, slug: orgData.org.slug, role: 'owner' }];
          defaultOrgId = orgData.org.id;
        }
      }

      login(regData.token, regData.user, orgs, defaultOrgId);
      toast('Account created!', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-card__logo">🚪 Doorman</div>

        <form onSubmit={handleSubmit}>
          {step === 'account' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                <div className="field">
                  <label className="label">First Name</label>
                  <input className="input" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} required />
                </div>
                <div className="field">
                  <label className="label">Last Name</label>
                  <input className="input" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} required />
                </div>
              </div>

              <div className="field">
                <label className="label">Email</label>
                <input type="email" className="input" value={form.email} onChange={(e) => update('email', e.target.value)} required autoComplete="email" />
              </div>

              <div className="field">
                <label className="label">Password</label>
                <input type="password" className="input" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={8} autoComplete="new-password" />
              </div>

              <div className="field">
                <label className="label">Confirm Password</label>
                <input type="password" className="input" value={form.confirmPassword} onChange={(e) => update('confirmPassword', e.target.value)} required autoComplete="new-password" />
              </div>

              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={!form.firstName || !form.email || !form.password}
                onClick={() => setStep('org')}
              >
                Continue →
              </button>
            </>
          )}

          {step === 'org' && (
            <>
              <p style={{ color: 'var(--muted)', fontSize: '.9rem', marginBottom: '1.2rem' }}>
                Create your establishment (optional — you can do this later).
              </p>

              <div className="field">
                <label className="label">Establishment Name</label>
                <input
                  className="input"
                  placeholder="The Rusty Anchor Bar & Grill"
                  value={form.orgName}
                  onChange={(e) => update('orgName', e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create Account'}
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-full"
                style={{ marginTop: '.5rem' }}
                onClick={() => setStep('account')}
              >
                ← Back
              </button>
            </>
          )}
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', color: 'var(--muted)', fontSize: '.875rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
