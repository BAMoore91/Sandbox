import { useEffect, useRef, useState } from "react";
import { Web } from "sip.js";

// Browser WebRTC softphone. Registers to Asterisk over secure WebSocket
// (wss://<host>:8089/ws) using a tenant extension's SIP credentials, and
// places/receives calls. Credentials are the ones shown when you create an
// extension (sip_username = "<slug>-<ext>", sip_password).

type State = "idle" | "connecting" | "registered" | "incall" | "ringing" | "failed";

export default function Softphone() {
  const [host, setHost] = useState(window.location.hostname);
  const [wssPort, setWssPort] = useState("8089");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [target, setTarget] = useState("");
  const [state, setState] = useState<State>("idle");
  const [log, setLog] = useState<string[]>([]);
  const suRef = useRef<Web.SimpleUser | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  function note(m: string) {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 50));
  }

  async function register() {
    setState("connecting");
    const server = `wss://${host}:${wssPort}/ws`;
    const aor = `sip:${user}@${host}`;
    try {
      const su = new Web.SimpleUser(server, {
        aor,
        media: { remote: { audio: audioRef.current || undefined } },
        userAgentOptions: {
          authorizationUsername: user,
          authorizationPassword: pass,
          displayName: user,
        },
        delegate: {
          onCallReceived: async () => {
            setState("ringing");
            note("Incoming call — answering");
            await su.answer();
            setState("incall");
          },
          onCallHangup: () => { setState("registered"); note("Call ended"); },
          onCallAnswered: () => { setState("incall"); note("Call answered"); },
          onRegistered: () => { setState("registered"); note("Registered"); },
          onUnregistered: () => { setState("idle"); note("Unregistered"); },
          onServerDisconnect: () => { setState("failed"); note("Disconnected"); },
        },
      });
      suRef.current = su;
      await su.connect();
      await su.register();
    } catch (e: any) {
      setState("failed");
      note("Register failed: " + (e?.message || e));
    }
  }

  async function unregister() {
    try { await suRef.current?.unregister(); await suRef.current?.disconnect(); }
    finally { suRef.current = null; setState("idle"); }
  }

  async function call() {
    if (!suRef.current) return;
    try {
      note(`Calling ${target}`);
      await suRef.current.call(`sip:${target}@${host}`);
    } catch (e: any) { note("Call failed: " + (e?.message || e)); }
  }

  async function hangup() { await suRef.current?.hangup(); setState("registered"); }

  useEffect(() => () => { suRef.current?.disconnect(); }, []);

  return (
    <div>
      <h2>WebRTC Softphone</h2>
      <div className="grid2">
        <div className="card">
          <h3>Connection <span className={"pill " + (state === "registered" || state === "incall" ? "active" : "suspended")}>{state}</span></h3>
          {state === "idle" || state === "failed" ? (
            <div className="form">
              <label>Server host<input value={host} onChange={(e) => setHost(e.target.value)} /></label>
              <label>WSS port<input value={wssPort} onChange={(e) => setWssPort(e.target.value)} /></label>
              <label>SIP user<input value={user} onChange={(e) => setUser(e.target.value)}
                placeholder="acme-1001" /></label>
              <label>SIP password<input type="password" value={pass}
                onChange={(e) => setPass(e.target.value)} /></label>
              <button className="btn" onClick={register}>Register</button>
            </div>
          ) : (
            <div className="form">
              <div className="muted small">Registered as <code>{user}</code></div>
              <button className="btn ghost" onClick={unregister}>Unregister</button>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Dialer</h3>
          <div className="form">
            <label>Dial<input value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder="1002 or +13105551234" /></label>
            {state === "incall" || state === "ringing" ? (
              <button className="btn danger" onClick={hangup}>Hang up</button>
            ) : (
              <button className="btn" disabled={state !== "registered"} onClick={call}>Call</button>
            )}
          </div>
          <audio ref={audioRef} autoPlay />
        </div>
      </div>

      <div className="card">
        <h3>Activity</h3>
        <pre className="logbox">{log.join("\n")}</pre>
      </div>
    </div>
  );
}
