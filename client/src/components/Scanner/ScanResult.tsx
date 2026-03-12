interface ScanResponse {
  action: 'admitted' | 'denied' | 'already_inside';
  reason?: string;
  message?: string;
  scanId?: string;
  age?: number;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  dlState?: string;
  expirationDate?: string;
  currentCount?: number;
}

interface Props {
  result: ScanResponse;
  onScanAnother: () => void;
  onCheckout?: () => void;
}

export default function ScanResult({ result, onScanAnother, onCheckout }: Props) {
  const isAdmitted = result.action === 'admitted';
  const isAlreadyIn = result.action === 'already_inside';
  const isDenied = result.action === 'denied';

  const accentColor = isAdmitted || isAlreadyIn ? 'var(--green)' : 'var(--red)';
  const icon = isAdmitted ? '✅' : isAlreadyIn ? '🔄' : '🚫';

  function formatDOB(iso?: string) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }

  return (
    <div className="result-card card" style={{ borderColor: accentColor, borderWidth: '2px' }}>
      {/* Status banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '.75rem',
        marginBottom: '1.5rem',
        padding: '1rem',
        background: `${accentColor}22`,
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontSize: '2rem' }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.2rem', color: accentColor }}>
            {isAdmitted && 'ADMITTED'}
            {isAlreadyIn && 'ALREADY INSIDE'}
            {isDenied && 'DENIED'}
          </div>
          {result.message && (
            <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginTop: '.2rem' }}>
              {result.message}
            </div>
          )}
        </div>
      </div>

      {/* Patron info */}
      {(result.firstName || result.lastName) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            {result.firstName} {result.lastName}
          </div>
          {result.dlState && (
            <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              {result.dlState} Driver's License
            </div>
          )}
        </div>
      )}

      {/* Age + DOB */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.25rem' }}>Age</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: accentColor }}>
            {result.age ?? '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.25rem' }}>Date of Birth</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            {formatDOB(result.dateOfBirth)}
          </div>
        </div>
      </div>

      {/* Expiration */}
      {result.expirationDate && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.25rem' }}>Expires</div>
          <div style={{ fontSize: '.95rem' }}>{formatDOB(result.expirationDate)}</div>
        </div>
      )}

      {/* Patron count update */}
      {result.currentCount !== undefined && isAdmitted && (
        <div style={{
          background: 'var(--bg)',
          borderRadius: 'var(--radius-sm)',
          padding: '.75rem',
          textAlign: 'center',
          marginBottom: '1.5rem',
          fontSize: '.9rem',
          color: 'var(--muted)',
        }}>
          <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '1.4rem' }}>
            {result.currentCount}
          </span>{' '}
          patrons now inside
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <button className="btn btn-primary btn-full" onClick={onScanAnother}>
          📷 Scan Next ID
        </button>

        {(isAdmitted || isAlreadyIn) && onCheckout && (
          <button className="btn btn-ghost btn-full" onClick={onCheckout}>
            ↩ Check Out This Patron
          </button>
        )}
      </div>
    </div>
  );
}
