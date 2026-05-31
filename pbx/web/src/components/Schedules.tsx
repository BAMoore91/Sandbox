import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { DestinationPicker, useFormError } from "./flow";

interface Range {
  times: string;
  weekdays: string;
  monthdays: string;
  months: string;
}
interface TC {
  id: number;
  number: string;
  name: string | null;
  timezone: string | null;
  match_dest_type: string;
  match_dest_value: string;
  nomatch_dest_type: string;
  nomatch_dest_value: string;
  ranges: Range[];
}

const BLANK = {
  number: "",
  name: "",
  timezone: "",
  match_dest_type: "ivr",
  match_dest_value: "",
  nomatch_dest_type: "voicemail",
  nomatch_dest_value: "",
  ranges: [{ times: "09:00-17:00", weekdays: "mon-fri", monthdays: "*", months: "*" }] as Range[],
};

export default function Schedules() {
  const { tid } = useParams();
  const [list, setList] = useState<TC[]>([]);
  const [form, setForm] = useState<any>(BLANK);
  const [editId, setEditId] = useState<number | null>(null);
  const { err, setErr, node } = useFormError();

  const base = `/api/tenants/${tid}/time-conditions`;
  async function load() {
    setList(await api.get<TC[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid]);

  function setRange(i: number, patch: Partial<Range>) {
    setForm({
      ...form,
      ranges: form.ranges.map((r: Range, idx: number) => (idx === i ? { ...r, ...patch } : r)),
    });
  }
  function addRange() {
    setForm({
      ...form,
      ranges: [...form.ranges, { times: "*", weekdays: "*", monthdays: "*", months: "*" }],
    });
  }
  function delRange(i: number) {
    setForm({ ...form, ranges: form.ranges.filter((_: any, idx: number) => idx !== i) });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const body = { ...form, timezone: form.timezone || null };
      if (editId) await api.patch(`${base}/${editId}`, body);
      else await api.post(base, body);
      setForm(BLANK);
      setEditId(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  function edit(tc: TC) {
    setEditId(tc.id);
    setForm({ ...tc, name: tc.name || "", timezone: tc.timezone || "", ranges: tc.ranges.length ? tc.ranges : BLANK.ranges });
    window.scrollTo(0, 0);
  }
  async function remove(id: number) {
    if (!confirm("Delete this schedule?")) return;
    await api.del(`${base}/${id}`);
    load();
  }

  return (
    <div>
      <h2>Schedules (Business Hours)</h2>
      <p className="muted">
        Route calls one way during open hours and another way after hours or on
        holidays. Point a phone number (DID) at a schedule to use it.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>{editId ? `Edit schedule ${form.number}` : "Create schedule"}</h3>
          <form className="form" onSubmit={save}>
            <label>
              Number
              <input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="700"
                required
              />
            </label>
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Business Hours"
              />
            </label>
            <label>
              Timezone (blank = company default)
              <input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="America/New_York"
              />
            </label>

            <div className="subhead">Open-hours time ranges</div>
            <div className="small muted">
              times, weekdays, month-days, months (use * for any). e.g.
              09:00-17:00 / mon-fri / * / *
            </div>
            {form.ranges.map((r: Range, i: number) => (
              <div className="optrow" key={i}>
                <input
                  style={{ width: 100 }}
                  value={r.times}
                  onChange={(e) => setRange(i, { times: e.target.value })}
                  placeholder="09:00-17:00"
                />
                <input
                  style={{ width: 80 }}
                  value={r.weekdays}
                  onChange={(e) => setRange(i, { weekdays: e.target.value })}
                  placeholder="mon-fri"
                />
                <input
                  style={{ width: 60 }}
                  value={r.monthdays}
                  onChange={(e) => setRange(i, { monthdays: e.target.value })}
                  placeholder="*"
                />
                <input
                  style={{ width: 70 }}
                  value={r.months}
                  onChange={(e) => setRange(i, { months: e.target.value })}
                  placeholder="*"
                />
                <button type="button" className="btn small danger" onClick={() => delRange(i)}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn small ghost" onClick={addRange}>
              + Add range
            </button>

            <div className="subhead">Routing</div>
            <DestinationPicker
              label="During open hours:"
              typeValue={form.match_dest_type}
              valueValue={form.match_dest_value}
              onType={(t) => setForm({ ...form, match_dest_type: t })}
              onValue={(v) => setForm({ ...form, match_dest_value: v })}
            />
            <DestinationPicker
              label="Outside open hours:"
              typeValue={form.nomatch_dest_type}
              valueValue={form.nomatch_dest_value}
              onType={(t) => setForm({ ...form, nomatch_dest_type: t })}
              onValue={(v) => setForm({ ...form, nomatch_dest_value: v })}
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
          <h3>{list.length} schedules</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Open hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((tc) => (
                <tr key={tc.id}>
                  <td>{tc.number}</td>
                  <td>{tc.name}</td>
                  <td className="small">
                    {tc.ranges.map((r) => `${r.times} ${r.weekdays}`).join("; ")}
                  </td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => edit(tc)}>
                      Edit
                    </button>{" "}
                    <button className="btn small danger" onClick={() => remove(tc.id)}>
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
