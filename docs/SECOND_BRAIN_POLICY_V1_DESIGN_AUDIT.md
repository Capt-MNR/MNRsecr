# Second Brain Policy v1 — Design Audit & Secretary Brain Contract

**الحالة:** Design contract  
**النطاق:** Second Brain، Secretary Brain، Structured Records، والـLLM context  
**الإصدار:** v1  
**تاريخ المراجعة:** 2026-09-18

هذه الوثيقة تحدد السياسة التي يجب أن تحكم استخدام الذاكرة الشخصية. هي عقد تصميم
قبل التنفيذ: لا تغيّر السلوك البرمجي الحالي وحدها، لكنها تحدد السلوك المقبول
لأي تغيير لاحق.

الكلمات التالية ملزمة:

- **MUST / يجب:** شرط لا يجوز تجاوزه.
- **MUST NOT / ممنوع:** سلوك غير مقبول حتى لو بدا مفيدًا.
- **SHOULD / يفضل:** القاعدة الافتراضية، ولا تُستثنى إلا بسبب موثق.
- **MAY / يمكن:** اختيار تنفيذي لا يغير الضمانات الأساسية.

---

## 1. القرار المعماري الأساسي

Second Brain ليس قاعدة بيانات تشغيلية، وليس بديلًا عن Structured Records،
وليس سجلًا للحقيقة المالية.

المكونات الأربعة لها حدود ثابتة:

| المكون | وظيفته | سلطته |
|---|---|---|
| **Structured Records** | الأشخاص، المشاريع، المصروفات، المدفوعات، الالتزامات، المهام، التذكيرات | المصدر النهائي للحالة التشغيلية والحقائق المالية |
| **Second Brain** | تفضيلات المستخدم، حقائق شخصية صريحة، وأسماء بديلة معتمدة | سياق مساعد، لا يثبت حالة سجل تشغيلي |
| **Conversation Memory** | استمرارية الحوار والمراجع قصيرة العمر | صالح لاستكمال الحوار فقط، وليس مصدر حقيقة دائم |
| **Memory Candidate / Learning Layer** | اقتراحات تحتاج مراجعة | لا تدخل أي قرار ولا أي LLM context قبل الترقية |

القاعدة المركزية:

> إذا تعارضت Memory مع Structured Record، يفوز Structured Record في كل ما
> يخص الحالة التشغيلية أو المالية. لا يجوز للنموذج حل هذا التعارض من تلقاء
> نفسه أو تحويل Memory إلى تعديل في السجل.

---

## 2. Memory types

الـ`kind` النهائي يجب أن يكون واحدًا من الأنواع التالية:

### 2.1 `preference`

تفضيل شخصي مستقر نسبيًا، مثل:

- يفضل الردود المختصرة.
- يفضل تنسيقًا معينًا للتقارير.
- يحب استخدام لغة أو لهجة معينة.

الخصائص:

- يمكن أن يدخل LLM context عندما يكون الطلب متعلقًا بالتفضيل.
- لا يغيّر Structured Record.
- لا يستخدم لإثبات مبلغ أو تاريخ أو حالة دفع.
- إذا كان التفضيل متعلقًا بكيان، يجب أن يحمل association صريحة.

### 2.2 `fact`

معلومة شخصية صريحة قالها المستخدم وطلب حفظها، مثل:

- معلومة عن روتين شخصي.
- اسم أو وصف شخصي لا يمثل سجلًا تشغيليًا.
- قاعدة تواصل شخصية.

الخصائص:

- لا تُقبل كحقيقة تشغيلية لمجرد أنها مخزنة في Second Brain.
- لا تدخل context إلا إذا كانت مرتبطة بنية الطلب.
- يجب أن تكون قابلة للتفسير من مصدرها.
- لا يجوز استخدام هذا النوع لتخزين نسخة ثانية من مصروف أو دين أو تاريخ
  استحقاق.

### 2.3 `alias`

اسم بديل صريح لكيان Structured Record:

- شخص.
- مشروع.
- طرف مالي.

الـalias ليس Memory نصية عامة؛ هو إشارة entity resolution.

الخصائص:

- يجب أن يحتوي على `entityType`.
- يجب أن يشير إلى canonical entity يمكن حلّه في Structured Records.
- يستخدم في resolver فقط، ثم يتحول إلى `entityId` من Structured Records.
- لا يكفي تشابه الاسم وحده لتأكيد association.
- إذا وجد أكثر من canonical candidate، تكون النتيجة `ambiguous` ويطلب
  Secretary توضيحًا.
- الـalias المؤرشف لا يدخل resolution.

### 2.4 أنواع ممنوعة في Second Brain النهائي

لا يجوز إضافة `financial_fact` أو نسخة من:

- amount.
- payment status.
- due date.
- debt balance.
- expense total.
- record lifecycle state.

هذه القيم تنتمي إلى Structured Records. إذا احتاج المستخدم تفضيلًا عنها، يحفظ
التفضيل فقط، مثل: «اعرض المبالغ بالجنيه».

كذلك لا يجوز حفظ أسرار أو credentials أو مفاتيح API أو كلمات مرور في أي Memory.

---

## 3. Memory authority

السلطة ليست مساوية لمجرد وجود السجل. ترتيب المصادر عند الإجابة:

1. **Structured Record scoped to the current request**
2. **Explicit current user instruction**
3. **Active, promoted Second Brain Memory**
4. **Conversation Memory**
5. **Memory Candidate / Learning Signal**

هذا الترتيب يحتاج توضيحين:

- رسالة المستخدم الحالية هي أعلى مصدر لفهم ما يطلبه الآن، لكنها لا تغيّر
  سجلًا تشغيليًا بدون مسار mutation والـapproval المطلوب.
- Candidate وLearning Signal لا يملكان أي سلطة تشغيلية. وجودهما دليل على أن
  النظام لاحظ احتمالًا فقط.

### حدود السلطة حسب النوع

| النوع | يمكنه تخصيص الرد؟ | يمكنه تحديد حقيقة مالية؟ | يمكنه تعديل Record؟ |
|---|---:|---:|---:|
| preference | نعم | لا | لا |
| fact | نعم، إذا كان الطلب مناسبًا | لا | لا |
| alias | نعم، عبر entity resolution | لا | لا |
| Structured Record | نعم | نعم | فقط عبر mutation مصرح |
| Candidate | لا | لا | لا |

---

## 4. Confidence semantics

`confidence` تقيس **احتمال صحة الاستخراج والربط**، ولا تقيس authority.

بالتالي:

- Confidence عالية لا تجعل Memory أقوى من Structured Record.
- Confidence منخفضة لا تعني أن المستخدم مخطئ؛ تعني أن النظام غير متأكد من
  extraction أو association.
- Confidence يجب أن تكون رقمًا بين `0` و`1`، وتمثل في التخزين بـbasis points
  بين `0` و`10000`.

### مستويات v1

| النطاق | المعنى | الاستخدام |
|---|---|---|
| `0.95–1.00` | تصريح مستخدم مباشر مع association صحيحة | يمكن أن يدخل context إذا اجتاز relevance والـprecedence |
| `0.80–0.9499` | استخراج أو ربط جيد لكنه ليس تأكيدًا كاملًا | review أو context محدود حسب النوع؛ لا يستخدم في alias حاسم |
| `0.60–0.7999` | احتمال معقول | Candidate فقط، لا يدخل context |
| أقل من `0.60` | غير موثوق | لا promotion ولا retrieval |

### متطلبات إلزامية

- `preference` و`fact` المباشران يمكن أن يبدأا عند `1.0` فقط إذا كانا ناتجين
  عن أمر حفظ صريح.
- `alias` يحتاج confidence لا يقل عن `0.95`، ويفضل أن يكون association مع
  canonical entity exact.
- Memory تم تعديلها يدويًا أو تأكيدها صراحةً يجب أن تحدّث
  `lastConfirmedAt`.
- Retrieval MUST يطبق confidence gate؛ لا يكفي تمرير القيمة إلى النموذج
  داخل JSON.
- Candidate لا يرث confidence نهائية عند إنشائه. promotion هو الذي ينشئ
  final Memory بثقة مناسبة.

---

## 5. Relevance rules

لا يكفي أن تكون Memory active حتى تدخل Secretary context.

### 5.1 تصنيف الطلب قبل retrieval

قبل البحث يجب تصنيف الطلب إلى واحد أو أكثر من المجالات:

- `preference`
- `personal_fact`
- `entity_resolution`
- `structured_record_read`
- `structured_record_mutation`
- `general_conversation`
- `memory_recall`

### 5.2 قواعد الإدخال حسب المجال

| مجال الطلب | Memory المسموح بها |
|---|---|
| preference | preferences المرتبطة بالطلب أو بالـchannel |
| personal_fact | facts ذات صلة مباشرة |
| entity_resolution | aliases المطابقة فقط |
| structured_record_read | لا تستخدم Memory لتكوين الحقيقة؛ يمكن استخدام alias قبل resolver |
| structured_record_mutation | لا تستخدم Memory لتحديد amount/status/date؛ يمكن استخدام alias مع clarification عند الحاجة |
| general_conversation | لا retrieval تلقائي إلا إذا ظهر trigger قوي |
| memory_recall | active memories القابلة للعرض، مع استبعاد المرشحين والأنواع الممنوعة |

### 5.3 تعريف relevance

Memory تكون `relevant` إذا تحقق واحد على الأقل من الآتي:

1. تطابق صريح مع intent والنوع.
2. association مع entity تم حلّه إلى نفس `entityId`.
3. alias exact أو normalized exact للكيان المطلوب.
4. طلب المستخدم recall صريح.
5. preference مرتبطة بالـchannel أو شكل الإجابة المطلوب.

التطابق النصي الجزئي وحده لا يكفي لإعطاء Memory سلطة. يمكن استخدامه لتكوين
مرشحين محدودين، لكنه يحتاج gate إضافيًا قبل الإدخال إلى LLM context.

### 5.4 حدود retrieval

يجب أن يبقى retrieval:

- tenant-scoped وuser-scoped.
- bounded بعدد ثابت.
- bounded بالحجم النهائي للـcontext.
- deterministic في سبب الاختيار.
- منفصلًا عن broad recall.

في v1:

- الحد الأعلى المقترح للـselected memories: `8`.
- الحد الأعلى المقترح لحجم Second Brain context: `2800` حرفًا.
- broad recall لا يستخدم في سؤال Structured Record.
- لا يجوز أن تتحول عبارة عامة مثل «المعتاد» وحدها إلى تحميل كل الذاكرة
  داخل طلب مالي.

---

## 6. Entity association

### 6.1 شكل association المستهدف

عند ارتباط Memory بكيان يجب أن تتوفر معلومات قابلة للتحقق:

```json
{
  "entityType": "person | project | financial_party",
  "entityId": "uuid",
  "canonicalName": "string",
  "associationMethod": "explicit | exact_alias | reviewed"
}
```

### 6.2 القواعد

- `entityId` من Structured Records هو المرجع النهائي، وليس الاسم النصي.
- لا يجوز استنتاج association من مجرد ظهور الاسم في نص عادي.
- alias غير المرتبط بكيان موجود يظل Candidate، ولا يدخل resolver الإنتاجي.
- fuzzy match لا يرقّي alias تلقائيًا.
- أكثر من candidate ضمن هامش الغموض يؤدي إلى clarification.
- تغيير اسم الكيان لا يكسر association إذا كان `entityId` ثابتًا.
- حذف أو أرشفة الكيان يجب أن يوقف استخدام aliases المرتبطة به حتى تتم
  المراجعة.

### 6.3 الفرق بين Memory association وConversation reference

`Conversation Memory` يمكن أن تحمل `lastPerson` أو `lastProject` لمتابعة قصيرة.
هذا لا يحولها إلى association دائمة داخل Second Brain. لا يجوز ترقية مرجع
الحوار إلى Memory إلا بتصريح أو مراجعة صريحة.

---

## 7. Conflict resolution

### 7.1 قواعد precedence

إذا كانت الإجابة تخص أيًا من الآتي:

- amount.
- currency.
- payment.
- debt.
- due date.
- record status.
- project/person/financial party existence.
- relationship أو linkage.

فـStructured Record scoped هو المصدر الوحيد للحقيقة.

Second Brain يمكنه:

- اقتراح alias.
- تخصيص طريقة العرض.
- إضافة preference.
- إضافة context شخصي لا يناقض السجل.

لكنه لا يستطيع:

- تصحيح رقم من الذاكرة.
- استنتاج حالة سجل غير موجود.
- استبدال تاريخ السجل بتاريخ محفوظ.
- استخدام “عادةً” كبديل عن القيمة الحالية.

### 7.2 عند وجود تعارض

يجب أن يحدث الآتي:

1. يسجل retrieval trace وجود conflict.
2. يستبعد Memory المتعارضة من LLM context إذا كان السؤال عن نفس الحقيقة.
3. يستخدم Structured Record.
4. إذا كان التعارض يؤثر على entity resolution، يطلب clarification بدل
   الاختيار الصامت.
5. لا يتم archive أو overwrite للـMemory تلقائيًا بسبب التعارض.
6. يمكن اقتراح مراجعة Memory للمستخدم، لكن لا يتم تطبيقها تلقائيًا.

### 7.3 Direct deterministic responses

عندما يستطيع relationship/record path إعطاء إجابة deterministic، يجب أن يجيب
المسار المنظم مباشرة، ولا يمرر Memory إلى النموذج لتفسير أو إعادة حساب
الحقيقة.

---

## 8. Provenance usage

Provenance ليست معلومة للعرض فقط؛ يجب أن تؤثر في القرار وفي قابلية التدقيق.

### الحد الأدنى المطلوب

لكل Final Memory:

- `memoryId`
- `sourceType`: `explicit_user | reviewed_candidate | migration`
- `sourceConversationId`
- `sourceTurnId`
- `createdAt`
- `updatedAt`
- `lastConfirmedAt`
- association إن وجدت
- candidate/review reference إن وجدت

### استخدام provenance

يجب استخدامه في:

1. حساب confidence.
2. التمييز بين explicit memory وmodel-extracted memory.
3. عرض سبب وجود Memory للمستخدم.
4. اختيار الأحدث عند تعادل relevance.
5. تسجيل سبب promotion أو archive.
6. conflict trace.
7. فتح المصدر عند مراجعة Memory.

لا يجوز استخدام conversation أو turn ID كدليل على الحقيقة المالية وحده.
هو يثبت المصدر والزمن، لا authority.

---

## 9. Memory lifecycle

### 9.1 Candidate lifecycle

المرشح كيان منفصل عن Final Memory:

```text
candidate
  -> approved/promotion
  -> final active memory

candidate
  -> rejected

candidate
  -> needs_context
```

Candidate MUST NOT:

- يدخل LLM context.
- يدخل alias resolver.
- يغير Structured Records.
- يتحول تلقائيًا إلى Final Memory بسبب score أو تكرار ظهوره.

### 9.2 Final Memory lifecycle

```text
active <-> archived
```

- `active`: يمكن retrieval إذا اجتازت باقي gates.
- `archived`: لا تدخل retrieval ولا resolver، لكنها قابلة للعرض والاسترجاع
  اليدوي.
- استرجاعها يعيدها إلى `active`، ولا يرفع confidence تلقائيًا.
- تحديث Memory صراحةً يعيد تأكيدها ويحدّث `lastConfirmedAt`.

عند استبدال قيمة قديمة:

1. لا يتم overwrite صامت بلا provenance.
2. تحفظ العلاقة `supersedes` أو سبب الاستبدال.
3. القيمة القديمة تصبح archived أو superseded بعد تأكيد القيمة الجديدة.
4. لا يتم حذف المصدر التاريخي.

---

## 10. Candidate promotion rules

### promotion مسموح في حالتين فقط

#### أ. تصريح مستخدم مباشر

أمر واضح مثل «احفظ» أو «افتكر» يمكنه إنشاء Final Memory مباشرة، بشرط:

- parser حدد النوع.
- key/value غير فارغين.
- tenant/user ownership صحيح.
- لا يوجد نوع ممنوع.
- association المطلوبة موجودة أو يتحول الطلب إلى clarification.

#### ب. مراجعة صريحة

Candidate الناتج من extraction أو correction لا يصبح Final Memory إلا بعد:

- مراجعة بشرية صريحة.
- قبول النوع والقيمة.
- التحقق من association.
- فحص conflict مع Structured Records.
- حفظ reviewer decision ووقت القرار.

### promotion ممنوع

- لا يجوز promotion تلقائي اعتمادًا على LLM confidence.
- لا يجوز promotion تلقائي من Learning Signal approved إلى production Memory.
- لا يجوز promotion بسبب تكرار نفس العبارة وحده.
- لا يجوز promotion إذا كان المرشح يمثل رقمًا أو status من Structured
  Records.

---

## 11. Retrieval trace contract

كل تشغيل للـSecretary يقرر retrieval يجب أن ينتج trace داخليًا، حتى لو لم تدخل
أي Memory إلى context.

### الشكل المقترح

```json
{
  "traceId": "uuid",
  "requestId": "string",
  "conversationId": "string|null",
  "strategy": "none | lexical_v1 | entity_v1 | explicit_recall",
  "triggered": true,
  "queryDomain": "preference | personal_fact | entity_resolution | structured_record_read | structured_record_mutation | general_conversation | memory_recall",
  "consideredCount": 12,
  "selected": [
    {
      "memoryId": "uuid",
      "kind": "preference",
      "relevanceScore": 0.94,
      "confidence": 1,
      "association": {
        "entityType": "project",
        "entityId": "uuid"
      },
      "provenance": {
        "sourceType": "explicit_user",
        "sourceConversationId": "string",
        "sourceTurnId": "string"
      }
    }
  ],
  "excluded": [
    {
      "memoryId": "uuid",
      "reason": "archived | low_confidence | unrelated | conflict_structured_record | missing_entity_association | type_not_allowed | budget"
    }
  ],
  "structuredPrecedence": {
    "applied": true,
    "domain": "financial_record",
    "conflicts": []
  },
  "llmContextIncluded": true,
  "llmContextReason": "relevant_active_memories"
}
```

### قواعد trace

- trace لا يحتوي قيمة سرية أو credential.
- trace لا يرفع Memory إلى authority.
- trace يجب أن يميز بين:
  - لم يتم تشغيل retrieval.
  - تم تشغيله ولم يجد شيئًا.
  - وجد Memory لكنه استبعدها.
  - اختار Memory وأدخلها context.
- `selected` هو ما دخل context فعليًا، وليس كل ما أعاده SQL.
- إذا حدث conflict، يجب أن يظهر سبب الاستبعاد.

---

## 12. Structured Record precedence contract

قبل أي LLM call، Secretary Brain يجب أن يقرر إن كان الطلب من النوع الذي يحتاج
Structured Record truth.

### إذا كان نعم

1. resolve entity من Structured Records.
2. استخدم aliases فقط للمساعدة في resolution.
3. نفّذ deterministic scoped read أو اطرح clarification.
4. لا تستخدم Memory لتكوين الإجابة المالية.
5. لا ترسل Memory إلى LLM إلا إذا كانت preference خاصة بالعرض وليست جزءًا من
   الحقيقة نفسها.

### إذا كان لا

1. يمكن تشغيل Second Brain retrieval.
2. يجب تطبيق status/confidence/relevance/provenance gates.
3. يمكن إرسال memories المختارة فقط إلى LLM.

### مصفوفة precedence

| نوع الطلب | Structured Record | Second Brain | LLM |
|---|---:|---:|---:|
| «كام دفعت لمشروع X؟» | authoritative | alias فقط إن لزم | لا يلزم |
| «اعرضها مختصرة» | مصدر الأرقام | preference للتنسيق | يمكن للتعبير |
| «أنا أفضل الردود المختصرة» | غير متعلق | authoritative للتفضيل | يمكن تطبيقه |
| «مين عليّ فلوس؟» | authoritative | لا يحدد المبلغ | لا يلزم إذا deterministic |
| «فاكر أنا بحب إيه؟» | غير متعلق | authoritative ضمن active memories | يمكن استخدامه |
| «المشروع X اسمه المختصر Y» | يثبت canonical entity | alias بعد التحقق | لا يلزم |

---

## 13. متى تدخل Memory إلى LLM context؟

تدخل فقط إذا تحققت **كل** الشروط التالية:

1. `status = active`.
2. نفس `tenantId` و`ownerUserId`.
3. النوع مسموح لهذا domain.
4. confidence اجتازت الحد الأدنى.
5. relevance مثبتة بقاعدة من قواعد القسم 5.
6. association موجودة إذا كان الطلب entity-specific.
7. لا يوجد conflict مع Structured Record.
8. ليست Candidate أو Learning Signal.
9. لم تتجاوز memory/context budget.
10. تم تسجيلها في retrieval trace كـ`selected`.

### حالات تدخل فيها غالبًا

- تفضيل تنسيق عندما يطلب المستخدم تقريرًا أو ردًا.
- preference له علاقة بالـchannel أو اللغة.
- fact شخصي مرتبط بسؤال شخصي مباشر.
- alias exact لتحديد entity قبل قراءة Structured Records.
- explicit memory recall.

---

## 14. متى لا تدخل Memory إلى LLM context؟

لا تدخل في الحالات التالية:

- `status = archived`.
- Candidate غير مراجع.
- confidence أقل من الحد الأدنى.
- لا توجد علاقة بالطلب.
- association مطلوبة لكنها مفقودة أو ambiguous.
- تتعارض مع Structured Record في نفس المجال.
- تمثل amount/status/date/financial state بدل Structured Record.
- طلب المستخدم deterministic ويمكن حله من Structured Records.
- ستتجاوز budget بدون فائدة relevance واضحة.
- الذاكرة تحتوي secret أو credential أو بيانات لا يسمح بها النظام.

في حالة عدم الإدخال، لا ينبغي أن يتظاهر Secretary بأنه استخدمها. يجب أن يظهر
سبب الاستبعاد في trace الداخلي، ويطلب clarification إذا كان الاستبعاد يمنع
إجابة آمنة.

---

## 15. Public API boundary

### Final Memory API الحالي

يمكن أن يستمر في دعم:

- list active/archived memories.
- archive.
- restore.

لكن العقد المستقبلي يجب أن يضيف، عند الحاجة:

- `sourceType`.
- association structured.
- `lastConfirmedAt`.
- `supersedesMemoryId` أو equivalent history link.

### Candidate API المستقبلي

يجب أن يكون additive ومنفصلًا:

```text
GET    /memory-candidates
POST   /memory-candidates/{id}/approve
POST   /memory-candidates/{id}/reject
POST   /memory-candidates/{id}/needs-context
```

لا يجوز إعادة استخدام `POST /memories` للـCandidate؛ لأن ذلك يخلط بين اقتراح
غير موثوق وFinal Memory قابلة للاستخدام.

---

## 16. مطابقة السياسة مع الوضع الحالي

| المجال | الوضع الحالي | الفجوة |
|---|---|---|
| Context injection | موجود | يحتاج policy gate قبل الإدخال |
| Tenant/user scoping | موجود | يستمر كشرط غير قابل للتفاوض |
| Active filtering | موجود | يجب أن يصبح جزءًا من contract صريح |
| Lexical relevance | موجود | يحتاج domain/entity/confidence gates |
| Broad recall | موجود | يجب عزله عن structured requests |
| Confidence storage | موجود | لا يدخل القرار بعد |
| Provenance storage | موجود جزئيًا | لا يدخل ranking/conflict/trace بعد |
| Structured precedence | موجود في بعض deterministic paths | يحتاج قاعدة عامة لكل LLM path |
| Alias resolution | موجود | يحتاج entityId association وambiguous policy |
| Candidate review | Learning Signals موجودة | لا يوجد Memory Candidate API |
| Retrieval trace | غير مكتمل | يحتاج contract مستقل |
| Lifecycle | active/archived موجود | يحتاج promotion/history semantics |

---

## 17. Acceptance criteria لـPolicy v1

تعتبر السياسة منفذة فقط إذا نجحت الحالات التالية:

1. Memory عن تفضيل الرد المختصر تدخل في سؤال مناسب ولا تدخل في سؤال مالي
   غير متعلق.
2. Memory مؤرشفة لا تدخل retrieval ولا alias resolution.
3. Candidate لا يظهر في LLM context حتى بعد ارتفاع confidence.
4. سؤال مبلغ أو حالة دفع يستخدم Structured Record حتى لو وجدت Memory مخالفة.
5. Alias غير مرتبط بكيان يطلب clarification ولا يختار entity صامتًا.
6. Alias مرتبط بكيان يمرر `entityId` إلى resolver ولا يعتمد على الاسم وحده.
7. confidence منخفضة تؤدي إلى exclusion مسجل في trace.
8. provenance يظهر في trace ويمكن فتح مصدره للمراجعة.
9. structured deterministic response لا يمرر Memory إلى LLM لتحديد الرقم.
10. promotion يحتاج إما explicit user instruction أو review صريح.
11. archive ثم restore لا يرفع confidence ولا يغير provenance.
12. كل قرار retrieval يمكن تفسيره من `selected` و`excluded` وسبب القرار.

---

## 18. ترتيب التنفيذ المقترح

### المرحلة A — Policy enforcement

- استخراج `MemoryPolicyDecision` منفصلة عن SQL retrieval.
- إضافة domain/type/confidence/relevance gates.
- منع Memory من financial truth paths.

### المرحلة B — Conflict and entity safety

- إضافة association typed.
- إضافة structured precedence checks.
- جعل alias غير المرتبط Candidate بدل Final Memory.

### المرحلة C — Retrieval trace

- إنشاء trace داخلي bounded.
- تسجيل selected/excluded وأسبابها.
- إضافة correlation مع request/conversation.

### المرحلة D — Candidate layer

- جدول Candidate منفصل.
- review endpoints.
- promotion transaction إلى Final Memory.
- منع auto-apply تمامًا.

### المرحلة E — Verification

- اختبارات policy matrix.
- اختبارات tenant isolation.
- اختبارات stale Memory مقابل أحدث Structured Record.
- اختبارات candidate لا يصل إلى LLM.
- اختبارات ambiguity في aliases.

---

## القرار النهائي

Second Brain Policy v1 يجب أن يعامل Second Brain كـ**مصدر سياق شخصي محدود
ومشروط**، لا كمصدر حقيقة عام.

العقد الملزم هو:

> لا تدخل Memory إلى Secretary LLM context لمجرد أنها active أو قريبة نصيًا.
> تدخل فقط بعد status وconfidence وrelevance وentity association وconflict
> precedence، مع provenance قابل للتدقيق. Structured Records تفوز دائمًا في
> الحالة التشغيلية والمالية. Candidate لا يملك أي سلطة قبل promotion صريح.
