import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { DestinationPicker, useFormError } from "./flow";

interface RingGroup {
  id: number;
  number: string;
  name: string | null;
  strategy: string;
  ring_seconds: number;
  members: string[];
  fail_dest_type: string;
  fail_dest_value: string | null;
}

const BLANK = {
  number: "",
  name: "",
  strategy: "ringall",
  ring_seconds: 25,
  members: "",
  fail_dest_type: "voicemail",
  fail_dest_value: "",
};

export default function RingGroups() {
  const { tid } = useParams();
  const [list, setList] = useState<RingGroup[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [editId, setEditId] = useState<number | null>(null);
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/ring-groups`;
  async function load() {
    setList(await api.get<RingGroup[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid]);

  async function save(e: React.FormEvent) {
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
      if (editId) await api.patch(`${base}/${editId}`, body);
      else await api.post(base, body);
      setForm(BLANK);
      setEditId(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  function edit(g: RingGroup) {
    setEditId(g.id);
    setForm({ ...g, name: g.name || "", members: g.members.join(", ") });
    window.scrollTo(0, 0);
  }
  async function remove(id: number) {
    if (!confirm("Delete this ring group?")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  return (
    <div>
      <h2>Ring Groups</h2>
      <p className="muted">
        Ring several extensions at once (or in sequence) and choose where the
        call goes if nobody answers.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>{editId ? `Edit group ${form.number}` : "Create ring group"}</h3>
          <form className="form" onSubmit={save}>
            <label>
              Number
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="600"
                required
              />
            </label>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Sales"
              />
            </label>
            <label>
              Strategy
              <select
                value={form.strategy}
                onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              >
                <option value="ringall">Ring all at once</option>
                <option value="hunt">Hunt (in order)</option>
                <option value="memoryhunt">Memory hunt</option>
              </select>
            </label>
            <label>
              Ring time (s)
              <input
                type="number"
                value={form.ring_seconds}
                onChange={(e) => setForm({ ...form, ring_seconds: +e.target.value })}
              />
            </label>
            <label>
              Members (extension numbers, comma-separated, in ring order)
              <input
                value={form.members}
                onChange={(e) => setForm({ ...form, members: e.target.value })}
                placeholder="1001, 1002, 1003"
              />
            </label>
            <DestinationPicker
              label="If nobody answers:"
              typeValue={form.fail_dest_type}
              valueValue={form.fail_dest_value}
              onType={(t) => setForm({ ...form, fail_dest_type: t })}
              onValue={(v) => setForm({ ...form, fail_dest_value: v })}
            />
            {node}
            <div className="row2">
              <button className="btn">{editId ? "Save" : "Create"}</button>
              {editId && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEditId(null);
                    setForm(BLANK);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>{list.length} ring groups</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Members</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id}>
                  <td>{g.number}</td>
                  <td>{g.name}</td>
                  <td className="small">{g.members.join(", ")}</td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => edit(g)}>
                      Edit
                    </button>{" "}
                    <button className="btn small danger" onClick={() => remove(g.id)}>
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
