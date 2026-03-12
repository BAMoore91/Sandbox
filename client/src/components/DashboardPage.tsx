import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';

interface Stats {
  currentCount: number;
  todayAdmitted: number;
  todayDenied: number;
  hourlyBreakdown: Array<{ hour: string; cnt: number }>;
}

export default function DashboardPage() {
  const { activeOrgId, orgs } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const activeOrg = orgs.find((o) => o.org_id === activeOrgId);

  const fetchStats = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const data = await api.get<Stats>(`/api/orgs/${activeOrgId}/stats`);
      setStats(data);
    } catch {
      // silently fail on background refresh
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, api]);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 30_000); // auto-refresh every 30s
    return () => clearInterval(timer);
  }, [fetchStats]);

  async function handleCheckoutAll() {
    if (!activeOrgId) return;
    if (!confirm('Check out ALL patrons? This marks everyone as having left.')) return;
    try {
      await api.post(`/api/orgs/${activeOrgId}/scans/checkout-all`, {});
      toast('All patrons checked out', 'success');
      fetchStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }

  if (!activeOrgId) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>No organization selected.</p>
        <button className="btn btn-primary" onClick={() => navigate('/admin')}>
          Create Organization
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{activeOrg?.name ?? 'Dashboard'}</h1>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '.8rem', padding: '.4rem .8rem' }}
          onClick={fetchStats}
          disabled={loading}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* Big patron counter */}
      <div className="patron-counter card" style={{ marginBottom: '1.2rem' }}>
        <div className="patron-counter__number">
          {stats?.currentCount ?? '—'}
        </div>
        <div className="patron-counter__label">Patrons currently inside</div>
        <button
          className="btn btn-primary"
          style={{ marginTop: '1.5rem', width: '100%' }}
          onClick={() => navigate('/scan')}
        >
          📷 Scan ID
        </button>
      </div>

      {/* Today's stats */}
      {stats && (
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-item__value">{stats.todayAdmitted}</div>
            <div className="stat-item__label">Admitted Today</div>
          </div>
          <div className="stat-item">
            <div className="stat-item__value" style={{ color: 'var(--red)' }}>
              {stats.todayDenied}
            </div>
            <div className="stat-item__label">Denied Today</div>
          </div>
          <div className="stat-item">
            <div className="stat-item__value" style={{ color: 'var(--green)' }}>
              {stats.currentCount}
            </div>
            <div className="stat-item__label">Inside Now</div>
          </div>
          <div className="stat-item">
            <div className="stat-item__value">
              {stats.todayAdmitted > 0
                ? Math.round((stats.todayDenied / stats.todayAdmitted) * 100)
                : 0}%
            </div>
            <div className="stat-item__label">Denial Rate</div>
          </div>
        </div>
      )}

      {/* Hourly breakdown */}
      {stats && stats.hourlyBreakdown.length > 0 && (
        <div className="card" style={{ marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '.9rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Hourly Check-ins
          </h2>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '60px' }}>
            {(() => {
              const max = Math.max(...stats.hourlyBreakdown.map((h) => h.cnt), 1);
              return stats.hourlyBreakdown.map((h) => (
                <div
                  key={h.hour}
                  title={`${h.hour}:00 — ${h.cnt} check-ins`}
                  style={{
                    flex: 1,
                    background: 'var(--accent)',
                    borderRadius: '3px 3px 0 0',
                    height: `${Math.max((h.cnt / max) * 100, 8)}%`,
                    opacity: .8,
                  }}
                />
              ));
            })()}
          </div>
        </div>
      )}

      {/* End of night */}
      {(stats?.currentCount ?? 0) > 0 && (
        <button className="btn btn-danger btn-full" onClick={handleCheckoutAll}>
          🌙 End of Night – Check Out All ({stats?.currentCount})
        </button>
      )}
    </div>
  );
}
