# مصفوفة الميزات — LayanX-AI

آخر تحديث: 2026-10-20. كل حالة مبنية على دليل قابل للتتبع (اختبار في `tests/` أو تشغيل فعلي). لا تُرفع حالة إلى "Verified" دون اختبار.

الحالات: **Verified** = Implemented and Verified · **Partial** = Implemented, Partially Verified · **Failing** · **Mock** = Mock / Demo Only · **API** = Requires External API · **HW** = Requires Model or Hardware · **None** = Not Implemented · **Blocked**

| الميزة | الحالة | الملفات الأساسية | الدليل (اختبارات) | المتطلبات / المخاطر | التحقق اليدوي |
|---|---|---|---|---|---|
| Agent Gateway ودورة المهمة | Partial | `src/core/orchestrator.ts` (`runAgentGateway`), `lifecycle.ts`, `mission-runner.ts`, `mission-store.ts` | `agent-gateway-approval.spec`, `e2e-goal-to-memory.spec` | المهام المستقلة (`autonomy/supervisor.ts`) تستخدم `queued`/`waiting_approval`؛ المهمة الداخلية تستخدم `blocked` للموافقة | `npm run local` ثم مهمة من صفحة Agent |
| الصلاحيات L1–L5 والموافقات | Verified | `src/security/*` (`approval.ts`) | `approval-restart-recovery.spec`, `red-team.spec` | — | صفحة Approvals |
| عزل المشاريع | Verified | `security/project-isolation.ts`, `memory/*` | `project-memory-isolation.spec`, `memory-scoped-recall.spec` | — | — |
| التخزين JSON/SQLite | Verified | `src/storage/*` | `runtime-storage.spec`, `scheduler-persistence.spec` | — | — |
| PostgreSQL | Partial | `storage/postgres-adapter.ts` | `business-postgres-fallback.spec` (بدون قاعدة حقيقية) | لم يُختبر مقابل خادم Postgres فعلي في CI | تعيين `DATABASE_URL` |
| التعافي والاستئناف | Verified | `core/runtime-recovery.ts`, `recovery-*` | 15+ ملف `recovery-*.spec` | المعاملات الخارجية لا تُضمن مرة واحدة | — |
| Ollama (محلي) | HW | `src/providers/*`, `models/http-providers.ts`, `models/inference.ts` | `provider-doctor.spec` (transport محقون) | Ollama + نموذج مثبت؛ الاستدلال الحقيقي لم يُتحقق منه في بيئة التدقيق | `npm run doctor` ثم `npm run smoke:ollama` |
| OpenAI / Anthropic / Gemini | API | `providers/*-provider.ts` | `provider-doctor.spec`, `cloud-provider-adapters.spec` | مفاتيح API عبر `npm run secrets` | `npm run doctor` |
| Model Router | Partial | `core/model-router.ts`, `core/provider-router.ts`, `core/failover-router.ts`, `models/registry.ts` | `model-router.spec`, `cloud-budget-routing.spec` | لا قياس جودة تلقائي للنماذج | — |
| أداة الملفات | Verified | `tools/fabric.ts` | `tool-fabric.spec`, **`tool-sandbox-escape.spec` (جديد)** | TOCTOU متبقٍ (موثّق) | — |
| أداة الطرفية | Verified | `tools/fabric.ts` (`createTerminalToolAdapter`) | `tool-fabric.spec` | قائمة سماح ضيقة جدًا بالتصميم؛ لا PowerShell عام | — |
| Git | Partial | `tools/git.ts`, `tools/builtin.ts` | `git-branch-manager.spec`, `git-commit-generator.spec` وغيرها | `git.push` مستوى L4 يحتاج موافقة | صفحة Git |
| قراءة الويب `browser.read` / `http.read` | Verified | `tools/fabric.ts`, `tools/http-read.ts`, **`security/network-guard.ts`** | `http-read-tool.spec`, **`tool-sandbox-escape.spec`** | DNS rebinding متبقٍ (موثّق) | — |
| متصفح تفاعلي Playwright | Partial | `autonomy/browser-test.ts` | `autonomy-browser.spec` | `playwright-core` اختياري؛ لاختبار الواجهات فقط | — |
| التحكم بسطح مكتب Windows | HW | `tools/desktop-control.ts` | CI job `windows` | Windows فقط | — |
| Coding Mission / Safe Code Modifier | Partial | `core/safe-code-modifier.ts`, `core/code-review-agent.ts` | `safe-code-modifier.spec` | — | — |
| الإصلاح الذاتي | Partial | `autonomy/supervisor.ts`, `autonomy/*` | `autonomous-repair.spec` | حدود محاولات موجودة | — |
| Verification Engine | Partial | `core/verification.ts` | `verification-hardening.spec`, `verification-integration-hardening.spec` | — | — |
| Skills Runtime | Verified (تثبيت محلي) | `src/skills/*` (`installer.ts`, `scanner.ts`, `registry.ts`) | `skills-runtime.spec`, `skill-learning.spec`, `skill-installer.spec` | تثبيت من مجلد محلي فقط؛ فحص نصي بالأنماط؛ لا واجهة رسومية | `npm run skills -- inspect <folder>` |
| MCP Gateway | Partial | `src/mcp/*` | `mcp-client.spec`, `mcp-gateway.spec` | خوادم المستخدم مسؤوليته | صفحة Integrations |
| الذاكرة النصية | Verified | `src/memory/*` | `memory*.spec`, `memory-arabic-hybrid.spec` | — | — |
| الذاكرة الدلالية | HW | `memory/embedder.ts`, `vector-store.ts` | `semantic-memory.spec` | نموذج تضمين (`nomic-embed-text`) | — |
| فرق الوكلاء | Partial | `core/team-runtime.ts` | `team-runtime.spec`, `agent-team-runtime.spec` | لا قفل ملفات بين الوكلاء | صفحة Team |
| المجدول | Verified | `core/scheduler.ts` | `scheduler-*.spec`, **`scheduler-calendar-retry.spec` (جديد)** | لا يعمل والتطبيق مغلق؛ `autostart.ps1 -Enable` يشغّل LayanX عند تسجيل الدخول | صفحة Schedules + `GET /v1/scheduler/runs` |
| System Doctor | Verified | **`src/system-doctor.ts`**, `doctor.ts` | **`system-doctor.spec` (جديد)**, `provider-doctor.spec` | — | `npm run doctor` |
| الصوت | API / HW | `src/voice/*` | `voice-listen.spec`, `voice-local-tts.spec` وغيرها | OpenAI audio أو Whisper/Piper محلي | صفحة Voice |
| إنتاج الفيديو (تجميع FFmpeg) | Partial | `creator/engine.ts` | `creator-engine.spec` | FFmpeg مثبت | — |
| توليد الصور لمشاهد الفيديو | Partial | `creator/engine.ts` (أمر محلي، ComfyUI، OpenAI Images) | `creator-openai-images.spec` (نقل وهمي + PNG حقيقي + تصيير FFmpeg فعلي إلى MP4)؛ ComfyUI بدون اختبار | OpenAI: API (مدفوع، يحتاج `OPENAI_API_KEY` و`LAYANX_CREATOR_IMAGE_PROVIDER=openai`)؛ ComfyUI: نموذج محلي؛ لا توليد فيديو بنموذج (التصيير FFmpeg من صور) | `creator.generate_assets` ثم `creator.render` |
| التجارة الإلكترونية | API | `src/business/*`, `platforms/*` | `business-manager.spec`, `business-postgres-fallback.spec` | مفاتيح WooCommerce/Shopify؛ النشر بموافقة | صفحة Ecommerce |
| البريد و Google | API | `connectors/google-workspace.ts`, `connectors/yahoo-mail.ts` | `google-workspace.spec`, `yahoo-mail.spec` | OAuth / IMAP | صفحة Integrations |
| التواصل الاجتماعي | API | `business/native-social.ts` (Facebook/Instagram Graph، TikTok، YouTube، X، Pinterest، LinkedIn) + موصل عام | `native-social.spec`, `pinterest-native.spec`, `social-connector.spec`, `social-publication-recovery.spec` | حسابات ومراجعة تطبيق لكل منصة؛ النشر بموافقة؛ لم يُختبر مقابل المنصات الحقيقية | — |
| الشحن واللوجستيات | None | — | — | — | — |
| التداول (تحليل/Backtest/Paper) | Verified | `src/trading/*` | `trading-evaluation.spec`, `historical-backtest.spec` وغيرها | — | صفحة Trading |
| التداول الحقيقي Binance/MT5 | API (مغلق افتراضيًا) | `trading/agent-integration.ts` | `trading-agent-integration.spec`, `trading-runtime-approval.spec`, `mt5-live-execution.spec` | `BINANCE_LIVE_TRADING_ENABLED=true` + L4 + حد قيمة | — |
| Control Center | Partial | `web/*`, `src/control-center.ts` | `control-center.spec`, `control-center-ui.spec`, CI `windows` smoke؛ صفحتا التشخيص والجدولة فُحصتا بمتصفح حقيقي (Playwright) | داكن فقط؛ صفحات مفقودة: الذاكرة، المهارات، مركز الأمن، الوسائط، البريد، الشحن؛ نصوص الفحوص بالإنجليزية | `LayanX.cmd` ثم صفحة التشخيص |
| تشغيل Windows (`LayanX.cmd`) | Partial | `LayanX.cmd`, `scripts/windows/*` | `bootstrap.spec`, CI windows, `uninstall-test.ps1` (CI windows) | لا مثبّت MSIX/WiX موقّع؛ إلغاء التثبيت والتشغيل التلقائي متوفران (سكربتات) | انقر `LayanX.cmd`؛ `LayanX-Uninstall.cmd` |
