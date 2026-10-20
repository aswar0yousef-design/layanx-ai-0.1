# LayanX AI — Architecture

User goal -> Mission -> Contract/Permission -> Agent -> Tool -> Sentinel -> Execute -> Verify -> Ledger.

Rules: agents never grant themselves permissions; external content is untrusted data; tool actions require idempotency keys; dangerous actions require policy approval; Sentinel can block prohibited actions; missions are auditable; avoid unnecessary layers.

## Layer map (source of truth per responsibility)

| Layer | Directory | Notes |
|---|---|---|
| Application / local API | `src/api-server.ts`, `src/control-center.ts`, `web/`, `src/local/` | Token-protected local API, Arabic RTL / English LTR control center |
| Agent runtime | `src/core/` (`orchestrator.ts` = `LayanXCore`, `mission-*`, `lifecycle.ts`, `team-runtime.ts`, `scheduler.ts`, `event-engine.ts`) | One gateway (`runAgentGateway`) for chat, schedules, events and teams |
| Tool fabric | `src/tools/` (`fabric.ts`, `builtin.ts`, `git.ts`, `http-read.ts`, `desktop-control.ts`) | Every tool call passes the central permission/approval/Sentinel path |
| Providers / models | `src/providers/`, `src/models/`, `src/core/model-router.ts` | Ollama default; OpenAI/Anthropic/Gemini optional |
| Persistence | `src/storage/` | Transactional JSON, SQLite (`node:sqlite`), optional PostgreSQL |
| Memory | `src/memory/` | Lexical + semantic (Ollama embeddings), project-scoped |
| Security | `src/security/` (`project-isolation.ts`, `approval.ts`, `network-guard.ts`), `src/platform/path-guard.ts` | See `SECURITY.md` |
| Skills / MCP | `src/skills/`, `src/mcp/` | See `SKILLS.md` |
| Diagnostics | `src/system-doctor.ts`, `src/doctor.ts`, `src/readiness.ts` | See `DOCTOR.md` |
| Domain modules | `src/business/`, `src/trading/`, `src/voice/`, `src/creator/`, `src/quran/` | External APIs are optional and approval-gated |

Status of each feature with evidence: `FEATURE_MATRIX.md`. Audit and priorities: `AUDIT-2026-10-20.md`, `ROADMAP.md`.
