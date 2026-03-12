import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserPDF417Reader, NotFoundException } from '@zxing/browser';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import ScanResult from './ScanResult';

type ResultAction = 'admitted' | 'denied' | 'already_inside';

interface ScanResponse {
  action: ResultAction;
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

export default function ScannerPage() {
  const { activeOrgId } = useAuth();
  const api = useApi();
  const toast = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserPDF417Reader | null>(null);
  const scanningRef = useRef(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [currentCount, setCurrentCount] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch { /* ignore */ }
      readerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!videoRef.current) return;
    setCameraError(null);
    try {
      readerRef.current = new BrowserPDF417Reader();
      const devices = await BrowserPDF417Reader.listVideoInputDevices();
      // Prefer rear camera on mobile
      const rearCamera = devices.find(
        (d) => /back|rear|environment/i.test(d.label)
      ) ?? devices[devices.length - 1];

      scanningRef.current = true;
      setCameraActive(true);

      readerRef.current.decodeFromVideoDevice(
        rearCamera?.deviceId ?? undefined,
        videoRef.current,
        async (res, err) => {
          if (!scanningRef.current || processing) return;
          if (err instanceof NotFoundException) return; // no code in frame

          if (res) {
            const barcodeData = res.getText();
            stopCamera();
            await processBarcode(barcodeData);
          }
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera access denied';
      setCameraError(msg);
      setCameraActive(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  async function processBarcode(barcodeData: string) {
    if (!activeOrgId) {
      toast('No organization selected', 'error');
      return;
    }
    setProcessing(true);
    try {
      const res = await api.post<ScanResponse>(
        `/api/orgs/${activeOrgId}/scans`,
        { barcodeData }
      );
      setResult(res);
      if (res.currentCount !== undefined) setCurrentCount(res.currentCount);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Scan failed', 'error');
    } finally {
      setProcessing(false);
    }
  }

  async function handleCheckout(scanId: string) {
    if (!activeOrgId) return;
    try {
      const res = await api.post<{ currentCount: number }>(
        `/api/orgs/${activeOrgId}/scans/${scanId}/checkout`,
        {}
      );
      setCurrentCount(res.currentCount);
      setResult(null);
      toast('Patron checked out', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }

  function handleScanAnother() {
    setResult(null);
    startCamera();
  }

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Scan ID</h1>
        {currentCount !== null && (
          <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{currentCount}</span> inside
          </div>
        )}
      </div>

      {!activeOrgId && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          No organization selected. Go to Admin to create or select one.
        </div>
      )}

      {activeOrgId && !result && (
        <>
          {/* Camera preview */}
          <div className="scanner-wrap" style={{ marginBottom: '1rem' }}>
            <video ref={videoRef} muted playsInline />
            {cameraActive && (
              <div className="scanner-aim">
                <div className="scanner-aim__box" />
              </div>
            )}
            {!cameraActive && !processing && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '1rem', color: 'var(--muted)',
              }}>
                <span style={{ fontSize: '3rem' }}>📷</span>
                <span style={{ fontSize: '.9rem' }}>Camera stopped</span>
              </div>
            )}
            {processing && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text)', flexDirection: 'column', gap: '.75rem',
              }}>
                <div style={{ fontSize: '2rem' }}>⏳</div>
                <div>Verifying ID…</div>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="card" style={{ background: 'rgba(239,68,68,.1)', borderColor: 'var(--red)', marginBottom: '1rem', fontSize: '.9rem' }}>
              <strong style={{ color: 'var(--red)' }}>Camera error:</strong> {cameraError}
              <br />
              <span style={{ color: 'var(--muted)' }}>Check that camera permissions are granted.</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '.75rem' }}>
            {!cameraActive ? (
              <button className="btn btn-primary btn-full" onClick={startCamera} disabled={processing}>
                📷 Start Camera
              </button>
            ) : (
              <button className="btn btn-ghost btn-full" onClick={stopCamera}>
                ⏹ Stop Camera
              </button>
            )}
          </div>

          <p style={{ marginTop: '1rem', fontSize: '.8rem', color: 'var(--muted)', textAlign: 'center' }}>
            Point the camera at the PDF417 barcode on the back of the driver's license
          </p>
        </>
      )}

      {result && (
        <ScanResult
          result={result}
          onScanAnother={handleScanAnother}
          onCheckout={result.scanId ? () => handleCheckout(result.scanId!) : undefined}
        />
      )}
    </div>
  );
}
