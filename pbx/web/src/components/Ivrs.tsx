import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { DestinationPicker, useFormError } from "./flow";

interface Option {
  digit: string;
  dest_type: string;
  dest_value: string;
}
interface Ivr {
  id: number;
  number: string;
  name: string | null;
  greeting: string;
  timeout: number;
  max_retries: number;
  direct_dial: boolean;
  timeout_dest_type: string;
  timeout_dest_value: string | null;
  invalid_dest_type: string;
  invalid_dest_value: string | null;
  options: Option[];
}
interface Prompt {
  name: string;
  sound_id: string;
}

const BLANK = {
  number: "",
  name: "",
  greeting: "custom/ivr-welcome",
  timeout: 5,
  max_retries: 3,
  direct_dial: true,
  timeout_dest_type: "voicemail",
  timeout_dest_value: "",
  invalid_dest_type: "hangup",
  invalid_dest_value: "",
  options: [] as Option[],
};

export default function Ivrs() {
  const { tid } = useParams();
  const [list, setList] = useState<Ivr[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [editId, setEditId] = useState<number | null>(null);
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/ivrs`;
  async function load() {
    setList(await api.get<Ivr[]>(base));
    try {
      setPrompts(await api.get<Prompt[]>(`/api/tenants/${tid}/prompts`));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, [tid]);

  function setOpt(i: number, patch: Partial<Option>) {
    const options = form.options.map((o: Option, idx: number) =>
      idx === i ? { ...o, ...patch } : o
    );
    setForm({ ...form, options });
  }
  function addOpt() {
    setForm({
      ...form,
      options: [...form.options, { digit: "", dest_type: "extension", dest_value: "" }],
    });
  }
  function delOpt(i: number) {
    setForm({ ...form, options: form.options.filter((_: any, idx: number) => idx !== i) });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (editId) await api.patch(`${base}/${editId}`, form);
      else await api.post(base, form);
      setForm(BLANK);
      setEditId(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  function edit(iv: Ivr) {
    setEditId(iv.id);
    setForm({ ...iv, name: iv.name || "", options: iv.options });
    window.scrollTo(0, 0);
  }
  async function remove(id: number) {
    if (!confirm("Delete this IVR?")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  // greeting can be a built-in prompt or one of the customer's uploads
  const greetingChoices = [
    "custom/ivr-welcome",
    ...prompts.map((p) => p.sound_id),
  ];

  return (
    <div>
      <h2>Auto-Attendant (IVR)</h2>
      <p className="muted">
        Build the menu callers hear: pick a greeting (upload your own under
        Prompts), then route each key press anywhere in your call flow.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>{editId ? `Edit IVR ${form.number}` : "Create IVR"}</h3>
          <form className="form" onSubmit={save}>
            <label>
              Menu number
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="500"
                required
              />
            </label>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main Menu"
              />
            </label>
            <label>
              Greeting prompt
              <select
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
              >
                {greetingChoices.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <div className="row2">
              <label>
                Digit timeout (s)
                <input
                  type="number"
                  value={form.timeout}
                  onChange={(e) => setForm({ ...form, timeout: +e.target.value })}
                />
              </label>
              <label>
                Max retries
                <input
                  type="number"
                  value={form.max_retries}
                  onChange={(e) => setForm({ ...form, max_retries: +e.target.value })}
                />
              </label>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={form.direct_dial}
                onChange={(e) => setForm({ ...form, direct_dial: e.target.checked })}
              />{" "}
              Allow callers to dial extensions directly
            </label>

            <div className="subhead">Menu keys</div>
            {form.options.map((o: Option, i: number) => (
              <div className="optrow" key={i}>
                <input
                  style={{ width: 40 }}
                  value={o.digit}
                  onChange={(e) => setOpt(i, { digit: e.target.value })}
                  placeholder="1"
                />
                <DestinationPicker
                  typeValue={o.dest_type}
                  valueValue={o.dest_value}
                  onType={(t) => setOpt(i, { dest_type: t })}
                  onValue={(v) => setOpt(i, { dest_value: v })}
                />
                <button type="button" className="btn small danger" onClick={() => delOpt(i)}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn small ghost" onClick={addOpt}>
              + Add key
            </button>

            <div className="subhead">Fallbacks</div>
            <DestinationPicker
              label="On no input (timeout):"
              typeValue={form.timeout_dest_type}
              valueValue={form.timeout_dest_value}
              onType={(t) => setForm({ ...form, timeout_dest_type: t })}
              onValue={(v) => setForm({ ...form, timeout_dest_value: v })}
            />
            <DestinationPicker
              label="On invalid key:"
              typeValue={form.invalid_dest_type}
              valueValue={form.invalid_dest_value}
              onType={(t) => setForm({ ...form, invalid_dest_type: t })}
              onValue={(v) => setForm({ ...form, invalid_dest_value: v })}
            />

            {node}
            <div className="row2">
              <button className="btn">{editId ? "Save changes" : "Create IVR"}</button>
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
          <h3>{list.length} menus</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Keys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((iv) => (
                <tr key={iv.id}>
                  <td>{iv.number}</td>
                  <td>{iv.name}</td>
                  <td className="small">
                    {iv.options
                      .map((o) => `${o.digit}→${o.dest_type}:${o.dest_value}`)
                      .join("  ") || "—"}
                  </td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => edit(iv)}>
                      Edit
                    </button>{" "}
                    <button className="btn small danger" onClick={() => remove(iv.id)}>
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
