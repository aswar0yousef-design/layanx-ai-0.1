# Changelog

## Unreleased — PostgreSQL verified, dependency audit

### Added
- `tests/postgres-storage.spec.ts` against a real PostgreSQL (verified locally on 17.6): commit, rollback on error and explicit, closed-transaction writes refused, 20 concurrent writers, health (wrong password reported without echoing it), and approval restart recovery through `RuntimePersistence`.
- `scripts/postgres-runtime-check.ts`: `createRuntime` + `restoreRuntime` on `LAYANX_DATABASE_URL`, health probe row must be fresh in PostgreSQL.
- CI: job `postgres` (service `postgres:17`, `LAYANX_REQUIRE_POSTGRES=1`), and `npm audit --audit-level=high` in the Linux quality job (currently 0 vulnerabilities).

### Fixed
- `RuntimePersistence` used the configurable snapshot key for `save`/`list` but a hard-coded `"runtime:snapshots"` in its transactional methods; all now use `RuntimeStorage.snapshotKey` (no change with the default key).

## Unreleased — Creator images (OpenAI)

### Added
- `creator.generate_assets` can use OpenAI Images when `LAYANX_CREATOR_IMAGE_PROVIDER=openai` and `OPENAI_API_KEY` are set (opt-in, billed per image; local command and ComfyUI keep priority). Size follows the project aspect (1024x1536 / 1536x1024 / 1024x1024), default model `gpt-image-1`, quality `low`. Output must be a real PNG; API errors never echo the key. `creator.doctor` lists `openai-images`.
- Test `creator-comfyui.spec.ts`: the existing ComfyUI adapter against a local HTTP server (placeholder substitution, polling, PNG download, error status).
- Test `creator-openai-images.spec.ts`: no call unless selected, missing key, 401 without key leak, non-PNG refused, request shape, PNG files, and a real FFmpeg render to MP4.

## Unreleased — DNS pinning (R1)

### Security
- `pinnedFetch` / `createPinnedFetch` in `src/security/network-guard.ts`: fetch-compatible transport on Node `http`/`https` whose socket `lookup` refuses any blocked address, so the connection is pinned to checked addresses (closes DNS rebinding R1). Never follows redirects (`error` throws, `manual` returns 3xx, `follow` refused).
- Default transport of `browser.read`, `http.read` and `media.inspect`. Test: `tests/dns-pinning.spec.ts`; live HTTPS check against example.com passed.

## Unreleased — Phase 3: Windows uninstall and autostart

### Added
- `LayanX-Uninstall.cmd` / `scripts/windows/uninstall.ps1`: stops LayanX, removes the autostart task and the desktop shortcut that points to this copy; keeps data by default. `-RemoveData` requires typing DELETE (or `-Yes`), writes and verifies a ZIP backup first (unless `-NoBackup`), and refuses drive roots, profile/AppData/system folders, the LayanX folder itself, and folders without LayanX markers.
- `scripts/windows/autostart.ps1 -Enable|-Disable`: optional per-user log-on task (no admin, off by default) running `start.ps1 -NoBrowser -Unattended`.
- `start.ps1 -Unattended`: never prompts; declines every install offer.
- `scripts/windows/uninstall-test.ps1`, run in CI on Windows against temporary folders.

### Fixed
- `stop.ps1` no longer sweeps "helper" processes when `LAYANX_DATA_DIR` points at a broad folder (drive root, profile, AppData), which could have stopped unrelated apps.

## Unreleased — Phase 2: Control Center diagnostics

### Added
- Control Center page "Diagnostics / التشخيص": live system doctor results (status, hints, GPU/RAM, installed Ollama models) with redacted JSON export. API: `GET /v1/system/doctor` (token-protected).
### Security
- `media.inspect` (L1 agent tool and `POST /v1/business/media/inspect`) no longer follows redirects blindly: each hop (max 3) passes `assertPublicHttpUrl` (private/loopback/link-local/metadata addresses and DNS answers blocked), 10 s timeout. Test: `media-manager.spec.ts`.

### Added (UI)
- Schedules page: weekly option (day picker), browser IANA timezone sent with daily/weekly triggers, and a "Recent runs" list from `GET /v1/scheduler/runs` including `interrupted` runs.

## Unreleased — Phase 1: skills runtime integrity

### Added
- `src/skills/installer.ts` + `npm run skills -- <list|inspect|install|approve|enable|disable|uninstall|verify>`: install skill packages (`skill.json` + `SKILL.md`) from a local folder with manifest validation, real SHA-256 verification, content scanning, duplicate detection, SemVer updates that return to quarantine, persisted status, and re-verification on every start (tampered skills become `rejected`).
- Skill content rules are shared by learned and installed skills (`scanSkillContent`), extended with PowerShell `iex`/`-EncodedCommand`, `certutil -urlcache`, Defender tampering and backup deletion.
- Test: `skill-installer.spec.ts`.
- `npm run test:integration|test:e2e|test:security|test:recovery` run real subsets defined in `tests/suites.json`; an empty suite fails.

## Unreleased — Phase 0 audit and hardening (2026-10-20)

### Security
- File tools (`files.read/list/stat/write`) refuse targets whose real path leaves the project workspace through a symlink or Windows junction, refuse writing through links, and apply the shared Windows path guard (ADS, device names, `\\?\`, drive-relative paths).
- New `src/security/network-guard.ts`: `browser.read` and `http.read` block loopback, `0.0.0.0/8`, private, CGNAT, link-local/cloud-metadata, multicast and IPv6 local/mapped forms, and check every DNS answer.

### Added
- `npm run doctor` is now a full system doctor (Node, Windows build, RAM, NVIDIA VRAM, data dir, disk, port, git/ffmpeg/python/powershell/playwright, persistence, providers, model fit) with `--json`, `--out` (redacted) and `--providers`.
- Scheduler: `weekly` and `monthly` triggers, IANA `timezone`, persisted run history (`GET /v1/scheduler/runs`), opt-in bounded retry, `interrupted` status for runs cut off by a shutdown.
- Docs: `AUDIT-2026-10-20.md`, `FEATURE_MATRIX.md`, `TESTING.md`, `TROUBLESHOOTING.md`, `SKILLS.md`, `ROADMAP.md`; updated `ARCHITECTURE.md`, `SECURITY.md`, `DOCTOR.md`, README scheduler section.

### Fixed
- Interval schedules with `runImmediately: true` re-fired on every tick after the first run.
- Provider health checks could hang forever on an unresponsive Ollama; they now have a hard deadline.

### Tests
- New: `tool-sandbox-escape.spec.ts`, `system-doctor.spec.ts`, `scheduler-calendar-retry.spec.ts`; extended `scheduler-event-api-auth.spec.ts`.
