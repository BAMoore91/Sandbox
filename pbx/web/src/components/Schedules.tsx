import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { DestinationPicker, useFormError } from "./flow";

interface Holiday {
  id: number;
  name: string;
  recurring: boolean;
  month: number;
  day: number;
  year: number | null;
  times: string;
  dest_type: string | null;
  dest_value: string | null;
  enabled: boolean;
}

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

      {editId && <Holidays tid={tid!} tcId={editId} />}
    </div>
  );
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Holidays({ tid, tcId }: { tid: string; tcId: number }) {
  const [list, setList] = useState<Holiday[]>([]);
  const [form, setForm] = useState<any>({
    name: "", recurring: true, month: 1, day: 1, year: new Date().getFullYear(),
    times: "*", dest_type: "", dest_value: "",
  });
  const [err, setErr] = useState("");

  const base = `/api/tenants/${tid}/time-conditions/${tcId}/holidays`;
  async function load() {
    setList(await api.get<Holiday[]>(base));
  }
  useEffect(() => {
    load();
  }, [tid, tcId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.post(base, {
        name: form.name,
        recurring: form.recurring,
        month: +form.month,
        day: +form.day,
        year: form.recurring ? null : +form.year,
        times: form.times || "*",
        dest_type: form.dest_type || null,
        dest_value: form.dest_value || null,
      });
      setForm({ ...form, name: "" });
      load();
    } catch (e: any) {
      setErr(typeof e.message === "string" ? e.message : JSON.stringify(e.message));
    }
  }
  async function remove(id: number) {
    await api.del(`${base}/${id}`);
    load();
  }

  return (
    <div className="card">
      <h3>Holidays for this schedule</h3>
      <p className="muted small">
        A holiday forces the schedule <b>closed</b> for that day (overriding open
        hours). Recurring = same date every year; otherwise set a specific year.
        Leave the destination blank to use the schedule's “outside open hours”
        routing, or pick one for a special holiday greeting.
      </p>
      {err && <div className="error">{err}</div>}
      <form className="optrow" onSubmit={add}>
        <input style={{ width: 150 }} value={form.name} placeholder="Holiday name"
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
          {MONTHS.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input style={{ width: 55 }} type="number" min={1} max={31} value={form.day}
          onChange={(e) => setForm({ ...form, day: e.target.value })} />
        <label className="row small">
          <input type="checkbox" checked={form.recurring}
            onChange={(e) => setForm({ ...form, recurring: e.target.checked })} /> yearly
        </label>
        {!form.recurring && (
          <input style={{ width: 70 }} type="number" value={form.year}
            onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="year" />
        )}
        <input style={{ width: 100 }} value={form.times} placeholder="* or 09:00-12:00"
          onChange={(e) => setForm({ ...form, times: e.target.value })} />
        <button className="btn small">+ Add holiday</button>
      </form>

      <table>
        <thead>
          <tr><th>Name</th><th>Date</th><th>When</th><th>Hours</th><th>Routing</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td>
              <td>{MONTHS[h.month]} {h.day}</td>
              <td className="small">{h.recurring ? "every year" : h.year}</td>
              <td className="small">{h.times === "*" ? "all day" : h.times}</td>
              <td className="small">
                {h.dest_type ? `${h.dest_type} → ${h.dest_value}` : "closed (default)"}
              </td>
              <td><button className="btn small danger" onClick={() => remove(h.id)}>✕</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={6} className="muted">No holidays yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
