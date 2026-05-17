import { useEffect, useState } from "react";
import {
  camerasApi,
  type Camera,
  type CameraInput,
  type DiscoveredDevice,
  type ProbeResult,
} from "../api/cameras";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

type Dialog =
  | { kind: "closed" }
  | { kind: "add"; prefill?: Partial<CameraInput> }
  | { kind: "edit"; camera: Camera }
  | { kind: "discover" };

export function Cameras() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: "closed" });

  async function refresh() {
    try {
      const list = await camerasApi.list();
      setCameras(list);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cameras</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => setDialog({ kind: "discover" })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              Discover (ONVIF)
            </button>
            <button
              onClick={() => setDialog({ kind: "add" })}
              className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
            >
              Add camera
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-4 text-red-400">{error}</div>}
      {!cameras && !error && (
        <div className="text-zinc-500">Loading…</div>
      )}

      {cameras && cameras.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 p-12 text-center text-zinc-500">
          No cameras yet. {isAdmin ? "Click “Add camera” to begin." : "Ask an admin to add one."}
        </div>
      )}

      {cameras && cameras.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-400">
            <tr className="border-b border-zinc-800">
              <th className="py-2 pr-4">Name</th>
              <th className="pr-4">RTSP URL</th>
              <th className="pr-4">Sub stream</th>
              <th className="pr-4">Status</th>
              <th className="pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => (
              <tr key={c.id} className="border-b border-zinc-900">
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="pr-4 truncate font-mono text-xs text-zinc-400">
                  {c.rtspUrl}
                </td>
                <td className="pr-4 truncate font-mono text-xs text-zinc-500">
                  {c.subRtspUrl ?? "—"}
                </td>
                <td className="pr-4">
                  <span
                    className={
                      c.enabled
                        ? "rounded bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300"
                        : "rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                    }
                  >
                    {c.enabled ? "enabled" : "disabled"}
                  </span>
                </td>
                <td className="pr-4 text-right">
                  {isAdmin && (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setDialog({ kind: "edit", camera: c })}
                        className="text-zinc-300 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete ${c.name}?`)) return;
                          await camerasApi.remove(c.id);
                          await refresh();
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog.kind === "add" && (
        <CameraDialog
          mode="add"
          initial={dialog.prefill}
          onClose={() => setDialog({ kind: "closed" })}
          onSaved={async () => {
            setDialog({ kind: "closed" });
            await refresh();
          }}
        />
      )}
      {dialog.kind === "edit" && (
        <CameraDialog
          mode="edit"
          camera={dialog.camera}
          onClose={() => setDialog({ kind: "closed" })}
          onSaved={async () => {
            setDialog({ kind: "closed" });
            await refresh();
          }}
        />
      )}
      {dialog.kind === "discover" && (
        <DiscoverDialog
          onClose={() => setDialog({ kind: "closed" })}
          onPick={(d) =>
            setDialog({
              kind: "add",
              prefill: {
                name: d.name ?? d.manufacturer ?? d.address,
                rtspUrl: `rtsp://${d.address}:554/`,
                onvifUrl: d.xaddrs[0] ?? null,
              },
            })
          }
        />
      )}
    </div>
  );
}

interface CameraDialogProps {
  mode: "add" | "edit";
  camera?: Camera;
  initial?: Partial<CameraInput>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function CameraDialog({ mode, camera, initial, onClose, onSaved }: CameraDialogProps) {
  const [form, setForm] = useState<CameraInput>({
    name: camera?.name ?? initial?.name ?? "",
    rtspUrl: camera?.rtspUrl ?? initial?.rtspUrl ?? "",
    subRtspUrl: camera?.subRtspUrl ?? initial?.subRtspUrl ?? "",
    onvifUrl: camera?.onvifUrl ?? initial?.onvifUrl ?? "",
    username: camera?.username ?? initial?.username ?? "",
    password: "",
    enabled: camera?.enabled ?? true,
    retentionDays: camera?.retentionDays ?? null,
  });
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleProbe() {
    setProbing(true);
    setProbe(null);
    setErr(null);
    try {
      const r = await camerasApi.probe(form.rtspUrl);
      setProbe(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : String(e));
    } finally {
      setProbing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      // Strip empty strings to null
      const payload: CameraInput = {
        ...form,
        subRtspUrl: form.subRtspUrl?.trim() ? form.subRtspUrl : null,
        onvifUrl: form.onvifUrl?.trim() ? form.onvifUrl : null,
        username: form.username?.trim() ? form.username : null,
        password: form.password?.trim() ? form.password : null,
      };
      if (mode === "add") {
        await camerasApi.create(payload);
      } else if (camera) {
        // Don't send password if blank in edit mode
        const { password, ...rest } = payload;
        const update = password ? payload : rest;
        await camerasApi.update(camera.id, update);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {mode === "add" ? "Add camera" : `Edit ${camera?.name}`}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              placeholder="Front Door"
            />
          </Field>
          <Field
            label="Main RTSP URL"
            help="rtsp://user:pass@host:554/path  (or store creds separately below)"
          >
            <input
              value={form.rtspUrl}
              onChange={(e) => setForm({ ...form, rtspUrl: e.target.value })}
              className={inputClass + " font-mono text-xs"}
              placeholder="rtsp://192.168.1.42:554/h264Preview_01_main"
            />
          </Field>
          <Field label="Sub-stream URL (optional, for tile previews)">
            <input
              value={form.subRtspUrl ?? ""}
              onChange={(e) => setForm({ ...form, subRtspUrl: e.target.value })}
              className={inputClass + " font-mono text-xs"}
              placeholder="rtsp://192.168.1.42:554/h264Preview_01_sub"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username (optional)">
              <input
                value={form.username ?? ""}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field
              label={mode === "edit" ? "Password (leave blank to keep)" : "Password (optional)"}
            >
              <input
                type="password"
                value={form.password ?? ""}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="ONVIF service URL (optional)">
            <input
              value={form.onvifUrl ?? ""}
              onChange={(e) => setForm({ ...form, onvifUrl: e.target.value })}
              className={inputClass + " font-mono text-xs"}
              placeholder="http://192.168.1.42:80/onvif/device_service"
            />
          </Field>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={form.enabled ?? true}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <span className="ml-auto text-zinc-500">
              Retention (days):
              <input
                type="number"
                min={1}
                value={form.retentionDays ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    retentionDays: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className={"ml-2 w-20 " + inputClass}
                placeholder="default"
              />
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={handleProbe}
            disabled={probing || !form.rtspUrl}
            className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            {probing ? "Probing…" : "Test stream"}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.rtspUrl}
              className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "add" ? "Add camera" : "Save"}
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {err}
          </div>
        )}
        {probe && (
          <div
            className={`mt-3 rounded px-3 py-2 text-xs ${probe.ok ? "bg-emerald-950/40 text-emerald-200" : "bg-red-950/60 text-red-300"}`}
          >
            {probe.ok ? (
              <>
                <div className="font-semibold">Stream reachable ✓</div>
                <ul className="mt-1 space-y-0.5">
                  {probe.streams.map((s, i) => (
                    <li key={i}>
                      <span className="text-zinc-400">{s.type}</span>:{" "}
                      <span className="font-mono">{s.codec}</span>
                      {s.width && s.height ? (
                        <>
                          {" "}
                          <span className="text-zinc-500">
                            {s.width}×{s.height}
                          </span>
                        </>
                      ) : null}
                      {s.fps ? (
                        <span className="text-zinc-500"> @ {s.fps} fps</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>Stream unreachable: {probe.error}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface DiscoverDialogProps {
  onClose: () => void;
  onPick: (d: DiscoveredDevice) => void;
}

function DiscoverDialog({ onClose, onPick }: DiscoverDialogProps) {
  const [devices, setDevices] = useState<DiscoveredDevice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    camerasApi
      .discover()
      .then(setDevices)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Discover ONVIF cameras</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>
        <div className="text-sm text-zinc-400">
          Scanning local network for ONVIF devices (WS-Discovery). This takes about 3 seconds.
        </div>
        {err && <div className="mt-3 text-red-400">{err}</div>}
        {!devices && !err && (
          <div className="mt-3 text-zinc-500">Scanning…</div>
        )}
        {devices && devices.length === 0 && (
          <div className="mt-3 rounded border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
            No ONVIF devices found. They may be powered off, on a different VLAN,
            or have ONVIF disabled. Add manually instead.
          </div>
        )}
        {devices && devices.length > 0 && (
          <ul className="mt-4 space-y-2">
            {devices.map((d) => (
              <li
                key={d.address}
                className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2"
              >
                <div>
                  <div className="font-medium">
                    {d.name ?? d.model ?? d.address}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {d.manufacturer ? `${d.manufacturer} · ` : ""}
                    {d.address}
                  </div>
                </div>
                <button
                  onClick={() => onPick(d)}
                  className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-amber-500";

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-zinc-400">{label}</div>
      {children}
      {help && <div className="mt-1 text-xs text-zinc-600">{help}</div>}
    </label>
  );
}
