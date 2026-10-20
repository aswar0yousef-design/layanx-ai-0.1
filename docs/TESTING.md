# استراتيجية الاختبار — LayanX-AI

## الأوامر الموجودة فعلًا

| الأمر | ماذا يفعل | يحتاج |
|---|---|---|
| `npm run security:check` | فحص ثابت للأسرار في المستودع | — |
| `npm run typecheck` | `tsc --noEmit` (strict) | — |
| `npm test` (= `npm run test:unit`) | يشغّل كل `tests/*.spec.ts` عبر `scripts/test-suite-runner.mjs` | Node 22 |
| `npm run build` | تجميع إلى `dist/` | — |
| `npm run free:check` | typecheck + test + build + bootstrap (ما يشغّله CI) | — |
| `npm run operational:acceptance` | قبول تشغيلي بدون مزود حقيقي | — |
| `npm run doctor` | فحص النظام الحقيقي (انظر `DOCTOR.md`) | — |
| `npm run smoke:ollama` | استدلال حقيقي على Ollama | Ollama + نموذج |
| `npm run e2e:ollama` | مسار هدف → مهمة → نتيجة مع Ollama حقيقي | Ollama + نموذج |
| `npm run production:preflight` / `production:acceptance` | بوابات الجاهزية للإنتاج | إعدادات الإنتاج |

### مجموعات فرعية (من `tests/suites.json`)

| الأمر | الملفات (2026-10-20) |
|---|---|
| `npm run test:integration` | 34 (API محلي حقيقي، تخزين، Postgres fallback، MCP، إعادة تشغيل) |
| `npm run test:e2e` | 2 (`e2e-goal-to-memory`، القبول) — تغطية e2e ما زالت قليلة |
| `npm run test:security` | 17 |
| `npm run test:recovery` | 24 |

المجموعة التي لا تطابق أي ملف تفشل بدل أن تنجح فارغة. `npm test` يشغّل كل الملفات دائمًا (وهو ما يشغّله CI).

## طبقات التغطية الحالية (أسماء ملفات حقيقية)

- **Unit**: معظم `tests/*.spec.ts` (المجدول، الموجّه، الذاكرة، الأدوات...).
- **Integration** (transport محقون أو خادم HTTP محلي حقيقي): `runtime-api.spec`, `recovery-http-integration.spec`, `scheduler-event-api-auth.spec`, `verification-integration-hardening.spec`.
- **Security / negative**: `red-team.spec`, `project-isolation-boundaries.spec`, `project-memory-isolation.spec`, `http-read-tool.spec`, `tool-sandbox-escape.spec`.
- **Recovery**: `recovery-*.spec`, `runtime-recovery.spec`, `handoff-crash-recovery.spec`, `approval-restart-recovery.spec`, `scheduler-calendar-retry.spec` (تشغيل منقطع).
- **Provider**: `provider-doctor.spec`, `cloud-provider-adapters.spec`, `system-doctor.spec` (دون اتصال)؛ والاتصال الحقيقي عبر `smoke:ollama`.
- **Windows**: وظيفة CI `quality (windows-latest)` ووظيفة `windows` (Windows smoke: مساعد سطح المكتب، UI Automation، أسرار DPAPI). ملاحظة: `windows-latest` هو Windows Server وليس Windows 11؛ اختبار Windows 11 يدوي (أدناه).

## قواعد

- لا تُحذف اختبارات فاشلة ولا تُعطّل الفحوص لإظهار نجاح.
- كل إصلاح أمني يرافقه اختبار يفشل على الكود القديم (مثال: `tool-sandbox-escape.spec` أثبت الهروب قبل الإصلاح).
- نجاح اختبارات الوحدة ليس دليلًا على عمل التطبيق كاملًا؛ اختبارات Ollama الحقيقية وفحص الواجهة يدوية حتى الآن.

## اختبار القبول اليدوي على Windows 11 (PowerShell)

```powershell
cd C:\path\to\Layanx-Ai
git pull
npm ci
npm run doctor                 # يجب أن يكون READY أو يشرح السبب
npm run security:check
npm run typecheck
npm test
npm run build
ollama pull llama3.2:3b        # أو النموذج الذي تختاره
npm run smoke:ollama           # استدلال حقيقي
.\LayanX.cmd                   # افتح لوحة التحكم وجرّب مهمة بسيطة
```

نتيجة آخر تشغيل كامل: انظر قسم "النتائج" في `AUDIT-2026-10-20.md` و`CHANGELOG.md`.
