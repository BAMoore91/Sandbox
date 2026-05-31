import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getToken } from "../api";

// Live operations wallboard: active calls, queue stats, agent presence.
// Streams snapshots over SSE; falls back to polling if the stream drops.
interface Call {
  id: string;
  caller: string;
  connected: string;
  state: string;
  duration: number | string;
  channel: string;
}
interface Queue {
  queue: string;
  calls_waiting?: number;
  completed?: number;
  abandoned?: number;
  hold_time?: number;
  members?: number;
}
interface Agent {
  queue: string;
  name: string;
  paused: boolean;
  in_call: boolean;
  calls_taken: number;
}
interface Snap {
  active_calls: Call[];
  active_call_count: number;
  queues: Queue[];
  agents: Agent[];
  extensions_online: number;
  extensions_total: number;
}

export default function Wallboard() {
  const { tid } = useParams();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    // EventSource can't send Authorization headers, so pass the token as a
    // query param (the API also accepts the bearer; here we poll as fallback).
    async function pollOnce() {
      try {
        setSnap(await api.get<Snap>(`/api/tenants/${tid}/wallboard`));
      } catch {
        /* ignore */
      }
    }
    // Try SSE via a token query param; if it errors, fall back to polling.
    const url = `/api/tenants/${tid}/wallboard/stream?access_token=${getToken()}`;
    try {
      const es = new EventSource(url);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          setSnap(JSON.parse(ev.data));
          setLive(true);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        setLive(false);
        es.close();
        esRef.current = null;
        if (!poll) {
          pollOnce();
          poll = setInterval(pollOnce, 4000);
        }
      };
    } catch {
      pollOnce();
      poll = setInterval(pollOnce, 4000);
    }
    pollOnce();
    return () => {
      esRef.current?.close();
      if (poll) clearInterval(poll);
    };
  }, [tid]);

  const fmt = (d: number | string) => {
    const n = typeof d === "number" ? d : parseInt(String(d)) || 0;
    const mm = Math.floor(n / 60);
    const ss = n % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };

  return (
    <div>
      <h2>
        Wallboard{" "}
        <span className={"pill " + (live ? "active" : "")}>{live ? "live" : "polling"}</span>
      </h2>

      <div className="stats">
        <div className="stat">
          <div className="num">{snap?.active_call_count ?? 0}</div>
          <div>Active calls</div>
        </div>
        <div className="stat">
          <div className="num">
            {snap?.extensions_online ?? 0}/{snap?.extensions_total ?? 0}
          </div>
          <div>Phones online</div>
        </div>
        <div className="stat">
          <div className="num">
            {(snap?.queues || []).reduce((a, q) => a + (q.calls_waiting || 0), 0)}
          </div>
          <div>Callers waiting</div>
        </div>
        <div className="stat">
          <div className="num">{snap?.agents.filter((a) => !a.paused).length ?? 0}</div>
          <div>Agents available</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Active calls</h3>
          <table>
            <thead>
              <tr><th>From</th><th>To</th><th>State</th><th>Dur</th></tr>
            </thead>
            <tbody>
              {(snap?.active_calls || []).map((c) => (
                <tr key={c.id}>
                  <td>{c.caller || "—"}</td>
                  <td>{c.connected || "—"}</td>
                  <td><span className="pill">{c.state}</span></td>
                  <td>{fmt(c.duration)}</td>
                </tr>
              ))}
              {(!snap || snap.active_calls.length === 0) && (
                <tr><td colSpan={4} className="muted">No active calls.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Queues</h3>
          <table>
            <thead>
              <tr><th>Queue</th><th>Waiting</th><th>Members</th><th>Done</th><th>Aband.</th></tr>
            </thead>
            <tbody>
              {(snap?.queues || []).map((q) => (
                <tr key={q.queue}>
                  <td>{q.queue}</td>
                  <td>{q.calls_waiting ?? 0}</td>
                  <td>{q.members ?? 0}</td>
                  <td>{q.completed ?? 0}</td>
                  <td>{q.abandoned ?? 0}</td>
                </tr>
              ))}
              {(!snap || snap.queues.length === 0) && (
                <tr><td colSpan={5} className="muted">No queues.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Agents</h3>
        <table>
          <thead>
            <tr><th>Agent</th><th>Queue</th><th>Status</th><th>Calls taken</th></tr>
          </thead>
          <tbody>
            {(snap?.agents || []).map((a, i) => (
              <tr key={i}>
                <td>{a.name}</td>
                <td>{a.queue}</td>
                <td>
                  <span
                    className={
                      "pill " + (a.paused ? "suspended" : a.in_call ? "" : "active")
                    }
                  >
                    {a.paused ? "paused" : a.in_call ? "on call" : "available"}
                  </span>
                </td>
                <td>{a.calls_taken}</td>
              </tr>
            ))}
            {(!snap || snap.agents.length === 0) && (
              <tr><td colSpan={4} className="muted">No queue agents.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
