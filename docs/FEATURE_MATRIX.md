# مصفوفة الميزات — LayanX-AI

آخر تحديث: 2026-10-20. كل حالة مبنية على دليل قابل للتتبع (اختبار في `tests/` أو تشغيل فعلي). لا تُرفع حالة إلى "Verified" دون اختبار.

الحالات: **Verified** = Implemented and Verified · **Partial** = Implemented, Partially Verified · **Failing** · **Mock** = Mock / Demo Only · **API** = Requires External API · **HW** = Requires Model or Hardware · **None** = Not Implemented · **Blocked**

| الميزة | الحالة | الملفات الأساسية | الدليل (اختبارات) | المتطلبات / المخاطر | التحقق اليدوي |
|---|---|---|---|---|---|
| Agent Gateway ودورة المهمة | Partial | `src/core/agent-gateway.ts`, `orchestrator.ts`, `mission-lifecycle.ts` | `agent-gateway*.spec`, `e2e-goal-to-memory.spec` | الحالات `queued`/`waiting_approval` غير موجودة كأسماء | `npm run local` ثم مهمة من صفحة Agent |
| الصلاحيات L1–L5 والموافقات | Verified | `src/security/*`, `core/approval*.ts` | `approval-restart-recovery.spec`, `red-team.spec` | — | صفحة Approvals |
| عزل المشاريع | Verified | `security/project-isolation.ts`, `memory/*` | `project-memory-isolation.spec`, `memory-scoped-recall.spec` | — | — |
| التخزين JSON/SQLite | Verified | `src/storage/*` | `runtime-storage*.spec`, `scheduler-persistence.spec` | — | — |
| PostgreSQL | Partial | `storage/postgres-adapter.ts` | `business-postgres-fallback.spec` (بدون قاعدة حقيقية) | لم يُختبر مقابل خادم Postgres فعلي في CI | تعيين `DATABASE_URL` |
| التعافي والاستئناف | Verified | `core/runtime-recovery.ts`, `recovery-*` | 15+ ملف `recovery-*.spec` | المعاملات الخارجية لا تُضمن مرة واحدة | — |
| Ollama (محلي) | HW | `providers/ollama-provider.ts`, `models/*` | `provider-doctor.spec` (transport محقون) | Ollama + نموذج مثبت؛ الاستدلال الحقيقي لم يُتحقق منه في بيئة التدقيق | `npm run doctor` ثم `npm run eval:local` |
| OpenAI / Anthropic / Gemini | API | `providers/*-provider.ts` | `provider-doctor.spec`, `cloud-*` | مفاتيح API عبر `npm run secrets` | `npm run doctor` |
| Model Router | Partial | `models/router.ts`, `model-selector.ts` | `model-router*.spec` | لا قياس جودة تلقائي للنماذج | — |
| أداة الملفات | Verified | `tools/fabric.ts` | `tool-fabric.spec`, **`tool-sandbox-escape.spec` (جديد)** | TOCTOU متبقٍ (موثّق) | — |
| أداة الطرفية | Verified | `tools/fabric.ts` (`createTerminalToolAdapter`) | `tool-fabric.spec` | قائمة سماح ضيقة جدًا بالتصميم؛ لا PowerShell عام | — |
| Git | Partial | `tools/git.ts`, `tools/builtin.ts` | `git-*.spec` | `git.push` مستوى L4 يحتاج موافقة | صفحة Git |
| قراءة الويب `browser.read` / `http.read` | Verified | `tools/fabric.ts`, `tools/http-read.ts`, **`security/network-guard.ts`** | `http-read-tool.spec`, **`tool-sandbox-escape.spec`** | DNS rebinding متبقٍ (موثّق) | — |
| متصفح تفاعلي Playwright | Partial | `autonomy/browser-test.ts` | `autonomy-*.spec` | `playwright-core` اختياري؛ لاختبار الواجهات فقط | — |
| التحكم بسطح مكتب Windows | HW | `tools/desktop-control.ts` | CI job `windows` | Windows فقط | — |
| Coding Mission / Safe Code Modifier | Partial | `core/safe-code-modifier.ts`, `code-review-agent.ts` | `safe-code*.spec`, `coding-*.spec` | — | — |
| الإصلاح الذاتي | Partial | `autonomy/supervisor.ts`, `core/self-repair*` | `self-repair*.spec` | حدود محاولات موجودة | — |
| Verification Engine | Partial | `core/verification*.ts` | `verification-*.spec` | — | — |
| Skills Runtime | Partial | `src/skills/*` | `skills-runtime.spec`, `skill-learning.spec` | سجل في الذاكرة فقط؛ checksum يُفحص وجوده لا مطابقته؛ لا تثبيت/إصدارات | — |
| MCP Gateway | Partial | `src/mcp/*` | `mcp-client.spec`, `mcp-gateway.spec` | خوادم المستخدم مسؤوليته | صفحة Integrations |
| الذاكرة النصية | Verified | `src/memory/*` | `memory*.spec`, `memory-arabic-hybrid.spec` | — | — |
| الذاكرة الدلالية | HW | `memory/embedder.ts`, `vector-store.ts` | `semantic-memory.spec` | نموذج تضمين (`nomic-embed-text`) | — |
| فرق الوكلاء | Partial | `core/team-runtime.ts` | `team-runtime.spec`, `agent-team-runtime.spec` | لا قفل ملفات بين الوكلاء | صفحة Team |
| المجدول | Verified | `core/scheduler.ts` | `scheduler-*.spec`, **`scheduler-calendar-retry.spec` (جديد)** | لا يعمل والتطبيق مغلق (استخدم Windows Task Scheduler) | صفحة Schedules + `GET /v1/scheduler/runs` |
| System Doctor | Verified | **`src/system-doctor.ts`**, `doctor.ts` | **`system-doctor.spec` (جديد)**, `provider-doctor.spec` | — | `npm run doctor` |
| الصوت | API / HW | `src/voice/*` | `voice-*.spec` | OpenAI audio أو Whisper/Piper محلي | صفحة Voice |
| إنتاج الفيديو (تجميع FFmpeg) | Partial | `creator/engine.ts` | `creator*.spec` | FFmpeg مثبت | — |
| توليد الصور/الفيديو بنماذج | None | — | — | يحتاج مزودًا (OpenAI Images / Gemini / ComfyUI) | — |
| التجارة الإلكترونية | API | `src/business/*`, `platforms/*` | `business-*.spec` | مفاتيح WooCommerce/Shopify؛ النشر بموافقة | صفحة Ecommerce |
| البريد و Google | API | `connectors/*`, `platform/google-*` | `email-*.spec`, `google-*.spec` | OAuth / IMAP | صفحة Integrations |
| التواصل الاجتماعي | Mock (موصل عام) | `business/social-*` | `social-publication-recovery.spec` | ليس تكاملًا أصليًا مع المنصات | — |
| الشحن واللوجستيات | None | — | — | — | — |
| التداول (تحليل/Backtest/Paper) | Verified | `src/trading/*` | `trading-*.spec`, `historical-backtest.spec` | — | صفحة Trading |
| التداول الحقيقي Binance/MT5 | API (مغلق افتراضيًا) | `trading/agent-integration.ts` | `binance-*.spec` | `BINANCE_LIVE_TRADING_ENABLED=true` + L4 + حد قيمة | — |
| Control Center | Partial | `web/*`, `src/control-center.ts` | `control-center*.spec`, CI `windows` smoke | داكن فقط؛ صفحات مفقودة (انظر AUDIT) | `npm run local` |
| تشغيل Windows (`LayanX.cmd`) | Partial | `LayanX.cmd`, `scripts/windows/*` | `bootstrap.spec`, CI windows | لا MSIX/WiX، لا إلغاء تثبيت | انقر `LayanX.cmd` |
