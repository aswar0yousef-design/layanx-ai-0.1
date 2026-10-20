# LayanX System Doctor

`npm run doctor` inspects the real machine. Every line comes from a live probe; nothing is a fixed "ok".

| Check | Blocking | What it probes |
|---|---|---|
| `node` | yes | Node.js major version >= 22 |
| `os` | no | Platform and Windows build (>= 22000 = Windows 11) |
| `memory` | no | Total / free RAM (warns under 8 GiB) |
| `gpu` | no | `nvidia-smi` name + VRAM (absence = CPU inference) |
| `data-dir` | yes | `%LOCALAPPDATA%\LayanX` (or `LAYANX_DATA_DIR`) exists and is writable |
| `disk` | no | Free space on the data drive (warns under 10 GiB) |
| `persistence` | no | `LAYANX_RUNTIME_STORAGE_PATH` or a database URL is configured |
| `port-<n>` | no | API port (`LAYANX_API_PORT`, default 3000) is free |
| `tool-git`, `tool-ffmpeg`, `tool-python`, `tool-powershell`, `tool-playwright` | no | External tools LayanX features depend on |
| `provider-ollama` | yes | Ollama reachable and the configured model installed (5 s hard deadline) |
| `provider-<cloud>` | no | Cloud provider reachability when configured |
| `model-<name>` | no | Installed Ollama models that will not fit in VRAM/RAM |

```powershell
npm run doctor                          # readable report, exit code 1 when a blocking check fails
npm run doctor -- --json                # full JSON
npm run doctor -- --out doctor.json     # write a redacted report you can share for support
npm run doctor -- --providers           # previous provider-only output
```

Redaction: API keys, bearer tokens and database URLs are removed before printing or exporting. Provider credentials are reported only as configured / not configured. The doctor never downloads a model or installs software; it prints the exact command to run instead.

Model fit is an estimate: weights x 1.2 must fit in VRAM for full GPU speed. Example for a GTX 1660 Super (6 GiB): a 7B Q4 model (~4.7 GiB) fits; a 14B model is split between GPU and CPU; a 70B model does not fit in 32 GiB RAM.
