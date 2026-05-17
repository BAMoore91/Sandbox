# SoftBiscuit AI Worker — Google Coral Edge TPU

Python sidecar that performs object detection on Coral Edge TPU and
returns detections to the Node.js service over a local socket
(UNIX domain socket on Linux, named pipe on Windows).

Implementation lands in **Phase 4**. For now this folder reserves the
shape and ships a stubbed `main.py`.

## Planned runtime

- `tflite_runtime` (compiled with Edge TPU delegate support)
- `pycoral` for model + label loading
- `libedgetpu` system library (installed via vendor package on
  Linux; via the Coral USB driver on Windows)
- Model: `ssd_mobiledet_coco_edgetpu.tflite` (shipped in `models/`)

## IPC protocol (draft)

Length-prefixed msgpack frames:

```
request  = { cameraId: string, jpeg: bytes, ts: u64 }
response = { cameraId: string, ts: u64, detections: [
              { label: string, score: u8, bbox: [x,y,w,h] (0..1)
            } ] }
```
