import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getToken } from "../api";

interface Rec {
  id: number;
  uniqueid: string;
  src: string | null;
  dst: string | null;
  duration: number | null;
  created_at: string;
}

export default function Recordings() {
  const { tid } = useParams();
  const [items, setItems] = useState<Rec[]>([]);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState<number | null>(null);

  const base = `/api/tenants/${tid}/recordings`;
  async function load() {
    const r = await api.get<{ total: number; items: Rec[] }>(base);
    setItems(r.items);
    setTotal(r.total);
  }
  useEffect(() => {
    load();
  }, [tid]);

  // Authenticated fetch -> object URL for the inline <audio> player.
  async function play(id: number, el: HTMLAudioElement) {
    setPlaying(id);
    const res = await fetch(`${base}/${id}/audio`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      alert(res.status === 404 ? "Recording file not available yet." : "Cannot play recording.");
      setPlaying(null);
      return;
    }
    el.src = URL.createObjectURL(await res.blob());
    el.play();
  }

  async function download(id: number) {
    const res = await fetch(`${base}/${id}/audio`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${id}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(id: number) {
    if (!confirm("Delete this recording permanently?")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  return (
    <div>
      <h2>
        Call Recordings <span className="muted small">({total})</span>
      </h2>
      <p className="muted">
        Recordings are captured for answered calls while recording is enabled
        (Settings). Enable/disable under <b>Settings</b>.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>From</th>
              <th>To</th>
              <th>Length</th>
              <th>Play</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.src}</td>
                <td>{r.dst}</td>
                <td className="small">{r.duration ? `${r.duration}s` : "—"}</td>
                <td>
                  <audio id={`rec-${r.id}`} controls={playing === r.id} style={{ height: 28 }} />
                  <button
                    className="btn small ghost"
                    onClick={() =>
                      play(r.id, document.getElementById(`rec-${r.id}`) as HTMLAudioElement)
                    }
                  >
                    ▶
                  </button>
                </td>
                <td className="nowrap">
                  <button className="btn small" onClick={() => download(r.id)}>
                    ⬇
                  </button>{" "}
                  <button className="btn small danger" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No recordings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
