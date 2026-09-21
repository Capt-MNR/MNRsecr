# تدقيق خارطة Agent MVP 2.0

**الحالة:** تدقيق مبني على الكود الحالي، وليس تصميمًا تنفيذيًا نهائيًا  
**تاريخ التدقيق:** 21 سبتمبر 2026  
**النطاق:** `api-server`، قاعدة بيانات السكرتير، واجهة الويب، وتطبيق Expo  
**قاعدة مهمة:** هذه الوثيقة لا تنفذ Agent Work أو Scheduler أو Queue أو Worker، ولا تغيّر كود المنتج أو مخطط قاعدة البيانات.

## 1. الخلاصة التنفيذية

المشروع يملك نواة Agent/Secretary حقيقية ومحدودة بالفعل:

- مسار واحد من واجهة Main/Quick إلى API ثم deterministic intelligence أو provider ثم tools ثم نتيجة موثقة.
- سجلات رسمية مملوكة للمستخدم، مع عزل `tenantId` و`ownerUserId` في قراءات وكتابات واسعة.
- Second Brain محكوم بالسياسة، وله provenance وretrieval trace وأولوية للسجل الرسمي.
- ذاكرة محادثة قصيرة مع summary وحالة منظمة للكيانات والإشارات المرجعية.
- entity resolution مع candidates وambiguity وaliases صريحة.
- موافقات للكتابات الحساسة مع claim/complete/fail/reject وidempotency وتحقق من مدخلات التعديل.
- failover للـ providers، حدود للـ tool calls والـ logical LLM calls، deadline، وstructured logging.
- إدخال صوتي/صوري يُحوّل إلى نتيجة مراجعة قبل إرساله كرسالة، مع تخزين نتيجة الإدخال لإعادة المحاولة.
- Main وQuick في الويب والموبايل، وإشعار push قائم للموافقة.

لكن هذا ليس Agent Work دائمًا بعد. الموجود هو **تنفيذ طلب تفاعلي قصير**، و**عملية موافقة معلقة لكتابة واحدة**. لا توجد حاليًا طبقة تحفظ عملًا طويلًا قابلًا للاستئناف، أو trigger دوري، أو lease/heartbeat، أو retry policy، أو سجل محاولات مستقل، أو monitor event عام.

### القرار المقترح

أصغر MVP آمن هو:

> **Agent Work يتابع تغيّرًا من مصدر API بسيط، بشرط deterministic، ثم يرسل حدثًا/إشعارًا للمستخدم؛ وإذا نتجت كتابة، تمر عبر المسار الحالي للموافقة والتنفيذ والتحقق.**

لا يبدأ MVP بالـ browser automation أو Computer Use أو A2A أو multi-agent أو learned workflows. هذه الإضافات ستخلط بين إثبات التفويض والمراقبة وبين بناء منصة تنفيذ عامة.

### ما لا ينبغي فعله

- لا يُعاد بناء Second Brain أو provider layer أو Brain envelope.
- لا تُنشأ قناة تنفيذ موازية تتجاوز `executeStructuredTool` أو `executeApprovedOperation`.
- لا يُسمح لـ Agent Work بكتابة مالية مباشرة دون المرور بحدود الموافقة الحالية.
- لا تُعلن نتيجة خارجية ناجحة بناءً على استجابة المصدر فقط؛ يجب وجود verification صريح.
- لا يُفعّل context budgeter أو decision cache أو routing optimization كافتراضات تصميمية قبل قياس التكلفة والدقة وإعادة المحاولة.

## 2. ما تم تدقيقه

تم تتبع الملفات والواجهات التالية:

- `artifacts/api-server/src/lib/phase2.ts`
- `artifacts/api-server/src/lib/second-brain.ts`
- `artifacts/api-server/src/lib/conversation-memory.ts`
- `artifacts/api-server/src/lib/secretary.ts`
- `artifacts/api-server/src/lib/entity-resolver.ts`
- `artifacts/api-server/src/lib/secretary-operations.ts`
- `artifacts/api-server/src/lib/provider-router.ts`
- `artifacts/api-server/src/lib/input-assets.ts`
- `artifacts/api-server/src/lib/mobile-push.ts`
- `artifacts/api-server/src/routes/secretary.ts`
- `lib/db/src/schema/personal-secretary.ts`
- `artifacts/personal-secretary/src/pages/home.tsx`
- `artifacts/personal-secretary-mobile/app/main.tsx`

هذه الوثيقة تميز بين:

1. **موجود ومثبت في الكود الحالي.**
2. **موجود لكنه مصمم لمسار تفاعلي، ويحتاج توسيعًا محدودًا.**
3. **غير موجود ويجب إضافته في مرحلة تنفيذ منفصلة.**

## 3. المعمارية الحالية ومسار الطلب

### 3.1 من الواجهة إلى API

الويب والموبايل يستخدمان خدمة محادثة السكرتير لإرسال turn يحتوي على الرسالة، وقد يحتوي على:

- `conversationId`
- `idempotencyKey`
- `channel`
- `context`
- `peer`
- `inputId`

الويب يحتفظ بالمحادثة ويعرض approval form ويعيد تحديث سجل المحادثات والسجلات. الموبايل يملك Main workspace وQuick entry، ويدعم فتح السجل في سياق المحادثة، الإدخال الصوتي/الإيصال، والموافقة من الواجهة.

المسارات الأساسية في `routes/secretary.ts` هي:

- `GET /today`
- `GET /approvals/:operationId`
- `POST /turns`
- `POST /input-assets/process`
- `POST /approvals/:operationId/approve`
- `POST /approvals/:operationId/reject`

مسار `POST /turns` يسجل `requestId`، ويستدعي resolver shadow عند تفعيله، ثم يمرر الطلب إلى `agentRuntime.run`. إذا نتجت موافقة، يجلب العملية، يضمّن بياناتها في الاستجابة، ويرسل mobile push للمستخدم.

> ملاحظة تدقيقية: دالة الهوية الظاهرة في مسار secretary تستخدم حاليًا `Bearer dev-user` وتستمد tenant/user من البيئة. قبل أي تشغيل إنتاجي لـ Agent Work يجب تثبيت حدود هوية الإنتاج والتأكد من أن worker لا يستخدم هوية عامة أو هوية آخر طلب.

### 3.2 بوابة deterministic وBrain

قبل provider، توجد مسارات deterministic لعدد من الحالات المعروفة، منها:

- تقارير المصروفات والفترات.
- إجماليات المصروفات وتصحيح الإجمالي عندما يكون السياق السابق مناسبًا.
- أسئلة الجدولة/التذكيرات المعروفة.
- الإلغاء الصريح.
- أوامر Second Brain الصريحة.
- بعض قراءات السجلات والعلاقات.

يُنشأ Brain decision envelope transient يصف intent/context/risk/strategy وحالة التحقق، لكنه ليس مصدرًا قانونيًا للبيانات. البيانات المالية والعلاقات الرسمية تُجلب من Structured Records، ويُستخدم Second Brain كطبقة سياق مساعد لا كبديل للسجل.

### 3.3 الذاكرة وسياق المحادثة

`conversation-memory.ts` يوفر:

- آخر ستة أدوار تقريبًا كسياق حديث.
- summary محدود الحجم بعد تراكم الأدوار.
- `ConversationState` للكيانات والمرشحين والعلاقات وآخر شخص/مشروع/مصروف.
- compacting لنتائج الأدوات قبل تخزينها أو إرسالها في السياق.
- عزلًا بحسب tenant/user/conversation.

الحالة المنظمة تساعد على فهم «هو» و«المشروع ده»، لكنها ليست مصدرًا authoritative؛ الكود نفسه يطلب التحقق من Structured Memory بالأدوات. هذا الحد يجب أن يبقى قائمًا في Agent Work أيضًا.

### 3.4 Second Brain

Second Brain الحالي يتضمن:

- أنواع `fact` و`preference` و`alias`.
- أوامر remember/recall الصريحة.
- اقتراح candidates للمعلومة التي تبدو قابلة للحفظ، بدل تفعيلها تلقائيًا.
- مراجعة candidate مع promotion ذري إلى memory.
- شرط ربط alias بكيان canonical قبل اعتماده.
- archive/restore.
- query domains تميز preference/personal fact/entity resolution وstructured record وغيرها.
- lexical retrieval وexplicit recall.
- trace يوضح ما تم اعتباره واختياره واستبعاده وسبب الاستبعاد.
- precedence للسجلات المالية والتشغيلية عند التعارض.
- provenance عبر `sourceConversationId` و`sourceTurnId`.
- حدود لحجم السياق.

الاستخدام الصحيح في Agent Work هو أن يضيف العمل سياقًا محددًا عند الحاجة، لا أن يقرأ كل الذاكرة أو يستنتج صلاحية تنفيذ منها. لا يجوز تحويل «تفضيل محفوظ» إلى إذن مالي أو permission.

### 3.5 Entity resolution والعلاقات

`entity-resolver.ts` يعزل البحث داخل tenant/user ويعيد:

- candidates.
- selected entity عند وجود تطابق كافٍ.
- confidence وmatch type.
- ambiguity عندما توجد أسماء متشابهة.
- aliases معتمدة صراحة فقط.
- shadow logging اختياريًا لقياس ما كان سيتغير.

المسار الآمن لـ Agent Work هو تخزين `entityId` بعد resolution موثوق، وليس تخزين الاسم الذي ظهر في prompt ثم إعادة استخدامه لاحقًا. إذا تغيّر المرشح أو أصبحت المطابقة ambiguous، يجب أن يتوقف العمل أو يطلب clarification بدل اختيار آخر اسم.

### 3.6 Provider routing وtool runtime

`provider-router.ts` يدعم ترتيبًا مكوّنًا من البيئة، مع تفضيل Gemini للطلبات العربية القصيرة عندما يكون متاحًا. `phase2.ts` يوفر:

- Gemini/Groq/Mistral/Cohere gateways.
- fallback وcircuit cooldown.
- تصنيف أخطاء provider.
- حدود `MAX_TOOL_CALLS` و`MAX_LOGICAL_LLM_CALLS`.
- deadline للطلب.
- tool scopes مثل `read_only` و`expense` و`reminder` و`person` و`project` و`task` و`commitment`.
- تقليل تعريفات الأدوات حسب النطاق عند تفعيل flag.
- metrics لكل محاولة provider، لا مجرد إجمالي مضلل.
- usage completeness تميز complete/partial/unavailable.
- diagnostic trace للـ logical calls والأدوات والقرار التالي.

الأدوات نفسها تمر عبر `executeStructuredTool`. الكتابات الحساسة تنشئ pending operation بدل التنفيذ الفوري، والقراءة لا تحتاج مسار موافقة. بعد نتائج الأدوات، يمكن للـ runtime طلب `final_response`، أو إعادة المحاولة ضمن الحدود، أو إعادة approval/clarification/error.

### 3.7 السجلات الرسمية والكتابات

المشروع يحتوي على سجلات للأشخاص والمشاريع والمصروفات والمهام والالتزامات والتذكيرات والكيانات المالية والعلاقات typed. توجد:

- row versions لبعض السجلات.
- tenant/user predicates في القراءة والكتابة.
- idempotency records.
- secretary operations للموافقات.
- activity events وentity links.
- أدوات مالية تستخدم معاملات وكتابة activity حيث يلزم.

هذا يجعل Structured Records وactivity timeline أساسًا مناسبًا للفعل، مع ضرورة أن تُنسب أفعال Agent Work إلى العمل نفسه لا إلى user فقط.

### 3.8 الموافقة والتحقق

عملية `secretary_operations` تحفظ:

- conversation/source turn.
- idempotency key.
- tool name.
- arguments وdisplay.
- status.
- result/error.
- created/updated/approved/claimed/completed/expiry timestamps.

الموافقة تستخدم claim ذريًا لتمنع التنفيذ المكرر، وتسمح بتعديل arguments فقط وفق schema الأداة، ثم تنفذ العملية، وتسجل النتيجة، وتعيد مزامنة turn الموافقة. حالات executing/completed/failed/rejected/expired لا تعيد التشغيل تلقائيًا.

هذه آلية ممتازة لفعل واحد ينتظر المستخدم، لكنها ليست سجل Agent Work كاملًا؛ لا تحتوي على trigger أو run attempts أو lease worker أو retry schedule أو pause/resume عام.

### 3.9 الإدخال الصوتي والصوري

الـ mobile capture يحول voice/receipt إلى input asset result قابل للمراجعة. `input_asset_results` يملك hash/input uniqueness ونتائج منظمة وexpiry. واجهة المراجعة تسمح بالتصحيح وإعادة المحاولة قبل تركيب turn.

هذا قابل لإعادة الاستخدام في Agent Work كـ evidence أو input، لكن لا يجب اعتبار نتيجة OCR/voice حقيقة نهائية أو تنفيذها تلقائيًا بلا confirmation/verification المناسبين.

### 3.10 Main وQuick والموبايل

الويب يوفر Main workspace أوسع: chat، conversations، records، people، projects، financial، tasks، reminders، activity، وسياق السجل داخل المحادثة. Quick موجود كمدخل سريع ومحدود، وليس مكانًا مناسبًا لتقييم عمل معقد.

الموبايل يفتح على Quick ثم يصل إلى Main workspace، ويدعم:

- chat وconversation history.
- records وrecord detail.
- approval cards.
- language/theme preferences.
- voice/receipt capture.
- push registration.
- quick notification deep link.

الحد الحالي الصحيح: Quick يتعامل مباشرة مع الحالات البسيطة مثل مصروف أو تذكير واضح، بينما الحالات المعقدة أو ambiguous تعود إلى Main. Agent Work approval/event المعقد يجب أن يفتح Main أو شاشة تفاصيل، لا أن يحشر كل التفاصيل في Quick.

## 4. جدول KEEP / MODIFY / ADD / DEFER / REMOVE

| النظام | القرار | السبب وحدود القرار |
|---|---|---|
| Structured Records وfinancial graph | **KEEP** | هي المصدر الرسمي للفعل والقراءة، وتملك tenant scoping وعلاقات ومخرجات قابلة للتحقق. |
| `executeStructuredTool` وtool scopes | **KEEP** | يجب أن تكون كل أفعال Agent Work عبر نفس الأدوات وحدودها، لا عبر write path موازٍ. |
| Second Brain policy/retrieval/provenance | **KEEP** | يعالج السياق الشخصي والـ aliases، مع إبقاء السجلات الرسمية أعلى أولوية. |
| Conversation memory | **KEEP** | مفيد في تفاعل Main، لكن لا يستخدم كحالة durable للعمل بدل Agent Work state. |
| Brain envelope وverification contract | **KEEP** | يوفر تفسيرًا transient للقرار وحالة التحقق، ويجب ربطه بالـ work/run لاحقًا. |
| Provider routing/failover/metrics | **KEEP** | يعاد استخدامه داخل turn أو run محدود، مع احترام deadline وprovider limits. |
| Deterministic paths | **KEEP** | تقلل التكلفة والمخاطر للحالات المعروفة والتقارير والجدولة البسيطة. |
| Entity resolver والـ explicit aliases | **KEEP** | يمنع ربط العمل باسم ambiguous أو alias غير معتمد. |
| `secretary_operations` | **MODIFY** | يبقى مسار approval للفعل، لكن لا يُمدد ليكون بديلًا عن Agent Work state. يحتاج ربطًا واضحًا بـ work/run عند التنفيذ. |
| idempotency | **MODIFY** | تبقى على مستوى request/operation، وتحتاج مفتاحًا مركبًا وآمنًا على مستوى work/run/attempt للمصادر المتكررة. |
| activity events | **MODIFY** | تصلح للعرض والتدقيق، لكن تحتاج event vocabulary وattribution لـ work/run/verification، لا مجرد user/source. |
| notifications وmobile push | **MODIFY** | يبقى approval push، ويضاف لاحقًا حدث Agent Work مختصر مع deep link وحماية من التكرار. |
| input asset results | **KEEP ثم MODIFY** | يعاد استخدامها كـ evidence قابل للمراجعة؛ لا تتحول وحدها إلى trigger دائم أو حقيقة معتمدة. |
| Main | **KEEP ثم MODIFY** | هو مكان شرح الحالة، evidence، clarification، retry review، وسجل العمل. |
| Quick | **KEEP مع حدود** | يبقى مدخلًا سريعًا للموافقة/الإشعار البسيط، ولا يقيّم work معقدًا. |
| mobile Main/Quick | **KEEP ثم MODIFY** | يعاد استخدام deep links وapproval UI، مع شاشة work لاحقة بدل مسار موازٍ. |
| provider optimization/context budget | **DEFER** | لا يوجد قياس كافٍ يجعل التحسين الافتراضي آمنًا؛ baseline أولًا. |
| recurring website check | **DEFER** | يحتاج browser automation، إدارة جلسة، تغيرات DOM، ومخاطر verification أعلى. |
| learned workflow | **DEFER** | يحتاج learning/evaluation/rollback، ولا يثبت MVP الأساسي. |
| browser/computer use | **DEFER** | ليس شرطًا لمصدر API بسيط، ويزيد سطح الأمان والتكلفة. |
| A2A وmulti-agent | **DEFER** | لا توجد حاجة تشغيلية قبل إثبات Agent Work أحادي المسار. |
| Kubernetes/منصة workers عامة | **DEFER** | التنفيذ الأول يمكن أن يستخدم workflow/worker واحدًا بسيطًا بعد تعريف العقد؛ لا نبني منصة توزيع مبكرًا. |
| قناة تنفيذ موازية تتجاوز secretary | **REMOVE** | ستكسر الموافقة، attribution، idempotency، والـ verification الحالي. |
| استخدام Second Brain كقاعدة مالية أو permission | **REMOVE** | الذاكرة الشخصية ليست سجلًا قانونيًا ولا تصريح تنفيذ. |
| retry تلقائي لنتيجة خارجية uncertain | **REMOVE** | قد يكرر فعلًا ماليًا أو إشعارًا أو mutation. uncertain يجب أن يوقف العمل ويطلب reconciliation. |

## 5. ما ينقص لبناء Agent Work

هذه ليست دعوة لإضافتها الآن داخل مهمة التدقيق؛ هي حدود تنفيذ لاحق يجب ألا تختلط مع الموجود.

### 5.1 Agent Work definition

يحتاج العمل إلى هوية مستقلة عن المحادثة، على الأقل:

- `workId`
- tenant/user owner
- نوع العمل/version
- الهدف والـ input المرجعي
- permission policy
- الحالة: draft/active/paused/waiting/needs_review/completed/failed/cancelled
- provenance: من أنشأه، من أي conversation/turn، ومن أي input asset
- created/updated/completed timestamps

لا ينبغي أن يساوي `conversationId` هوية العمل؛ المحادثة قد تعرض العمل، لكنها ليست lifecycle له.

### 5.2 Trigger وschedule

يجب أن يحدد trigger عقدًا deterministic:

- مصدرًا محددًا.
- interval أو next run.
- timezone إذا كان متعلقًا بالمستخدم.
- شرط تغيير قابلًا للمقارنة.
- حدًا للطلبات.
- طريقة إيقاف/إلغاء واضحة.

يُفضل أن يبدأ trigger بجدولة server-side لمصدر API مع fetch idempotent، لا بفحص موقع.

### 5.3 Run وlease

كل تشغيل يحتاج:

- `runId` وattempt number.
- وقت بدء وانتهاء وdeadline.
- actor/work attribution.
- input snapshot أو hash.
- result/evidence snapshot.
- verification state.
- lease/claim يمنع عاملين من التشغيل في الوقت نفسه.
- heartbeat أو timeout واضح.

وجود `claimedAt` في secretary operation لا يغطي هذا؛ فهو claim لموافقة واحدة لا lease لعمل دوري.

### 5.4 Retry وuncertain outcome

السياسة يجب أن تفرق بين:

- provider transient failure: يمكن retry محدودًا.
- source timeout: يمكن retry وفق budget.
- source returned unchanged: complete/no-op مع evidence.
- source changed but comparison uncertain: needs_review.
- external mutation accepted but response lost: uncertain، لا retry تلقائي.
- approval rejected/expired: paused أو cancelled حسب policy، لا إعادة إرسال صامت.

كل retry يحتاج idempotency key مرتبطًا بالعمل والتشغيل ومحاولة الفعل، لا request UUID جديدًا فقط.

### 5.5 Evidence وverification

لا يكفي حفظ `resultJson`. يجب حفظ ما يسمح بإجابة:

- ما المصدر الذي فُحص؟
- متى فُحص؟
- ما snapshot/hash السابق والحالي؟
- ما الشرط الذي تحقق؟
- ما الذي لم يمكن التحقق منه؟
- هل النتيجة read-only أم سببت mutation؟
- هل notification أُرسل أم قُبل أم فشل؟

الحالة النهائية لا تكون `completed` إذا كانت النتيجة uncertain؛ يجب حالة مراجعة منفصلة.

## 6. مقارنة مسارات Agent MVP المحتملة

| المسار | ما يثبته | الاعتماد على قدرات جديدة | المخاطر | القرار |
|---|---|---:|---|---|
| متابعة price من API بسيط | trigger، fetch، compare، evidence، notification، pause/retry | منخفض | source contract وrate limits | **الاختيار الأول** |
| recurring website check | trigger وcompare | عالٍ | browser session، DOM drift، login، verification | يؤجل |
| contextual personal request | delegation وSecond Brain والسجل | متوسط | قد ينتهي كـ chat مميز دون monitoring دائم | يصلح تجربة موازية لاحقًا، لا baseline الأول |
| learned workflow | التعلم من النمط | عالٍ جدًا | permission drift، explainability، regression | يؤجل |

### لماذا API monitor هو الأول؟

- لا يحتاج browser/computer use.
- يمكن استخدام HTTP response كـ evidence محدود وقابل للـ hash.
- يختبر lifecycle الدائم بدل مجرد tool call.
- يختبر notification وpause/retry وverification.
- يمكن أن يبدأ read-only تمامًا.
- يبقي الفعل الاختياري خلف الموافقة الحالية.

## 7. أصغر شريحة MVP آمنة

### سيناريو واحد

يُنشئ المستخدم من Main عملًا من نوع:

> «تابع هذا المصدر/API، وإذا تغيّرت قيمة محددة عن الشرط، نبّهني.»

في النسخة الأولى:

- مصدر واحد configured وآمن، بلا arbitrary URL من المستخدم إن لم توجد allowlist/SSRF protections.
- قراءة واحدة أو عدد محدود من الحقول المحددة مسبقًا.
- شرط واحد deterministic مثل `value <= threshold` أو `value changed`.
- لا توجد كتابة خارجية تلقائية.
- notification واحد لكل transition، مع dedupe.
- Main يعرض آخر check وevidence والحالة.
- Quick يفتح الحدث ويحوّل التفاصيل إلى Main.
- يمكن إيقاف العمل واستئنافه.

### دورة الحياة المقترحة

1. **Create:** المستخدم يطلب monitor؛ deterministic parser أو form يتحقق من المصدر والشرط.
2. **Review:** إذا كان المصدر/الشرط/الإذن غير واضح، يظهر clarification أو approval بدل الإنشاء.
3. **Activate:** تُنشأ هوية work وتُسجل provenance.
4. **Run:** scheduler/worker يأخذ lease، يجلب المصدر بموعد وحدود.
5. **Compare:** يقارن snapshot الحالي بالسابق deterministic.
6. **Verify:** يصنف `unchanged` أو `changed_verified` أو `uncertain`.
7. **Notify:** عند transition verified، يسجل activity event ويرسل push deduped.
8. **Surface:** notification يفتح Main على work detail، والمحادثة تعرض ملخصًا مرتبطًا بالعمل.
9. **Pause:** فشل متكرر أو uncertain يوقف العمل ويطلب مراجعة بدل loop.
10. **Resume/cancel:** المستخدم يقرر من Main، مع تسجيل الفعل.

### ما لا يدخل في هذه الشريحة

- شراء/بيع أو دفع أو mutation خارجي.
- browser login أو scraping.
- تعلّم threshold أو workflow من السلوك.
- أكثر من مصدر أو أكثر من شرط قبل ثبات العقد.
- multi-agent delegation.
- قراءة عامة للـ Second Brain لتحديد ما يجب فعله.

## 8. خطة تنفيذ مرحلية لاحقة

### المرحلة 0: تثبيت العقد قبل الكود

- تعريف work/run/attempt/verification states كـ domain contract.
- تحديد permission model: read-only في البداية.
- اختيار مصدر API واحد ومخطط evidence.
- تحديد idempotency وdedupe وretention.
- تحديد ما يظهر في Main وما يصل إلى Quick وما يرسل push.

**بوابة الخروج:** يمكن كتابة حالات القبول والفشل دون استخدام عبارات «سنحاول» أو «إذا بدا ناجحًا».

### المرحلة 1: Work lifecycle read-only

- تخزين work definition وstatus وprovenance.
- إنشاء/إيقاف/استئناف عبر Main.
- لا scheduler عام بعد؛ يمكن تشغيل run يدويًا أو من harness اختبار.
- عرض الحالة في API وMain.

**بوابة الخروج:** tenant isolation، ownership، cancellation، وstate transitions مغطاة باختبارات.

### المرحلة 2: Run وmonitor واحد

- إضافة trigger محدود.
- worker واحد أو execution loop واحد بlease.
- fetch allowlist ومهلة وحدود body.
- canonical snapshot/hash.
- compare deterministic.
- retry محدود للقراءات فقط.

**بوابة الخروج:** لا يوجد double run، وuncertain لا يتحول إلى completed أو retry loop.

### المرحلة 3: Evidence وactivity وpush

- ربط run بالـ activity event.
- إضافة attribution إلى work/run/attempt.
- إشعار transition verified فقط.
- dedupe للإشعارات وdeep link إلى Main.
- reconciliation عندما ينجح API لكن تفشل notification.

**بوابة الخروج:** يمكن تتبع كل حدث من الإشعار إلى run إلى evidence إلى work owner.

### المرحلة 4: ربط الموافقة بالفعل الاختياري

- إذا أظهر المصدر اقتراح فعل، يُنشأ secretary operation من نفس executor.
- لا تنفيذ مباشر من worker.
- approval يعيد إلى work/run، ويحفظ actual args ونتيجة التنفيذ والتحقق.
- رفض/انتهاء الموافقة يوقف أو يؤجل حسب policy، دون إرسال تلقائي غير واضح.

**بوابة الخروج:** إثبات عدم التكرار في race بين worker وواجهة الموافقة.

### المرحلة 5: تقييم وتوسعة محدودة

- قياس latency/provider attempts/cost/notification delivery/uncertain rate.
- مقارنة deterministic path مع provider path إذا دخل provider.
- إضافة مصدر ثانٍ فقط إذا لم تتغير عقود lifecycle.
- تأجيل أي learned workflow إلى ما بعد benchmark واضح وrollback.

## 9. مخاطر وضوابط

| الخطر | أثره | الضابط المطلوب |
|---|---|---|
| تنفيذ worker بلا tenant/user scope | تسريب أو تعديل بيانات مستخدم آخر | identity صريح داخل work/run وكل query/write scoped |
| استخدام conversation state كحالة عمل | فقدان العمل بعد انتهاء المحادثة أو تضارب turns | work state مستقل، والمحادثة مجرد واجهة |
| duplicate scheduler runs | إشعارات أو أفعال مكررة | lease/claim ذري وunique run key |
| retry بعد استجابة خارجية مفقودة | تكرار mutation | uncertain state وreconciliation يدوي |
| SSRF أو مصدر غير موثوق | وصول داخلي أو exfiltration | allowlist، منع private ranges، timeouts، body limits، redirect policy |
| data poisoning من Second Brain | قرار خاطئ أو permission غير مباشر | provenance، candidate review، structured precedence |
| alias/name ambiguity | ربط العمل بكيان خاطئ | canonical IDs، توقف عند ambiguity |
| provider rate limit | تأخير وتكلفة وفقدان turn | provider classification، budget، fallback محدود، لا loop دائم |
| provider response غير موثق | إعلان نجاح غير حقيقي | structured result + verification state |
| push duplicate أو فشل التسليم | إزعاج أو فقدان تنبيه | event dedupe، delivery status، deep link idempotent |
| approval من نافذتين | double execution أو stale edit | claim ذري، row/version checks، actual args reconciliation |
| retention غير محدد للـ evidence | تضخم أو تسريب بيانات المصدر | TTL وتصنيف حساسية وحدود payload |
| إظهار تفاصيل كثيرة في Quick | قرار غير مفهوم على شاشة صغيرة | Quick للـ entry/summary، Main للمراجعة |

## 10. فجوات قابلة للتحويل إلى تنفيذ لاحق

### فجوات MVP

1. لا يوجد Agent Work entity/lifecycle مستقل عن conversation وsecretary operation.
2. لا يوجد run/attempt/lease/heartbeat model يمنع التوازي ويصف المحاولات.
3. لا يوجد scheduler/trigger contract أو worker execution boundary لهذا النوع من العمل.
4. لا يوجد canonical evidence/snapshot/verification model لمراقبة مصدر خارجي.
5. لا يوجد event vocabulary عام لبدء العمل، تغيّر المصدر، التوقف، uncertain، والإشعار.
6. push الحالي يثبت approval notification، وليس lifecycle events عامة مع dedupe.
7. لا توجد واجهة Work Detail في Main تعرض الحالة والمحاولات وevidence والإجراءات.
8. عقد الهوية الظاهر في secretary route يحتاج تثبيتًا قبل تشغيل عامل دائم خارج request context.

### فجوات جودة واختبار

- اختبار race بين run lease وmanual run وapprove.
- اختبار uncertain outcome وعدم إعادة التشغيل التلقائي.
- اختبار SSRF/redirect/body/timeouts للمصدر.
- اختبار tenant isolation عبر work/run/evidence/activity/notification.
- اختبار provider unavailable أثناء run وعدم تحويله إلى success.
- اختبار notification failure بعد verified change وإعادة reconciliation.
- اختبار mobile deep link من push إلى Main مع work غير موجود أو cancelled.
- baseline حقيقي للتكلفة والـ latency قبل تفعيل أي تحسين context أو routing إضافي.

هذه الفجوات لا تعني أن الأنظمة الحالية غير صالحة؛ تعني أن Agent Work يحتاج عقدًا جديدًا فوقها.

## 11. معايير قبول التدقيق وخطة MVP

يُعتبر هذا التدقيق مكتملًا عندما تكون القرارات التالية واضحة:

- **المسار الأساسي:** Main/Quick → secretary API → deterministic/Brain/provider → scoped tools → structured result/approval → verification → conversation/activity/push.
- **المصدر الرسمي:** Structured Records، وليس summary أو Second Brain.
- **الذاكرة:** سياق مساعد مع provenance ومراجعة، وليست permission.
- **الفعل:** نفس executor والموافقة الحالية، لا قناة موازية.
- **MVP الأول:** API monitor read-only deterministic مع work/run/evidence/notification lifecycle.
- **الحدود:** لا browser automation، ولا A2A، ولا multi-agent، ولا learned workflow.
- **المخاطر:** tenant isolation، idempotency، lease، uncertain outcome، verification، SSRF، notification dedupe.
- **التنفيذ:** مراحل مستقلة تبدأ بالعقد والـ lifecycle قبل scheduler أو فعل خارجي.

## 12. القرار النهائي

المشروع جاهز لإضافة Agent Work كطبقة orchestration رفيعة، وليس لإعادة بناء Agent/Secretary. قيمة MVP لن تأتي من زيادة عدد الأدوات أو providers، بل من إثبات أن عملًا واحدًا:

1. يُنشأ بإذن واضح.
2. يستمر بعد انتهاء request والمحادثة.
3. يُستأنف دون تشغيل موازٍ.
4. يحتفظ بـ provenance وevidence.
5. يفرق بين النجاح والفشل والنتيجة غير المؤكدة.
6. يرسل حدثًا قابلًا للتتبع.
7. يستخدم الموافقة والتنفيذ الحاليين عندما يصبح الفعل حساسًا.

أي خطة تتجاوز هذه الشريحة قبل إثبات هذه النقاط ستكون توسعًا في السطح، لا تقدمًا في موثوقية الـ Agent.