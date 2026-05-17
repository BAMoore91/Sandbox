import { useWebRTCStream, type StreamKind } from "../lib/webrtc";
import type { Camera } from "../api/cameras";

interface Props {
  camera: Camera;
  kind?: StreamKind;
  onExpand?: () => void;
  fullscreen?: boolean;
}

export function CameraTile({
  camera,
  kind = "main",
  onExpand,
  fullscreen = false,
}: Props) {
  const { videoRef, status, error } = useWebRTCStream(camera.id, {
    kind,
    autoReconnect: true,
  });

  return (
    <div
      className={
        "group relative overflow-hidden bg-zinc-950 " +
        (fullscreen ? "h-full w-full" : "aspect-video rounded-lg")
      }
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-2">
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (status === "connected"
                ? "bg-emerald-400"
                : status === "connecting" || status === "reconnecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-500")
            }
          />
          <span className="text-sm font-medium text-white drop-shadow">
            {camera.name}
          </span>
          {kind === "sub" && (
            <span className="rounded bg-zinc-900/80 px-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
              sub
            </span>
          )}
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            aria-label={fullscreen ? "Close" : "Expand"}
            className="pointer-events-auto rounded bg-black/50 px-1.5 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
          >
            {fullscreen ? "✕" : "⤢"}
          </button>
        )}
      </div>

      {status !== "connected" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="rounded bg-black/70 px-3 py-1.5 text-sm text-white">
            {status === "connecting" && "Connecting…"}
            {status === "reconnecting" && "Reconnecting…"}
            {status === "failed" && (
              <span className="text-red-300">
                Stream failed{error ? `: ${error}` : ""}
              </span>
            )}
            {status === "closed" && "Disconnected"}
            {status === "idle" && "Idle"}
          </div>
        </div>
      )}
    </div>
  );
}
