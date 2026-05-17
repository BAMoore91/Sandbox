import { useEffect, useMemo, useRef, useState } from "react";
import { camerasApi, type Camera } from "../api/cameras";
import { recordingsApi, type Recording } from "../api/recordings";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function toDateInput(d: Date): string {
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fromDateInput(s: string): Date {
  const [Y, M, D] = s.split("-").map(Number) as [number, number, number];
  return new Date(Y, M - 1, D);
}
function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function Timeline() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRecording, setActiveRecording] = useState<Recording | null>(null);
  const [seekOffsetSec, setSeekOffsetSec] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    camerasApi
      .list()
      .then((cs) => {
        const enabled = cs.filter((c) => c.enabled);
        setCameras(enabled);
        if (enabled[0]) setCameraId(enabled[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const dayStart = useMemo(() => startOfDay(date).getTime(), [date]);
  const dayEnd = useMemo(() => endOfDay(date).getTime(), [date]);

  useEffect(() => {
    if (!cameraId) return;
    setLoading(true);
    setError(null);
    recordingsApi
      .listForCamera(cameraId, { from: dayStart, to: dayEnd })
      .then((rs) => setRecordings(rs))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cameraId, dayStart, dayEnd]);

  const onScrubClick = async (clickAt: number) => {
    const ms = dayStart + clickAt * (dayEnd - dayStart);
    const containing = recordings.find(
      (r) => r.startedAt <= ms && r.endedAt >= ms,
    );
    if (!containing) return;
    const offset = Math.max(0, Math.floor((ms - containing.startedAt) / 1000));
    setActiveRecording(containing);
    setSeekOffsetSec(offset);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <h1 className="text-lg font-semibold">Timeline</h1>
        <select
          value={cameraId ?? ""}
          onChange={(e) => setCameraId(e.target.value || null)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
        >
          {cameras.length === 0 && <option value="">No cameras</option>}
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={toDateInput(date)}
          onChange={(e) => setDate(fromDateInput(e.target.value))}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
        />
        <button
          onClick={() => setDate(startOfDay(new Date()))}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs hover:bg-zinc-800"
        >
          Today
        </button>
        {loading && <span className="text-xs text-zinc-500">Loading…</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!cameraId ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-12 text-center text-zinc-500">
            Add a camera under <span className="text-amber-400">Cameras</span>{" "}
            to start recording.
          </div>
        ) : (
          <>
            {activeRecording && (
              <PlaybackPanel
                recording={activeRecording}
                seekOffsetSec={seekOffsetSec}
                onClose={() => setActiveRecording(null)}
                videoRef={videoRef}
              />
            )}

            <TimelineBar
              dayStart={dayStart}
              dayEnd={dayEnd}
              recordings={recordings}
              onScrubClick={onScrubClick}
              activeRecordingId={activeRecording?.id ?? null}
            />

            <div className="mt-4 text-xs text-zinc-500">
              {recordings.length === 0 ? (
                <span>
                  No recordings for{" "}
                  {date.toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  .
                </span>
              ) : (
                <span>
                  {recordings.length} segments ·{" "}
                  {Math.round(
                    recordings.reduce((s, r) => s + r.durationMs, 0) / 60_000,
                  )}{" "}
                  minutes total ·{" "}
                  {(
                    recordings.reduce((s, r) => s + r.sizeBytes, 0) /
                    1_048_576
                  ).toFixed(1)}{" "}
                  MB
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface TimelineBarProps {
  dayStart: number;
  dayEnd: number;
  recordings: Recording[];
  onScrubClick: (fraction: number) => void;
  activeRecordingId: string | null;
}

function TimelineBar({
  dayStart,
  dayEnd,
  recordings,
  onScrubClick,
  activeRecordingId,
}: TimelineBarProps) {
  const span = dayEnd - dayStart;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onScrubClick(f);
  };

  const handleMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverFraction(f);
  };

  const hoverTime = useMemo(() => {
    if (hoverFraction === null) return null;
    return new Date(dayStart + hoverFraction * span);
  }, [hoverFraction, dayStart, span]);

  return (
    <div className="select-none">
      <div className="relative">
        <div
          ref={containerRef}
          onClick={handleClick}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverFraction(null)}
          className="relative h-12 cursor-crosshair overflow-hidden rounded border border-zinc-800 bg-zinc-900"
        >
          {recordings.map((r) => {
            const left = Math.max(0, (r.startedAt - dayStart) / span);
            const width = Math.min(1 - left, (r.endedAt - r.startedAt) / span);
            const isActive = r.id === activeRecordingId;
            return (
              <div
                key={r.id}
                title={`${new Date(r.startedAt).toLocaleTimeString()} – ${new Date(r.endedAt).toLocaleTimeString()}`}
                className={
                  "absolute top-1 bottom-1 rounded-sm " +
                  (isActive
                    ? "bg-amber-500/90 ring-1 ring-amber-300"
                    : "bg-emerald-700/80 hover:bg-emerald-600")
                }
                style={{
                  left: `${left * 100}%`,
                  width: `${Math.max(0.1, width * 100)}%`,
                }}
              />
            );
          })}
          {hoverFraction !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber-400/70"
              style={{ left: `${hoverFraction * 100}%` }}
            />
          )}
        </div>
        {hoverTime && (
          <div
            className="pointer-events-none absolute -top-5 text-[10px] text-zinc-400"
            style={{
              left: `${(hoverFraction ?? 0) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {fmtClock(hoverTime)}
          </div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-12 text-[10px] text-zinc-500">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="text-center">
            {String(i * 2).padStart(2, "0")}:00
          </div>
        ))}
      </div>
    </div>
  );
}

interface PlaybackPanelProps {
  recording: Recording;
  seekOffsetSec: number;
  onClose: () => void;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
}

function PlaybackPanel({
  recording,
  seekOffsetSec,
  onClose,
  videoRef,
}: PlaybackPanelProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    recordingsApi
      .playbackTicket(recording.id)
      .then((t) => {
        if (cancelled) return;
        setSrc(recordingsApi.fileUrl(recording.id, t.ticket));
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [recording.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const handleLoaded = () => {
      if (seekOffsetSec > 0 && seekOffsetSec < v.duration) {
        v.currentTime = seekOffsetSec;
      }
      void v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", handleLoaded);
    return () => v.removeEventListener("loadedmetadata", handleLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, seekOffsetSec]);

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm">
          <span className="text-zinc-400">Playing</span>{" "}
          <span className="font-medium">
            {new Date(recording.startedAt).toLocaleString()}
          </span>{" "}
          <span className="text-zinc-500">
            ({Math.round(recording.durationMs / 1000)}s · {recording.codec})
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      {src && (
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          className="aspect-video w-full max-w-3xl bg-black"
        />
      )}
    </div>
  );
}
