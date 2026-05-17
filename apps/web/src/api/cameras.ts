import { api } from "./client";

export interface Camera {
  id: string;
  name: string;
  rtspUrl: string;
  subRtspUrl: string | null;
  onvifUrl: string | null;
  username: string | null;
  enabled: boolean;
  aiEnabled: boolean;
  aiConfig: string | null;
  retentionDays: number | null;
  createdAt: number;
  updatedAt: number;
  streamNames: { main: string; sub: string | null };
}

export interface DiscoveredDevice {
  address: string;
  xaddrs: string[];
  scopes: string[];
  name?: string;
  manufacturer?: string;
  model?: string;
  endpoint?: string;
}

export interface ProbeStream {
  codec: string;
  type: "video" | "audio" | "other";
  width?: number;
  height?: number;
  fps?: number;
  channels?: number;
  sampleRate?: number;
}

export interface ProbeResult {
  ok: boolean;
  durationSec?: number;
  bitrate?: number;
  streams: ProbeStream[];
  error?: string;
}

export interface CameraInput {
  name: string;
  rtspUrl: string;
  subRtspUrl?: string | null;
  onvifUrl?: string | null;
  username?: string | null;
  password?: string | null;
  enabled?: boolean;
  retentionDays?: number | null;
}

export const camerasApi = {
  list: () => api<{ cameras: Camera[] }>("/cameras").then((r) => r.cameras),
  create: (body: CameraInput) =>
    api<{ camera: Camera }>("/cameras", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.camera),
  update: (id: string, body: Partial<CameraInput>) =>
    api<{ camera: Camera }>(`/cameras/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((r) => r.camera),
  remove: (id: string) =>
    api<{ ok: true }>(`/cameras/${id}`, { method: "DELETE" }),
  probe: (url: string) =>
    api<ProbeResult>("/cameras/probe", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  discover: () =>
    api<{ devices: DiscoveredDevice[] }>("/cameras/discover", {
      method: "POST",
    }).then((r) => r.devices),
};
