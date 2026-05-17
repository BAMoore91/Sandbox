import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export type StreamKind = "main" | "sub";

export type StreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

interface TicketResponse {
  ticket: string;
  kind: StreamKind;
  expiresIn: number;
}

interface Options {
  kind?: StreamKind;
  /** If true, automatically reconnect on transient failure with backoff. */
  autoReconnect?: boolean;
}

function buildWsUrl(cameraId: string, ticket: string, kind: StreamKind): string {
  const u = new URL(`/ws/stream/${cameraId}`, window.location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("ticket", ticket);
  u.searchParams.set("kind", kind);
  return u.toString();
}

/**
 * Subscribe a `<video>` element to a camera's live WebRTC stream.
 *
 * Connect flow:
 *   1. POST /api/streams/:id/ticket  -> short-lived signed ticket
 *   2. WS to /ws/stream/:id?ticket=... (server proxies to go2rtc)
 *   3. Browser is the WebRTC offerer (recvonly video + audio)
 *   4. SDP offer/answer + trickle ICE exchanged over the WS
 *
 * Attach the returned `videoRef` to a `<video autoPlay muted playsInline />`.
 */
export function useWebRTCStream(
  cameraId: string | null,
  options: Options = {},
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraId) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    /**
     * Tracks whether ICE has reached connected/completed at least once.
     * After that, media keeps flowing even if the signaling WS closes,
     * so we don't tear down the video on a late WS close.
     */
    let mediaActive = false;

    const teardown = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {}
        ws = null;
      }
      if (pc) {
        try {
          pc.close();
        } catch {}
        pc = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      setError(null);

      try {
        const ticketRes = await api<TicketResponse>(
          `/streams/${cameraId}/ticket?kind=${options.kind ?? "main"}`,
          { method: "POST" },
        );
        if (cancelled) return;

        pc = new RTCPeerConnection();
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (!pc || cancelled) return;
          const s = pc.iceConnectionState;
          if (s === "connected" || s === "completed") {
            mediaActive = true;
            setStatus("connected");
            attempt = 0; // reset backoff on success
          } else if (s === "failed") {
            mediaActive = false;
            setStatus("failed");
            setError("ICE connection failed");
            if (options.autoReconnect) scheduleReconnect();
          } else if (s === "disconnected") {
            setStatus("reconnecting");
          }
        };

        pc.onicecandidate = (event) => {
          if (
            event.candidate &&
            ws &&
            ws.readyState === WebSocket.OPEN &&
            event.candidate.candidate
          ) {
            ws.send(
              JSON.stringify({
                type: "webrtc/candidate",
                value: event.candidate.candidate,
              }),
            );
          }
        };

        ws = new WebSocket(buildWsUrl(cameraId, ticketRes.ticket, ticketRes.kind));

        ws.onopen = async () => {
          if (!pc || cancelled) return;
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws!.send(
              JSON.stringify({ type: "webrtc/offer", value: offer.sdp }),
            );
          } catch (e) {
            setStatus("failed");
            setError(`offer failed: ${(e as Error).message}`);
          }
        };

        ws.onmessage = async (event) => {
          if (!pc || cancelled) return;
          let msg: { type?: string; value?: string };
          try {
            msg = JSON.parse(event.data as string);
          } catch {
            return;
          }
          if (msg.type === "webrtc/answer" && msg.value) {
            try {
              await pc.setRemoteDescription({
                type: "answer",
                sdp: msg.value,
              });
            } catch (e) {
              setStatus("failed");
              setError(`answer failed: ${(e as Error).message}`);
            }
          } else if (msg.type === "webrtc/candidate" && msg.value) {
            try {
              await pc.addIceCandidate({
                candidate: msg.value,
                sdpMid: "0",
                sdpMLineIndex: 0,
              });
            } catch {
              // ignore; some candidates are stale
            }
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setStatus("failed");
          setError("websocket error");
        };

        ws.onclose = (event) => {
          if (cancelled) return;
          // If ICE is already up, media flows on a separate UDP socket —
          // a WS close at this point is harmless; ignore it.
          if (mediaActive) return;
          if (event.code === 1000) {
            setStatus("closed");
            return;
          }
          setStatus("failed");
          setError(
            `closed ${event.code}${event.reason ? `: ${event.reason}` : ""}`,
          );
          if (options.autoReconnect) scheduleReconnect();
        };
      } catch (e) {
        if (cancelled) return;
        setStatus("failed");
        setError(String(e));
        if (options.autoReconnect) scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(15_000, 1000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        teardown();
        void connect();
      }, delay);
    };

    void connect();

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, options.kind, options.autoReconnect]);

  return { videoRef, status, error };
}
