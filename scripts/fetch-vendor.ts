/**
 * Downloads + extracts the bundled native binaries that the NVR ships with:
 *   - go2rtc  (RTSP/ONVIF -> WebRTC/HLS streaming)
 *   - ffmpeg  (recording + thumbnails)
 *
 * Real implementation lands alongside Phase 1 (go2rtc) and Phase 3 (ffmpeg).
 * For now this is a stub so the workspace lints + builds cleanly.
 */

import { platform, arch } from "node:os";

function main() {
  const os = platform();
  const cpu = arch();
  console.log(`[fetch-vendor] target: ${os}/${cpu}`);
  console.log("[fetch-vendor] No-op stub. Implemented in Phase 1.");
}

main();
