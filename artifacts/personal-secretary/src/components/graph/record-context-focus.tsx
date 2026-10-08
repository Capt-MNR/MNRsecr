import { useQueries } from "@tanstack/react-query";
import {
  getListTypedRelationshipsQueryOptions,
  type CommitmentRecord,
  type ExpenseRecord,
  type RecordsResponse,
  type RecordType,
  type ReminderRecord,
  type TaskRecord,
} from "@workspace/api-client-react";
import { ArrowLeft, MessageSquareText, UserRound } from "lucide-react";
import { askAboutRecordHref, entityPath, recordContextPath } from "./context-link";
import { ContextAvailabilityNote } from "./context-availability-note";

type RecordItem =
  | ExpenseRecord
  | TaskRecord
  | ReminderRecord
  | CommitmentRecord
  | RecordsResponse["people"][number]
  | RecordsResponse["projects"][number];

type RelationshipSpec = {
  relation: string;
  targetType: "person" | "project" | "task";
  targetIdField: "personId" | "projectId" | "taskId";
  collection: "people" | "projects" | "tasks";
};

const relationshipSpecs: Partial<Record<RecordType, RelationshipSpec[]>> = {
  task: [
    { relation: "task_people", targetType: "person", targetIdField: "personId", collection: "people" },
    { relation: "task_projects", targetType: "project", targetIdField: "projectId", collection: "projects" },
  ],
  reminder: [
    { relation: "reminder_people", targetType: "person", targetIdField: "personId", collection: "people" },
    { relation: "reminder_projects", targetType: "project", targetIdField: "projectId", collection: "projects" },
    { relation: "reminder_tasks", targetType: "task", targetIdField: "taskId", collection: "tasks" },
  ],
  commitment: [
    { relation: "commitment_people", targetType: "person", targetIdField: "personId", collection: "people" },
    { relation: "commitment_projects", targetType: "project", targetIdField: "projectId", collection: "projects" },
  ],
};

function recordLabel(type: RecordType, record: RecordItem) {
  if (type === "expense") return (record as ExpenseRecord).description;
  if (type === "task" || type === "commitment") return (record as TaskRecord | CommitmentRecord).title;
  if (type === "reminder") return (record as ReminderRecord).text;
  if (type === "person" || type === "project") {
    return (record as RecordsResponse["people"][number] | RecordsResponse["projects"][number]).name;
  }
  return "السجل";
}

function formatDate(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const labels: Record<string, string> = {
    active: "نشط",
    archived: "مؤرشف",
    pending: "قيد الانتظار",
    in_progress: "جارٍ",
    completed: "مكتمل",
    cancelled: "ملغى",
    scheduled: "مجدول",
    open: "مفتوح",
  };
  return labels[value] ?? value;
}

function contextFields(type: RecordType, record: RecordItem): Array<[string, string]> {
  const value = record as unknown as Record<string, unknown>;
  const fields: Array<[string, string]> = [];
  const push = (label: string, field: string, formatter = (input: unknown) => typeof input === "string" ? input : "") => {
    const formatted = formatter(value[field]);
    if (formatted) fields.push([label, formatted]);
  };

  if (type === "expense") {
    const expense = record as ExpenseRecord;
    fields.push(["المبلغ", new Intl.NumberFormat("ar-EG", { style: "currency", currency: expense.currency }).format(expense.amountMinor / 100)]);
    push("تاريخ المصروف", "occurredAt", formatDate);
    push("الغرض", "purposeName");
    push("الشخص المرتبط", "personName");
    push("المشروع المرتبط", "projectName");
  } else if (type === "task" || type === "commitment" || type === "project") {
    push("الحالة", "status", statusLabel);
    push("الموعد", "dueAt", formatDate);
    push("آخر تحديث", "updatedAt", formatDate);
    if (type === "commitment") push("الشخص المرتبط", "personName");
  } else if (type === "reminder") {
    push("الحالة", "status", statusLabel);
    push("الموعد", "dueAt", formatDate);
    push("المنطقة الزمنية", "timezone");
  } else if (type === "person") {
    push("الهاتف", "phone");
    push("ملاحظات مسجلة", "notes");
  }

  return fields;
}

function originFor(record: RecordItem) {
  const origin = (record as { origin?: unknown }).origin;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) return null;
  const value = origin as Record<string, unknown>;
  return typeof value.conversationId === "string" && value.conversationId
    ? { conversationId: value.conversationId, turnId: typeof value.turnId === "string" ? value.turnId : null }
    : null;
}

function targetRecord(spec: RelationshipSpec, id: string, records: RecordsResponse) {
  const row = records[spec.collection].find((candidate) => candidate.id === id);
  if (!row) return null;
  if (spec.targetType === "person") {
    const person = row as RecordsResponse["people"][number];
    return { id, type: "person" as const, name: person.name, detail: person.notes || person.phone || "شخص مرتبط" };
  }
  if (spec.targetType === "project") {
    const project = row as RecordsResponse["projects"][number];
    return { id, type: "project" as const, name: project.name, detail: statusLabel(project.status) || "مشروع مرتبط" };
  }
  const task = row as RecordsResponse["tasks"][number];
  return { id, type: "task" as const, name: task.title, detail: statusLabel(task.status) || "مهمة مرتبطة" };
}

export function RecordContextFocus({
  record,
  recordType,
  records,
  onNavigate,
  onClose,
  onOpenConversation,
}: {
  record: RecordItem;
  recordType: RecordType;
  records: RecordsResponse;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onOpenConversation: (origin: { conversationId: string; turnId: string | null }) => void;
}) {
  const specs = relationshipSpecs[recordType] ?? [];
  const relationshipQueries = useQueries({
    queries: specs.map((spec) => getListTypedRelationshipsQueryOptions(
      { relation: spec.relation, side: "left", entityId: record.id },
    )),
  });

  const linkedById = new Map<string, NonNullable<ReturnType<typeof targetRecord>>>();
  let unresolvedRelationship = false;
  relationshipQueries.forEach((query, index) => {
    const spec = specs[index];
    const payload = query.data as { relationships?: Array<Record<string, unknown>> } | undefined;
    for (const edge of payload?.relationships ?? []) {
      const id = edge[spec.targetIdField];
      if (typeof id !== "string" || !id) continue;
      const target = targetRecord(spec, id, records);
      if (target) linkedById.set(`${target.type}:${target.id}`, target);
      else unresolvedRelationship = true;
    }
  });

  const directLinks: Array<{ id: string; type: "person" | "project"; label: string }> = [];
  if (recordType === "expense") {
    const expense = record as ExpenseRecord;
    if (expense.personId && records.people.some((person) => person.id === expense.personId)) {
      directLinks.push({ id: expense.personId, type: "person", label: expense.personName || "الشخص المرتبط" });
    }
    if (expense.projectId && records.projects.some((project) => project.id === expense.projectId)) {
      directLinks.push({ id: expense.projectId, type: "project", label: expense.projectName || "المشروع المرتبط" });
    }
  } else if (recordType === "commitment") {
    const commitment = record as CommitmentRecord;
    if (commitment.personId && records.people.some((person) => person.id === commitment.personId)) {
      directLinks.push({ id: commitment.personId, type: "person", label: commitment.personName || "الشخص المرتبط" });
    }
  }

  const title = recordLabel(recordType, record);
  const fields = contextFields(recordType, record);
  const origin = originFor(record);
  const hasRelationshipQuery = specs.length > 0;
  const isRelationshipsLoading = relationshipQueries.some((query) => query.isLoading);
  const hasRelationshipError = relationshipQueries.some((query) => query.isError);
  const supportsOrigin = recordType === "expense" || recordType === "task" || recordType === "reminder";

  return (
    <section
      className="rounded-2xl border border-primary/25 bg-primary/[0.035] p-4 sm:p-5"
      aria-label="سياق السجل المحدد"
      data-testid="record-context-focus"
      dir="rtl"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">سياق من سجلك المحفوظ</p>
          <h2 className="mt-1 break-words font-serif text-xl">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            هذه معلومات السجل المحفوظ؛ لا أخلطها بذاكرة أو استنتاج غير مرتبط.
          </p>
        </div>
        <button type="button" onClick={onClose} className="min-h-10 shrink-0 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-primary">
          إخفاء التفاصيل
        </button>
      </header>

      {fields.length > 0 && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-card px-3 py-2.5">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(directLinks.length > 0 || hasRelationshipQuery) && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <h3 className="text-xs font-semibold">العلاقات المسجلة</h3>
          {isRelationshipsLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">جارٍ تحميل العلاقات المحفوظة…</p>
          ) : hasRelationshipError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">تعذر تحميل العلاقات المسجلة لهذا السجل.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {directLinks.map((link) => (
                <button key={`${link.type}:${link.id}`} type="button" onClick={() => onNavigate(entityPath(link.type, link.id))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs hover:border-primary/40 hover:text-primary">
                  <UserRound className="size-3.5" /> {link.label}
                </button>
              ))}
              {[...linkedById.values()].map((link) => (
                <button
                  key={`${link.type}:${link.id}`}
                  type="button"
                  onClick={() => onNavigate(link.type === "task" ? recordContextPath("tasks", link.id) : entityPath(link.type, link.id))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs hover:border-primary/40 hover:text-primary"
                >
                  <ArrowLeft className="size-3.5" /> {link.name} · {link.detail}
                </button>
              ))}
              {linkedById.size === 0 && directLinks.length === 0 && !unresolvedRelationship && !hasRelationshipError && (
                <p className="text-xs text-muted-foreground">لا توجد روابط مسجلة لهذا السجل.</p>
              )}
              {unresolvedRelationship && (
                <p className="text-xs text-muted-foreground">توجد علاقة مسجلة، لكن الطرف الآخر غير متاح في قائمة السجلات الحالية.</p>
              )}
            </div>
          )}
        </div>
      )}

      {supportsOrigin && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          {origin ? (
            <button
              type="button"
              onClick={() => onOpenConversation(origin)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary"
              data-testid="record-context-origin"
            >
              <MessageSquareText className="size-3.5" /> فتح المحادثة المرتبطة
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">لا توجد محادثة أصلية مرتبطة بهذا السجل.</p>
          )}
        </div>
      )}

      <div className="mt-4">
        <button type="button" onClick={() => onNavigate(askAboutRecordHref(recordType, record.id, title))} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="ask-secretary-about-record">
          <MessageSquareText className="size-4" /> اسأل السكرتير عن هذا السجل
        </button>
      </div>

      <div className="mt-4">
        <ContextAvailabilityNote />
      </div>
    </section>
  );
}
