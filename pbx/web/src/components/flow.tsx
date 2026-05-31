// Shared building blocks for call-flow editors (IVR, ring groups, schedules,
// DIDs). A "destination" is a (dest_type, dest_value) pair, mirroring the
// dialplan's generic dispatcher.
import { useState } from "react";

export const DEST_TYPES = [
  "extension",
  "ringgroup",
  "queue",
  "ivr",
  "flow",
  "voicemail",
  "timecondition",
  "hangup",
] as const;

export function DestinationPicker({
  typeValue,
  valueValue,
  onType,
  onValue,
  label,
}: {
  typeValue: string;
  valueValue: string;
  onType: (t: string) => void;
  onValue: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="destpick">
      {label && <span className="small muted">{label}</span>}
      <select value={typeValue} onChange={(e) => onType(e.target.value)}>
        {DEST_TYPES.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      {typeValue !== "hangup" && (
        <input
          value={valueValue}
          onChange={(e) => onValue(e.target.value)}
          placeholder="number / id"
          style={{ width: 110 }}
        />
      )}
    </div>
  );
}

// Small inline-error hook used by the flow editors.
export function useFormError() {
  const [err, setErr] = useState("");
  return {
    err,
    setErr,
    node: err ? <div className="error">{err}</div> : null,
  };
}
