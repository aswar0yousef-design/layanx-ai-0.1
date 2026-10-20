# Cloud model providers

LayanX supports a common provider interface for local and cloud models.

Configured cloud providers:
- OpenAI Responses API
- Anthropic Claude Messages API
- Google Gemini API

Set `LAYANX_AI_MODE=cloud` or `hybrid`, then enable only the providers you want. API keys are read from environment variables and are never included in provider summaries.

Example variables are in `.env.example`:
- `OPENAI_ENABLED` / `OPENAI_API_KEY`
- `ANTHROPIC_ENABLED` / `ANTHROPIC_API_KEY`
- `GEMINI_ENABLED` / `GEMINI_API_KEY`

In hybrid mode Ollama is priority 1; enabled cloud providers are registered after it and therefore participate in provider failover.

OpenAI uses the Responses API. Anthropic uses the Messages API. Gemini uses `generateContent`; the provider abstraction keeps the rest of LayanX independent of vendor-specific request and authentication formats.

## Images for the Creator (OpenAI Images, optional, paid)

| Setting | Value |
|---|---|
| `LAYANX_CREATOR_IMAGE_PROVIDER` | `openai` (required; nothing is sent otherwise) |
| `OPENAI_API_KEY` | your key (store it in the setup page secrets, not in Git) |
| `LAYANX_CREATOR_IMAGE_MODEL` | default `gpt-image-1` |
| `LAYANX_CREATOR_IMAGE_QUALITY` | `low` (default) / `medium` / `high` / `auto` |

One request per scene, billed by OpenAI. A local executable or ComfyUI, when configured, is always used first.
Status: implemented and tested with an injected transport plus a real FFmpeg render; a live call needs your key.
