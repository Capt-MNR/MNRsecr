# خطة ترحيل المعمارية وتجربة المنتج إلى Agent Work

**الحالة:** خطة ترحيل قابلة للتنفيذ، وليست تنفيذًا للكود  
**التاريخ:** 21 سبتمبر 2026  
**المرجع:** `docs/agent-mvp-20-audit.md`  
**النطاق:** API Server، قاعدة البيانات، Web Main/Quick، وتطبيق Expo Mobile

## 1. الهدف والقرار

الهدف هو نقل السكرتير تدريجيًا من نموذج:

> رسالة تفاعلية قصيرة → قرار → أداة أو موافقة → نتيجة

إلى نموذج:

> Work دائم → Runs قابلة للتتبع → Evidence → Verification → Event أو Approval → Activity/Notification

من دون إعادة بناء الأنظمة التي تعمل حاليًا.

### القرار المنتجِي

أول Agent Work يجب أن يكون **مراقبًا read-only لمصدر API واحد آمن**:

> «تابع قيمة محددة، وإذا تغيرت أو وصلت إلى شرط واضح، نبّهني.»

هذا يثبت الاستمرارية والمراقبة والتحقق والإشعار دون إدخال browser automation أو Computer Use أو multi-agent أو أفعال خارجية غير قابلة للعكس.

### الثوابت التي لا تتغير أثناء الترحيل

1. Structured Records هي المصدر الرسمي للمال والكيانات والعلاقات.
2. Second Brain سياق شخصي محكوم، وليس permission أو سجلًا ماليًا.
3. `conversationId` يصف سياق المحادثة، ولا يصبح هوية العمل الدائم.
4. كل فعل حساس يمر عبر `executeStructuredTool` ومسار الموافقة والتنفيذ الحالي.
5. كل قراءة وكتابة تبقى tenant/user scoped.
6. النتيجة غير المؤكدة لا تتحول إلى `completed` ولا إلى retry تلقائي.
7. Main مكان المراجعة والفهم والتحكم؛ Quick مكان الدخول والإشعار المختصر.
8. كل انتقال مهم يحتفظ بسبب ومالك وprovenance يمكن تدقيقه.

## 2. الحالة الحالية مقابل الحالة المستهدفة

| المجال | الموجود الآن | الحالة المستهدفة | طريقة الترحيل |
|---|---|---|---|
| الطلب | Turn قصير مرتبط بالمحادثة | Work مستقل يمكن تشغيله بعد انتهاء الطلب | إضافة Work reference دون تغيير عقد turn الحالي |
| التنفيذ | Tool rounds وpending approval | Run/Attempt بحدود وlease وdeadline | إعادة استخدام الأدوات داخل Run adapter |
| الذاكرة | summary وحالة محادثة قصيرة | Work state مستقل مع سياق محادثة اختياري | عدم تخزين lifecycle في conversation memory |
| البيانات | سجلات رسمية وactivity events | Evidence وverification مرتبطان بالـ Work/Run | إضافة provenance تدريجيًا، مع إبقاء السجلات القديمة |
| الموافقة | `secretary_operations` لفعل واحد | Approval bridge من Work/Run إلى نفس العملية | ربط operation بالعمل دون تحويلها إلى Work store |
| الإشعار | push للموافقة | lifecycle event وpush deduped | توسيع الحدث بعد ثبات read-only monitor |
| Web | Chat وRecords وActivity | Work list وWork Detail داخل Main | إضافة IA تدريجيًا دون تغيير Quick |
| Mobile | Quick ثم Main وdeep links | Push مختصر → Main Work Detail | إعادة استخدام push/deep-link boundary |
| الفشل | provider/API errors وapproval states | failed/uncertain/needs_review مع recovery | تعريف states قبل إضافة scheduler |
| التشغيل | request workflows | trigger وmanual run ثم scheduler محدود | لا scheduler عام قبل اختبار lifecycle |

## 3. النموذج المعماري المستهدف

### 3.1 الحدود والمسؤوليات

```text
Main / Quick / Mobile Push
          │
          ▼
Conversation or Work Command Boundary
          │
          ├── Existing Secretary Turn
          │       └── deterministic → Brain/Provider → scoped tools
          │
          └── Agent Work Orchestrator
                  ├── Work definition
                  ├── Trigger / schedule
                  ├── Run lease
                  ├── Source adapter
                  ├── Evidence snapshot
                  ├── Deterministic verification
                  ├── Activity event
                  ├── Notification event
                  └── Approval bridge when action is required
```

### 3.2 الكيانات المنطقية

هذه كيانات تصميمية للترحيل، وليست دعوة لإنشاء جداول قبل اعتماد المرحلة المناسبة.

#### Work

يمثل نية المستخدم الدائمة:

- `workId`
- `tenantId`
- `ownerUserId`
- `kind` و`version`
- تعريف الهدف والمصدر والشرط
- permission policy
- `status`
- `sourceConversationId`
- `sourceTurnId`
- `sourceInputId` عند وجود ملف/صوت/صورة
- created/updated/paused/completed timestamps

الحالات المقترحة:

```text
draft → active → paused → active
                 ├→ needs_review
                 ├→ completed
                 ├→ failed
                 └→ cancelled
```

لا يسمح بالانتقال من `uncertain` إلى `completed` دون verification أو مراجعة صريحة.

#### Run

يمثل دورة فحص واحدة:

- `runId`
- `workId`
- trigger reason: scheduled/manual/retry/recovery
- attempt number
- started/finished/deadline
- lease owner وlease expiry
- source snapshot reference/hash
- result reference
- verification state
- error classification

الحالات:

```text
queued → claimed → running → verifying → verified
                         ├→ unchanged
                         ├→ failed
                         ├→ uncertain
                         └→ needs_review
```

#### Evidence

يمثل الحد الأدنى اللازم لفهم النتيجة:

- مصدر الفحص وإصداره.
- وقت الفحص.
- الحقل أو الحقول المقروءة.
- canonical value أو snapshot hash.
- previous/current comparison.
- حدود البيانات التي تم حفظها.
- redaction/retention policy.

لا يُحفظ provider prompt أو response كاملًا كـ evidence افتراضيًا. يُحفظ فقط ما يلزم للتفسير والتدقيق.

#### Verification

يمثل قرارًا يمكن الدفاع عنه:

- `state`: `verified | unchanged | failed | uncertain | needs_review`
- check names
- expected/current values
- reason
- verifier version
- verifiedAt

الـ Brain envelope يظل وصفًا transient للقرار، بينما verification هو نتيجة domain قابلة للعرض والتدقيق.

#### Event وNotification

الـ event يصف تغيرًا في العمل:

- work activated
- run completed
- value changed
- verification uncertain
- work paused
- approval required
- notification failed

الـ notification هو محاولة إيصال event للمستخدم، وليس دليلًا على أن المستخدم رآه. يجب فصل:

```text
event created → notification queued/sent → delivery accepted/failed
```

#### Secretary Operation

تبقى `secretary_operations` مخصصة لفعل يحتاج approval أو execution claim. عند وجود Work:

```text
Work/Run detects action
        ↓
Secretary Operation references workId/runId
        ↓
existing claim → execute → verify → result
```

لا يتحول `secretary_operation_id` إلى بديل عن `work_id`، ولا ينفذ worker الفعل مباشرة.

## 4. قواعد source of truth وprovenance

| السؤال | المصدر الصحيح |
|---|---|
| ما قيمة المصروف أو السجل؟ | Structured Records |
| ماذا قال المستخدم في هذه المحادثة؟ | Conversation memory وconversation turns |
| ما التفضيل الشخصي المحكوم؟ | Second Brain بعد policy/review |
| لماذا اختير هذا الكيان؟ | Entity resolver result وcanonical entity ID |
| ما الذي فُحص خارجيًا؟ | Evidence |
| هل الشرط تحقق؟ | Verification |
| من أنشأ العمل ومن أي قناة؟ | Work provenance |
| هل الفعل المالي تم؟ | Secretary operation result + authoritative verification |
| هل وصل الإشعار؟ | Notification delivery state، لا activity event وحده |

السجلات القديمة التي لا تملك `workId` تبقى:

- `manual` إذا أنشأها المستخدم مباشرة.
- `conversation_originated` إذا نشأت من turn.
- `approval_originated` إذا نشأت من operation.

لا يتم اختلاق Work قديم لمجرد أن السجل يمكن ربطه زمنيًا بمحادثة.

## 5. خطة ترحيل البيانات

### المرحلة D0: contract قبل schema

قبل أي migration يجب اعتماد:

- state enums وtransition table.
- تعريف owner وactor.
- event vocabulary.
- idempotency key composition.
- evidence retention/redaction.
- verification contract.
- backward compatibility مع secretary operations الحالية.

مفتاح الفعل المقترح لا يعتمد على UUID جديد فقط:

```text
tenant + owner + work + run + attempt + action kind + action version
```

### المرحلة D1: Work lifecycle read-only

تضاف فقط البيانات اللازمة لـ:

- إنشاء Work.
- pause/resume/cancel.
- provenance.
- manual run.
- عرض آخر حالة.

لا يوجد trigger خارجي ولا mutation. يمكن تشغيل run من harness اختبار أو إجراء داخلي مضبوط.

### المرحلة D2: Run/Evidence

تضاف بيانات:

- claim/lease.
- attempt.
- source snapshot/hash.
- comparison result.
- verification state.
- failure classification.

يجب أن تكون كل query/write مقيدة بـ tenant/user، وأن يكون لكل run unique guard يمنع double claim.

### المرحلة D3: Event/Notification

يضاف:

- activity event مرتبط بـ work/run/evidence.
- notification dedupe key.
- delivery state.
- deep-link payload آمن.

إذا فشل push بعد نجاح verification، يظل event قابلًا للمراجعة وإعادة الإرسال؛ لا يعاد تشغيل source mutation لأنه لا توجد mutation في هذا الـ MVP.

### المرحلة D4: Approval bridge

إذا أضيف فعل اختياري لاحقًا:

- يكتب Work/Run طلب approval.
- يعرض `display` وactual args من operation.
- يستخدم `claimOperation`.
- ينفذ عبر `executeApprovedOperation` أو مسار expense الحالي.
- يتحقق من النتيجة authoritative.
- يربط النتيجة بـ work/run/activity.

### التوافق والـ rollback

- feature flag مستقل لكل مرحلة.
- لا dual-write بين مصدرين غير واضحين.
- shadow read أو comparison مسموح فقط إذا لم يغير السجل.
- إيقاف rollout يوقف trigger الجديد ويترك Work/Evidence/Activity للقراءة.
- لا تحذف records أو conversation turns أو secretary operations عند rollback.

## 6. خريطة التعايش مع الأنظمة الحالية

### ما يبقى كما هو

- `phase2.ts`: deterministic paths، tool scopes، provider routing، failover، limits.
- `second-brain.ts`: policy، retrieval trace، candidates، provenance، aliases.
- `conversation-memory.ts`: سياق المحادثة، لا lifecycle دائم.
- `entity-resolver.ts`: canonical IDs وambiguity.
- `secretary-operations.ts`: approval claim/complete/fail/reject.
- `mobile-push.ts`: server-owned delivery boundary.
- Structured Records وactivity history.

### ما يتسع بحدود

- `secretary_operations`: ربط اختياري بـ Work/Run فقط.
- activity events: source/actor/metadata لتشمل Work/Run/verification.
- push: event type وdeep link وdedupe.
- Main: Work list/detail.
- Mobile Main: Work detail بعد فتح الإشعار.

### ما لا نضيفه في هذا الترحيل

- قناة كتابة موازية.
- Second Brain permission layer.
- browser session manager.
- general-purpose multi-agent router.
- workflow learning.
- provider strategy جديدة.

## 7. Product UX migration plan

## 7.1 mental model المستخدم

يجب أن يرى المستخدم Agent Work كالتالي:

> «أنا طلبت من السكرتير أن يتابع شيئًا وفق شرط واضح، وسيريني ما فحصه وما الذي حدث.»

وليس:

> «هناك روبوت يتصرف بحرية نيابة عني.»

لغة المنتج يجب أن تميز بين:

- **يتابع:** work active.
- **فحص:** run executed.
- **لاحظ تغيرًا:** source comparison changed.
- **تحقق:** verification passed.
- **يحتاج مراجعة:** outcome uncertain أو permission غير مكتملة.
- **ينتظر موافقتك:** secretary operation pending.

## 7.2 IA في Web Main

المرحلة الأولى لا تعيد بناء الصفحة. تضيف Agent Work كقسم داخل Main، مع نقاط دخول من:

- chat result.
- activity event.
- push deep link.
- drawer/bottom navigation عند اتساع الاستخدام.

### Work list

كل بطاقة تعرض:

- اسمًا يصف الهدف، لا اسمًا تقنيًا.
- الحالة الحالية.
- آخر فحص.
- آخر تغير أو «لم يتغير».
- next check إن وجد.
- سبب احتياج المستخدم: approval/review/failure.

الحالات البصرية:

| الحالة | معنى المستخدم | الإجراء الأساسي |
|---|---|---|
| Active | المتابعة مستمرة | افتح التفاصيل / أوقف |
| Paused | لن يحدث فحص جديد | استأنف |
| Needs review | لا يمكن إعلان نتيجة آمنة | راجع السبب |
| Failed | فشل تشغيل يمكن تفسيره | اعرض السبب / أعد يدويًا |
| Unchanged | تم الفحص بلا تغير | لا يوجد إجراء مطلوب |
| Changed | تحقق الشرط | افتح الدليل |
| Waiting approval | يوجد فعل ينتظر قرارك | راجع ووافق/ارفض |
| Cancelled | لن يتابع | عرض الأثر فقط |

### Work Detail

ترتيب الشاشة:

1. **العنوان والنتيجة الحالية:** ماذا يتابع العمل؟ وما حالته؟
2. **الشرط:** القيمة/التغيير المطلوب بلغة المستخدم.
3. **آخر فحص:** وقت الفحص، مصدره، والنتيجة.
4. **الدليل:** previous/current، timestamp، hash أو reference، وما لم يتم فحصه.
5. **محاولات التشغيل:** failed/uncertain/verified مع سبب مختصر.
6. **الإجراء:** pause/resume/cancel، run now إن كان آمنًا، review/approve عند الحاجة.
7. **المصدر:** المحادثة الأصلية وturn provenance.

لا تعرض الشاشة provider prompts أو reasoning داخلي. تعرض checks وevidence وreason codes مفهومة.

## 7.3 إنشاء Work

أفضل تجربة أولية هي form/confirmation واضح، ويمكن أن يبدأ من chat:

1. المستخدم يصف المطلوب.
2. السكرتير يعرض:
   - المصدر.
   - الحقل المقروء.
   - الشرط.
   - التكرار.
   - ما الذي سيحدث عند التغير.
3. المستخدم يؤكد التفعيل.
4. ينشأ Work read-only.

إذا كان المصدر أو الحقل أو الشرط ambiguous:

- لا ينشأ work ناقص.
- تظهر clarification في Main.
- لا يستخدم Second Brain لملء permission أو target من تلقاء نفسه.

## 7.4 Quick والـ push

Quick لا يصبح لوحة تشغيل مصغرة. دوره:

- استقبال summary.
- إظهار status سريع.
- فتح Main detail.
- عرض approval البسيط إذا كان مدعومًا ومفهومًا.

مثال إشعار:

> «السكرتير لاحظ تغيرًا في المتابعة التي طلبتها. افتح التفاصيل لمراجعة القيمة والدليل.»

لا يقول الإشعار «تم التنفيذ» إذا حدث فحص فقط. ولا يعرض قرارًا ماليًا أو mutation في body دون context.

## 7.5 Mobile Main

ينفذ mobile نفس mental model دون نسخة lifecycle منفصلة:

- Work list مختصرة.
- Work Detail قابلة للتمرير.
- evidence sections قابلة للفتح.
- state banners واضحة.
- actions في أسفل الشاشة مع حماية من الضغط المزدوج.
- offline/stale state يوضح أن البيانات ليست محدثة.

عند فتح deep link لعمل محذوف أو cancelled:

- يعرض التطبيق آخر حالة متاحة إن كانت مصرحًا بها.
- يوضح أن الإجراء لم يعد متاحًا.
- لا يحاول إعادة تشغيل أو إنشاء work بديل.

## 7.6 الوصول واللغة

- لا تعتمد الحالة على اللون وحده.
- كل state له نص وأيقونة وlabel.
- الأرقام والأوقات تعرض حسب timezone المستخدم مع مصدر وقت واضح.
- العربية هي المسار الأول، مع عدم خلط `verified` و`uncertain` في ترجمة واحدة.
- loading/offline/empty/error states لها نصوص صريحة.
- keyboard navigation في Web.
- touch targets مناسبة للموبايل.
- لا تختفي تفاصيل الخطأ خلف toast فقط؛ تحفظ في Work Detail.

## 8. مراحل rollout المرتبطة بالمنتج

| المرحلة | backend | UX | القياس | بوابة التوسع | rollback |
|---|---|---|---|---|---|
| A | Work read-only + manual run | Work list/detail أساسية | creation success، isolation، state transitions | لا Work orphaned ولا state invalid | إخفاء entry وترك القراءة |
| B | API source + lease + deterministic compare | last check/evidence | duplicate run، timeout، unchanged/changed accuracy | double-run = صفر في fixture | إيقاف trigger |
| C | activity + verified event + push | Quick summary → Main | event-to-work trace، push delivery/dedupe | كل event قابل للتتبع | إيقاف push فقط |
| D | approval bridge | approval/review states | duplicate approval، actual args، verification | لا mutation بلا approval | تعطيل action bridge |
| E | hardening + source expansion | تحسينات بعد القياس | latency، cost، uncertain rate، retention | لا توسعة قبل baseline | revert feature flag |

### قواعد التعايش

- Chat الحالي يعمل بنفس السلوك خارج Work.
- Quick لا يغير صلاحياته بسبب وجود Work.
- Work لا يقرأ كل conversation memory تلقائيًا.
- activity event يوضح مصدره: user/secretary/agent-work.
- provider failures لا تنشئ نجاحًا اصطناعيًا.
- إيقاف feature flag لا يمس السجلات القائمة.

## 9. القياس والمراقبة

### معايير السلامة

- zero cross-tenant reads/writes.
- zero duplicate active runs في اختبار التزامن.
- zero mutation من read-only MVP.
- zero automatic mutation retry بعد uncertain.
- كل Work/Run له owner وprovenance.

### معايير reliability

- run completion rate.
- unchanged/changed/uncertain/failed distribution.
- lease contention.
- provider/API latency.
- retry count وdeadline exhaustion.
- notification delivery accepted/failed.
- reconciliation backlog.

### معايير UX

- نسبة إنشاء Work من أول محاولة.
- نسبة clarification قبل activation.
- زمن الوصول من push إلى Work Detail.
- نسبة المستخدمين الذين يفهمون سبب `needs_review` في اختبار usability.
- نسبة pause/resume/cancel الناجحة.
- عدد مرات رجوع المستخدم إلى chat بسبب غموض Work Detail.

### معايير التكلفة

- source requests لكل Work.
- provider calls لكل run إذا دخل provider.
- payload/evidence bytes.
- notifications لكل verified transition.
- retention footprint.

لا تُفعل تحسينات context budget أو provider routing إضافية كجزء من الترحيل قبل ظهور baseline لهذه القياسات.

## 10. Backlog التنفيذ والاعتماديات

الترتيب المقترح بعد اعتماد الخطة:

1. **Work lifecycle contract**
   - states، transitions، owner، provenance، cancellation.
2. **Run lease وidempotency**
   - claim، attempts، deadline، no double run.
3. **API source safety**
   - allowlist، SSRF guard، redirect policy، timeout، body limit.
4. **Evidence وdeterministic verification**
   - snapshot/hash، compare، uncertain state.
5. **Activity/event vocabulary**
   - work/run/verification attribution.
6. **Push event وdedupe**
   - delivery state وdeep link.
7. **Web Work list وWork Detail**
   - Main-first، no Quick expansion غير ضروري.
8. **Mobile Work Detail**
   - deep link، offline/stale/error، approval boundary.
9. **Approval bridge**
   - only after read-only lifecycle is stable.
10. **Race/security/e2e validation**
   - tenant isolation، concurrency، SSRF، uncertain، push reconciliation.

المهام التنفيذية المقترحة سابقًا تغطي أجزاء من هذا backlog:

- Task #76: lifecycle وpause/resume ومنع duplicate runs.
- Task #77: Main وevidence وmobile entry.
- Task #78: اختبارات التزامن ومصادر API الآمنة.

يجب ألا تبدأ مهام later stages قبل اجتياز بوابة المرحلة السابقة، حتى لا تُبنى UX فوق state contract غير مستقر.

## 11. المخاطر والقرارات غير القابلة للتفاوض

| الخطر | القرار |
|---|---|
| worker يستخدم هوية عامة أو هوية آخر request | كل Run يحمل identity صريحة ويُرفض بدون owner scope |
| Work يصبح نسخة ثانية من conversation | Work lifecycle مستقل، والمحادثة reference فقط |
| secretary operation يتحول إلى scheduler | operation للفعل/الموافقة، Work للمتابعة |
| source response مفقود بعد timeout | `uncertain` وmanual reconciliation، لا retry mutation |
| مصدر API يتيح SSRF | MVP يبدأ allowlisted/configured source، لا arbitrary URL |
| Second Brain يحدد هدفًا حساسًا | يستخدم للسياق فقط؛ target يحتاج canonical record أو confirmation |
| push يفشل | event يبقى قابلًا للقراءة وإعادة الإرسال، ولا يعاد الفحص تلقائيًا بلا policy |
| Quick يعرض تفاصيل لا تكفي لاتخاذ قرار | التفاصيل في Main، وQuick ينقل المستخدم بوضوح |
| rollback يحذف أثر المستخدم | rollback يوقف الجديد ولا يحذف evidence/activity/operations |
| توسعة مبكرة إلى browser/learning | تؤجل حتى تثبت lifecycle وverification والـ safety baseline |

## 12. تعريف الانتهاء

الخطة جاهزة للتنفيذ عندما يستطيع الفريق الإجابة كتابةً عن الأسئلة التالية:

1. ما الفرق بين conversation وwork وrun وoperation؟
2. من يملك كل كيان؟ وكيف يُطبق tenant/user isolation؟
3. ما كل state transition المسموح؟ وما الذي يمنع completion؟
4. ما الدليل الذي يعرضه المنتج للمستخدم؟
5. ماذا يحدث عند timeout أو provider failure أو push failure؟
6. كيف نمنع تشغيلين متوازيين؟
7. كيف نوقف rollout دون فقدان الأثر؟
8. ما الذي يظهر في Main وما الذي يظهر في Quick؟
9. كيف يعود approval إلى نفس executor الحالي؟
10. ما بوابة القياس قبل إضافة مصدر أو فعل جديد؟

إذا لم تكن الإجابة محددة، تبقى المرحلة في التخطيط ولا تُضاف إلى production.

## 13. Portability / Adapter Architecture

طبقة Agent Work لا تعتمد على Replit أو Expo أو مزود إشعارات بعينه. هذا شرط معماري من
المرحلة الأولى لأن Work سيحتاج لاحقًا إلى Workers وProviders وقنوات Notification متعددة.

### Ports

يجب أن تكون الواجهات في `artifacts/api-server/src/lib/agent-work/types.ts`:

- `SchedulerAdapter`: جدولة وإلغاء trigger فقط، بلا قرار domain أو retry داخله.
- `IdentityAdapter`: تحويل سياق الطلب أو التشغيل الخلفي إلى owner صريح؛ يرفض الهوية
  الناقصة ولا يخترع user أو tenant.
- `NotificationAdapter`: تسليم event بعد dedupe، ولا يعتبر `accepted` دليلًا على أن
  المستخدم رأى الإشعار.
- `StorageAdapter`: stub في المرحلة الحالية؛ لا يحفظ source/provider payload قبل اعتماد
  retention وredaction.

### Implementations وdependency injection

- كل implementation في ملف مستقل عن `types.ts`.
- `factory.ts` هي نقطة الـdefault wiring الوحيدة.
- يمكن تمرير adapters بديلة إلى runtime initialization والاختبارات.
- business logic لا يستورد Replit أو Expo أو مزود التنفيذ؛ implementation وحده يملك
  ذلك الاعتماد.
- لا يحتوي adapter على state transition أو approval أو financial mutation.

### Environment drivers

| المتغير | القيم الحالية | الوظيفة |
|---|---|---|
| `AGENT_WORK_ENABLED` | `true/false` | بوابة تشغيل Agent Work |
| `AGENT_WORK_SCHEDULER_DRIVER` | `development/stub` حاليًا، `replit` محجوز | اختيار scheduler |
| `AGENT_WORK_IDENTITY_DRIVER` | `development/stub` حاليًا، `replit` محجوز | اختيار مصدر الهوية |
| `AGENT_WORK_NOTIFICATION_DRIVER` | `development/expo` | اختيار قناة الإشعار |
| `AGENT_WORK_STORAGE_DRIVER` | `stub` | يظل stub حتى اعتماد retention/redaction |
| `AGENT_WORK_ALLOW_DEVELOPMENT_IDENTITY` | `true/false` | يسمح بهوية التطوير خارج production فقط |
| `PROVIDER_ROUTING_ORDER` | قائمة providers | ترتيب التوصية داخل provider router |
| `AI_PRIMARY_PROVIDER` | provider name | provider الأساسي الصريح |
| `AI_FALLBACK_PROVIDER` | provider name | fallback الأول |
| `AI_SECONDARY_FALLBACK_PROVIDER` | provider name | fallback الثاني |
| `DEEPSEEK_API_KEY` | secret | تفعيل DeepSeek داخل ModelGateway |
| `DEEPSEEK_MODEL` | `deepseek-chat` افتراضيًا | اسم موديل DeepSeek |
| `DEEPSEEK_API_URL` | DeepSeek chat completions URL | endpoint القابل للتبديل في الاختبارات |

لا تُقرأ مفاتيح المزود أو متغيرات Replit داخل Agent Work business logic، ولا يُسمح
بتفعيل driver إنتاجي غير موصول بعقد identity وlease وnotification delivery.