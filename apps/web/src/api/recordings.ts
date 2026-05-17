import { api } from "./client";

export interface Recording {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  sizeBytes: number;
  codec: string;
  width: number | null;
  height: number | null;
}

export interface PlaybackTicket {
  ticket: string;
  expiresIn: number;
}

export const recordingsApi = {
  listForCamera: (cameraId: string, range?: { from: number; to: number }) => {
    const qs = range ? `?from=${range.from}&to=${range.to}` : "";
    return api<{ recordings: Recording[] }>(
      `/cameras/${cameraId}/recordings${qs}`,
    ).then((r) => r.recordings);
  },
  playbackTicket: (recordingId: string) =>
    api<PlaybackTicket>(`/recordings/${recordingId}/ticket`, {
      method: "POST",
    }),
  fileUrl: (recordingId: string, ticket: string) =>
    `/api/recordings/${recordingId}/file?ticket=${encodeURIComponent(ticket)}`,
  thumbnailUrl: (recordingId: string) =>
    `/api/recordings/${recordingId}/thumbnail`,
};
