# المهارات (Skills) — الوضع الفعلي

## البنية الحالية

- `src/skills/registry.ts` — `SkillManifest`: `id, name, version, description, source, license, permissions, tools, networkHosts, checksum, status`.
- دورة الحالة: `discovered → quarantined → testing → approved → enabled | disabled | rejected`. أي مهارة جديدة تُسجّل في الحجر `quarantined` حتى لو طُلب تفعيلها، ولا تُفعَّل قبل `approve`.
- `src/skills/scanner.ts` — فحص المانيفست: غياب checksum (حرج)، ترخيص مجهول (متوسط)، طلب صلاحية `L5_CRITICAL` (عالٍ)، شبكة مفتوحة `*` (عالٍ). المهارة غير آمنة عند وجود نتيجة عالية/حرجة.
- `src/skills/learning.ts` — يقترح مهارة من مهمة ناجحة فقط، ويحفظها معلّقة في `LAYANX_SKILL_LEARNING_DIR` (افتراضيًا `.layanx/skills/pending`) حتى يراجعها المستخدم.
- `src/skills/runtime.ts`, `pipeline.ts`, `tools.ts` — تشغيل المهارة عبر Agent Gateway نفسه، أي بالصلاحيات والموافقات والتدقيق ذاتها.

الاختبارات: `skills-runtime.spec`, `skill-learning.spec`.

## حدود معروفة (لا تُعتبر مكتملة)

- السجل في الذاكرة فقط؛ لا يُحفظ بين التشغيلات (عدا المهارات المتعلّمة المعلّقة).
- الفاحص يتحقق من **وجود** checksum وليس من مطابقته لمحتوى المهارة.
- لا يوجد تثبيت/تحديث/حذف من مجلد أو مصدر خارجي، ولا مقارنة إصدارات، ولا كشف تكرار.

هذه البنود هي البند 1 في `ROADMAP.md`.

## قاعدة

المهارة المضافة غير موثوقة تلقائيًا. محتواها بيانات وليست تعليمات تتجاوز سياسات النظام، ولا تستطيع توسيع صلاحياتها بنفسها.
