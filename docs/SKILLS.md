# المهارات (Skills) — الوضع الفعلي

## البنية الحالية

- `src/skills/registry.ts` — `SkillManifest`: `id, name, version, description, source, license, permissions, tools, networkHosts, checksum, status`.
- دورة الحالة: `discovered → quarantined → testing → approved → enabled | disabled | rejected`. أي مهارة جديدة تُسجّل في الحجر `quarantined` حتى لو طُلب تفعيلها، ولا تُفعَّل قبل `approve`.
- `src/skills/scanner.ts` — فحص المانيفست: غياب checksum (حرج)، ترخيص مجهول (متوسط)، طلب صلاحية `L5_CRITICAL` (عالٍ)، شبكة مفتوحة `*` (عالٍ). المهارة غير آمنة عند وجود نتيجة عالية/حرجة.
- `src/skills/learning.ts` — يقترح مهارة من مهمة ناجحة فقط، ويحفظها معلّقة في `LAYANX_SKILL_LEARNING_DIR` (افتراضيًا `.layanx/skills/pending`) حتى يراجعها المستخدم.
- `src/skills/runtime.ts`, `pipeline.ts`, `tools.ts` — تشغيل المهارة عبر Agent Gateway نفسه، أي بالصلاحيات والموافقات والتدقيق ذاتها.

الاختبارات: `skills-runtime.spec`, `skill-learning.spec`.

## تثبيت حزم المهارات (جديد)

الحزمة مجلد يحتوي `skill.json` و`SKILL.md` (حتى 256 KiB). الحقل `checksum` هو SHA-256 لمحتوى `SKILL.md` (`sha256:<hex>`).

```json
{"id":"seo-helper","name":"SEO helper","version":"1.0.0","description":"Arabic product SEO titles",
 "source":"local","license":"MIT","permissions":["L1_READ","L2_ANALYZE"],"tools":["files.read"],
 "networkHosts":[],"checksum":"sha256:<hex>"}
```

```powershell
# حساب الـ checksum في PowerShell
(Get-FileHash .\my-skill\SKILL.md -Algorithm SHA256).Hash.ToLower()

npm run skills -- inspect .\my-skill     # فحص دون تثبيت: الصلاحيات والنتائج
npm run skills -- install .\my-skill     # يُنسخ إلى المخزن بحالة quarantined
npm run skills -- approve seo-helper
npm run skills -- enable seo-helper
npm run skills -- list | verify | disable <id> | uninstall <id>
```

ما يحدث عند التثبيت (`src/skills/installer.ts`):

1. التحقق من المانيفست: `id` آمن، إصدار SemVer، صلاحيات معروفة، checksum بصيغة SHA-256.
2. رفض الروابط الرمزية والملفات الكبيرة.
3. مطابقة الـ checksum للمحتوى الفعلي (`CHECKSUM_MISMATCH`).
4. فحص النص: حقن تعليمات، تسريب أسرار، أوامر مدمرة، تنفيذ كود عن بعد/مشفّر (`iex`, `-EncodedCommand`, `curl | sh`)، تعطيل Defender أو حذف النسخ الاحتياطية.
5. كشف المحتوى المكرر تحت معرّف آخر.
6. التحديث يتطلب إصدارًا أعلى ويعيد المهارة إلى الحجر لمراجعة جديدة؛ إعادة تثبيت الحزمة نفسها لا تفعل شيئًا.
7. عند كل تشغيل يُعاد حساب الـ checksum لكل مهارة مخزنة؛ أي تعديل لاحق على القرص يجعلها `rejected` ولا يمكن تفعيلها.

المخزن: `LAYANX_SKILLS_DIR` أو `%LOCALAPPDATA%\LayanX\skills`. الاختبار: `tests/skill-installer.spec.ts`.

## حدود متبقية

- لا تنزيل من مصادر إنترنت/سوق مهارات؛ التثبيت من مجلد محلي فقط (مقصود حتى يُضاف التحقق من التوقيع).
- لا واجهة رسومية للتثبيت بعد؛ الإدارة عبر CLI، وصفحة الواجهة ضمن `ROADMAP.md`.
- الفحص النصي قائم على أنماط؛ لا يغني عن مراجعة المستخدم قبل `approve`.

## قاعدة

المهارة المضافة غير موثوقة تلقائيًا. محتواها بيانات وليست تعليمات تتجاوز سياسات النظام، ولا تستطيع توسيع صلاحياتها بنفسها.
