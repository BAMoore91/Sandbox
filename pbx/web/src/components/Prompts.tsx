import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getToken } from "../api";

interface Prompt {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  sound_id: string;
  duration_sec: number | null;
  size_bytes: number | null;
  original_name: string | null;
}

const KINDS = ["greeting", "announcement", "moh"];

export default function Prompts() {
  const { tid } = useParams();
  const [list, setList] = useState<Prompt[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("greeting");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/tenants/${tid}/prompts`;
  async function load() {
    setList(await api.get<Prompt[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!file) {
      setErr("Choose an audio file to upload");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("kind", kind);
      fd.append("description", description);
      fd.append("file", file);
      await api.upload(base, fd);
      setName("");
      setDescription("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this prompt? Any IVR/queue using it will fall back to silence.")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  // Authenticated audio fetch -> object URL for the <audio> player.
  async function play(id: number, el: HTMLAudioElement) {
    const res = await fetch(`${base}/${id}/audio`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    el.src = URL.createObjectURL(blob);
    el.play();
  }

  return (
    <div>
      <h2>Audio Prompts</h2>
      <p className="muted">
        Upload your own greetings and announcements. Files are converted to the
        format the phone system plays, and become available to IVRs, queues and
        hold music as <code>custom/&lt;name&gt;</code>.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>Upload a prompt</h3>
          <form className="form" onSubmit={upload}>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="welcome (lowercase, no spaces)"
                required
              />
            </label>
            <label>
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Main menu greeting"
              />
            </label>
            <label>
              Audio file (wav / mp3 / m4a / ogg)
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />
            </label>
            {err && <div className="error">{err}</div>}
            <button className="btn" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </button>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} prompts</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Length</th>
                <th>Play</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <code>{p.name}</code>
                    <div className="small muted">{p.description}</div>
                  </td>
                  <td>
                    <span className="pill">{p.kind}</span>
                  </td>
                  <td className="small">
                    {p.duration_sec ? `${p.duration_sec}s` : "—"}
                  </td>
                  <td>
                    <audio id={`a-${p.id}`} />
                    <button
                      className="btn small ghost"
                      onClick={(e) =>
                        play(
                          p.id,
                          document.getElementById(`a-${p.id}`) as HTMLAudioElement
                        )
                      }
                    >
                      ▶
                    </button>
                  </td>
                  <td>
                    <button className="btn small danger" onClick={() => remove(p.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
