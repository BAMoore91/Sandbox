import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';

interface PatronScan {
  id: string;
  first_name: string | null;
  last_name: string | null;
  age_at_scan: number;
  dl_state: string;
  checked_in_at: string;
  checked_out_at: string | null;
  status: 'inside' | 'left' | 'denied';
  staff_first: string;
  staff_last: string;
}

interface ListResponse {
  scans: PatronScan[];
  total: number;
  page: number;
  limit: number;
}

export default function PatronListPage() {
  const { activeOrgId } = useAuth();
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<ListResponse | null>(null);
  const [filter, setFilter] = useState<'inside' | 'all'>('inside');
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const fetchPatrons = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const res = await api.get<ListResponse>(
        `/api/orgs/${activeOrgId}/scans?status=${filter}&date=${today}&limit=100`
      );
      setData(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error loading patrons', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, api, filter, today, toast]);

  useEffect(() => { fetchPatrons(); }, [fetchPatrons]);

  async function checkout(scanId: string) {
    if (!activeOrgId) return;
    try {
      await api.post(`/api/orgs/${activeOrgId}/scans/${scanId}/checkout`, {});
      toast('Patron checked out', 'success');
      fetchPatrons();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Patrons</h1>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button
            className={`btn ${filter === 'inside' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '.4rem .8rem', fontSize: '.8rem' }}
            onClick={() => setFilter('inside')}
          >
            Inside
          </button>
          <button
            className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '.4rem .8rem', fontSize: '.8rem' }}
            onClick={() => setFilter('all')}
          >
            All Today
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '.4rem .8rem', fontSize: '.8rem' }}
            onClick={fetchPatrons}
            disabled={loading}
          >
            ↻
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading…</div>
      )}

      {!loading && data && (
        <>
          <div style={{ color: 'var(--muted)', fontSize: '.8rem', marginBottom: '.75rem' }}>
            {data.total} patron{data.total !== 1 ? 's' : ''}
            {filter === 'inside' ? ' currently inside' : ' checked in today'}
          </div>

          {data.scans.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
              {filter === 'inside' ? 'No one is inside right now.' : 'No check-ins today yet.'}
            </div>
          ) : (
            <div className="card" style={{ padding: '0 1.5rem' }}>
              <ul className="patron-list">
                {data.scans.map((s) => (
                  <li key={s.id} className="patron-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="patron-item__name">
                        {s.first_name || s.last_name
                          ? `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
                          : 'Unknown'}
                      </div>
                      <div className="patron-item__meta">
                        Age {s.age_at_scan} · {s.dl_state} · In {formatTime(s.checked_in_at)}
                        {s.checked_out_at && ` · Out ${formatTime(s.checked_out_at)}`}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
                      <span className={`badge ${s.status === 'inside' ? 'badge-green' : 'badge-blue'}`}>
                        {s.status}
                      </span>
                      {s.status === 'inside' && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '.3rem .6rem', fontSize: '.75rem' }}
                          onClick={() => checkout(s.id)}
                        >
                          Out
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
