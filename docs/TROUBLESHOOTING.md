# حل المشكلات — LayanX-AI على Windows 11

ابدأ دائمًا بـ:

```powershell
npm run doctor
npm run doctor -- --out doctor.json   # تقرير منقّح من الأسرار يمكن مشاركته
```

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| `[FAIL] node` | Node أقدم من 22 | ثبّت Node.js 22 LTS ثم `npm ci` |
| `[FAIL] provider-ollama: not running` | Ollama غير مشغّل | شغّل تطبيق Ollama، ثم `ollama list` |
| `[FAIL] provider-ollama: model is not installed` | النموذج غير مثبت | `ollama pull <model>` أو غيّر `OLLAMA_MODEL` |
| `did not answer in time` | Ollama يحمّل نموذجًا كبيرًا | انتظر ثم أعد الفحص؛ أو أعد تشغيل Ollama |
| `[WARN] model-...: split between GPU and CPU` | النموذج أكبر من VRAM | استخدم نسخة أصغر أو تكميمًا أعلى (Q4) |
| `[WARN] port-3000` | LayanX يعمل مسبقًا أو تطبيق آخر يستخدم المنفذ | افتح `http://127.0.0.1:3000` أو غيّر `LAYANX_API_PORT` |
| `[FAIL] data-dir` | لا صلاحية كتابة | عيّن `LAYANX_DATA_DIR` لمجلد تملكه |
| `[WARN] persistence` | التشغيل عبر `npm start` بلا تخزين | استخدم `LayanX.cmd` / `npm run local`، أو عيّن `LAYANX_RUNTIME_STORAGE_PATH` |
| `[WARN] tool-ffmpeg` | FFmpeg غير مثبت | `winget install --id Gyan.FFmpeg -e` |
| `[WARN] tool-git` | Git غير مثبت | `winget install --id Git.Git -e` |
| `Workspace path escapes the project sandbox through a link` | مسار يمر برابط رمزي/Junction يشير خارج المشروع | سلوك أمني مقصود؛ انسخ الملفات داخل المشروع أو اربط المشروع كاملًا (Linked Project) |
| `Host resolves to a private or local network address` | رابط يشير لشبكة داخلية | سلوك أمني مقصود لأدوات القراءة من الويب |
| جدول بحالة `interrupted` | أُغلق LayanX أثناء تشغيل المهمة | راجع المهمة؛ لا يُعاد تشغيلها تلقائيًا لتجنب تكرار آثارها |
| الجداول لا تعمل والجهاز مطفأ/التطبيق مغلق | المجدول داخل العملية فقط | أضف مهمة في Windows Task Scheduler تشغّل `LayanX.cmd` عند تسجيل الدخول |

## السجلات

- سجل التطبيق: `%LOCALAPPDATA%\LayanX\logs\`
- سجل التدقيق والمهام: داخل مخزن التشغيل في `%LOCALAPPDATA%\LayanX\store\`

## التراجع عن تحديث

```powershell
git log --oneline -5
git checkout <commit-السابق>
npm ci
```

بيانات المستخدم خارج مجلد Git (`%LOCALAPPDATA%\LayanX`) ولا تتأثر بالتراجع.
