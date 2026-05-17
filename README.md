# SoftBiscuit NVR

Self-hosted, cross-platform Network Video Recorder. Camera-agnostic
(any ONVIF/RTSP camera), sub-second WebRTC live view, continuous
recording, and on-device AI object detection via Google Coral Edge TPU.

Inspired by Unifi Protect — without being locked into their cameras.

## Status

Early development. See [the plan](/.) for the phased roadmap.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: monorepo, auth, DB, React shell | Done |
| 1 | Camera ingest (ONVIF/RTSP via go2rtc) | Done |
| 2 | Live multi-camera WebRTC viewer | Done |
| 3 | Recording, retention, timeline | Pending |
| 4 | AI detection on Coral TPU | Pending |
| 5 | Packaging: .deb/.rpm + MSI | Pending |

## Architecture

```
Browser (React + WebRTC)
  ↓
SoftBiscuit Service (Node.js / Fastify)
  ├─→ go2rtc        (RTSP/ONVIF → WebRTC/HLS)
  ├─→ ffmpeg        (per-camera segmented recording)
  └─→ AI sidecar    (Python + pycoral, Coral Edge TPU inference)
```

Everything runs on a single host. Node.js orchestrates;
go2rtc + ffmpeg + the Python AI worker do the heavy lifting.

## Repo layout

```
apps/server/          Node.js + Fastify service
apps/web/             React + Vite frontend
workers/ai-coral/     Python Coral inference sidecar
vendor/               Bundled go2rtc + ffmpeg (fetched at build time)
packaging/            Linux .deb/.rpm + Windows MSI
scripts/              Build, vendor fetch, dev helpers
```

## Development

```bash
# Requires Node 20+ and pnpm 9+
pnpm install
pnpm fetch-vendor          # downloads go2rtc + ffmpeg for your OS
pnpm --filter @softbiscuit/server db:migrate
pnpm dev                   # starts server (:8088) + web (:5173) concurrently
```

Open http://localhost:5173. First load shows a bootstrap form to create
the admin account; subsequent loads show the login page.

go2rtc's own admin UI is on http://localhost:1984 — handy for verifying
that a camera you added is reachable end-to-end.

### Vendor binaries

`pnpm fetch-vendor` downloads `go2rtc` and a static `ffmpeg`+`ffprobe`
build into `vendor/` for the host OS. To prepare release artifacts for
the other OS, run `pnpm fetch-vendor -- --target=windows` (or `linux`,
or `all`).

## License

MIT.
