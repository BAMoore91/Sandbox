import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useFormError } from "./flow";

interface Member {
  interface: string;
  membername: string | null;
  penalty: number;
  paused: number;
}
interface Queue {
  name: string;
  number: string;
  strategy: string;
  timeout: number;
  members: Member[];
}

const BLANK = {
  number: "",
  name: "",
  strategy: "rrmemory",
  timeout: 15,
  members: "",
};

export default function Queues() {
  const { tid } = useParams();
  const [list, setList] = useState<Queue[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [addTo, setAddTo] = useState<{ [num: string]: string }>({});
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/queues`;
  async function load() {
    setList(await api.get<Queue[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const body = {
      ...form,
      members: String(form.members)
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    };
    try {
      await api.post(base, body);
      setForm(BLANK);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function addMember(num: string) {
    const ext = (addTo[num] || "").trim();
    if (!ext) return;
    await api.post(`${base}/${num}/members`, { extension: ext });
    setAddTo({ ...addTo, [num]: "" });
    load();
  }
  async function removeMember(num: string, iface: string) {
    const ext = iface.split("-").pop();
    await api.del(`${base}/${num}/members/${ext}`);
    load();
  }
  async function remove(num: string) {
    if (!confirm("Delete this queue?")) return;
    await api.del(`${base}/${num}`);
    load();
  }

  return (
    <div>
      <h2>Call Queues</h2>
      <p className="muted">
        Hold callers in line and distribute calls to a team of agents with the
        strategy you choose.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>Create queue</h3>
          <form className="form" onSubmit={create}>
            <label>
              Number
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="800"
                required
              />
            </label>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Support"
              />
            </label>
            <label>
              Distribution strategy
              <select
                value={form.strategy}
                onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              >
                <option value="rrmemory">Round-robin (memory)</option>
                <option value="ringall">Ring all</option>
                <option value="leastrecent">Least recent</option>
                <option value="fewestcalls">Fewest calls</option>
                <option value="random">Random</option>
              </select>
            </label>
            <label>
              Agent ring timeout (s)
              <input
                type="number"
                value={form.timeout}
                onChange={(e) => setForm({ ...form, timeout: +e.target.value })}
              />
            </label>
            <label>
              Initial agents (extensions, comma-separated)
              <input
                value={form.members}
                onChange={(e) => setForm({ ...form, members: e.target.value })}
                placeholder="1001, 1002"
              />
            </label>
            {node}
            <button className="btn">Create queue</button>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} queues</h3>
          {list.map((q) => (
            <div className="qcard" key={q.name}>
              <div className="qhead">
                <b>
                  {q.number} {q.name ? `· ${q.name}` : ""}
                </b>
                <span className="pill">{q.strategy}</span>
                <button className="btn small danger" onClick={() => remove(q.number)}>
                  Delete
                </button>
              </div>
              <div className="small muted">Agents:</div>
              <ul className="agents">
                {q.members.map((m) => (
                  <li key={m.interface}>
                    {m.membername || m.interface}
                    {m.paused ? " (paused)" : ""}
                    <button
                      className="btn small ghost"
                      onClick={() => removeMember(q.number, m.interface)}
                    >
                      remove
                    </button>
                  </li>
                ))}
                {q.members.length === 0 && <li className="muted">none</li>}
              </ul>
              <div className="optrow">
                <input
                  style={{ width: 90 }}
                  placeholder="ext"
                  value={addTo[q.number] || ""}
                  onChange={(e) => setAddTo({ ...addTo, [q.number]: e.target.value })}
                />
                <button className="btn small" onClick={() => addMember(q.number)}>
                  + Add agent
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
