import { useEffect, useState } from "react";
import { camerasApi, type Camera } from "../api/cameras";
import { CameraTile } from "../components/CameraTile";

type LayoutKey = "auto" | "1" | "4" | "9" | "16";

const LAYOUTS: Record<LayoutKey, { label: string; columns: string; max: number | null }> = {
  auto: {
    label: "Auto",
    columns: "repeat(auto-fit, minmax(360px, 1fr))",
    max: null,
  },
  "1": { label: "1", columns: "1fr", max: 1 },
  "4": { label: "2×2", columns: "repeat(2, 1fr)", max: 4 },
  "9": { label: "3×3", columns: "repeat(3, 1fr)", max: 9 },
  "16": { label: "4×4", columns: "repeat(4, 1fr)", max: 16 },
};

export function Live() {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutKey>(() => {
    const saved = localStorage.getItem("softbiscuit.liveLayout") as LayoutKey | null;
    return saved && saved in LAYOUTS ? saved : "auto";
  });
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  useEffect(() => {
    camerasApi
      .list()
      .then((cs) => setCameras(cs.filter((c) => c.enabled)))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    localStorage.setItem("softbiscuit.liveLayout", layout);
  }, [layout]);

  useEffect(() => {
    if (!fullscreenId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenId]);

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>;
  }
  if (!cameras) {
    return <div className="p-6 text-zinc-500">Loading cameras…</div>;
  }
  if (cameras.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-12 text-center text-zinc-500">
        <div>
          <div className="mb-2 text-lg text-zinc-300">No enabled cameras.</div>
          <div className="text-sm">
            Add one under <span className="text-amber-400">Cameras</span> to start
            streaming.
          </div>
        </div>
      </div>
    );
  }

  if (fullscreenId) {
    const cam = cameras.find((c) => c.id === fullscreenId);
    if (!cam) {
      // Camera was removed/disabled; drop back to grid
      setFullscreenId(null);
      return null;
    }
    return (
      <div className="fixed inset-0 z-20 bg-black">
        <CameraTile
          camera={cam}
          kind="main"
          fullscreen
          onExpand={() => setFullscreenId(null)}
        />
      </div>
    );
  }

  const layoutDef = LAYOUTS[layout];
  const visible = layoutDef.max ? cameras.slice(0, layoutDef.max) : cameras;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <h1 className="text-lg font-semibold">Live</h1>
        <div className="flex gap-1">
          {(Object.keys(LAYOUTS) as LayoutKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setLayout(k)}
              className={
                "rounded px-2.5 py-1 text-xs " +
                (layout === k
                  ? "bg-amber-500 text-zinc-950"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700")
              }
            >
              {LAYOUTS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: layoutDef.columns }}
        >
          {visible.map((c) => (
            <CameraTile
              key={c.id}
              camera={c}
              kind={c.subRtspUrl ? "sub" : "main"}
              onExpand={() => setFullscreenId(c.id)}
            />
          ))}
        </div>
        {layoutDef.max && cameras.length > layoutDef.max && (
          <div className="mt-3 text-center text-xs text-zinc-500">
            Showing {visible.length} of {cameras.length} cameras. Switch to{" "}
            <button
              onClick={() => setLayout("auto")}
              className="text-amber-400 hover:underline"
            >
              Auto
            </button>{" "}
            to see all.
          </div>
        )}
      </div>
    </div>
  );
}
