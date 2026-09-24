/**
 * A deliberately small, side-effect-free decision layer.  It does not read
 * observations, persist decisions, or contact a provider.
 */
export type ProactiveAction = "ignore" | "inform" | "remind" | "offer_help" | "request_approval";
export type CommunicationStyle = "formal" | "friendly" | "concise" | "balanced";
export type ProactiveLanguage = "ar" | "en";

export type ProactivePreferences = {
  style?: CommunicationStyle;
  language?: ProactiveLanguage;
  repeatPermission?: boolean;
};

export type DeliveryRecord = {
  deadline?: string;
  version?: string | number;
  window?: string;
  status?: "sent" | "rejected";
  evidenceVersion?: string | number;
};

export type ProactiveBase = {
  now?: string | Date;
  style?: CommunicationStyle;
  language?: ProactiveLanguage;
  preferences?: ProactivePreferences;
  previousDeliveries?: readonly DeliveryRecord[];
  /** An observation is intentionally not consulted by this layer. */
  observations?: readonly unknown[];
  tenantId?: string;
  userId?: string;
};

export type ReminderInput = ProactiveBase & {
  kind: "reminder";
  reminder: {
    id: string;
    title: string;
    dueAt: string | Date;
    status?: "active" | "completed" | "cancelled";
    version?: string | number;
    window?: string;
    repeatPermission?: boolean;
  };
};

export type OverdueInput = ProactiveBase & {
  kind: "overdue";
  overdue: {
    id: string;
    title: string;
    dueAt: string | Date;
    status?: "active" | "completed" | "cancelled";
    level?: "low" | "normal" | "high" | "critical";
    proactiveLevel?: "low" | "balanced" | "high";
    temporarySuppression?: boolean;
    version?: string | number;
  };
};

export type RelationshipEvidence = {
  source: string;
  sourceId?: string;
  value: string;
  version?: string | number;
  structured?: boolean;
  trustedCandidate?: boolean;
};

export type RelationshipDiscoveryInput = ProactiveBase & {
  kind: "relationship_discovery";
  relationship: {
    candidate?: { id: string; name: string };
    evidence?: readonly RelationshipEvidence[];
    evidenceVersion?: string | number;
    rejectedEvidenceVersion?: string | number;
  };
};

export type AwarenessFact = {
  id: string;
  text: string;
  anchor: string;
  occurredAt?: string | Date;
  /** Structured facts only; free-form observations are not eligible. */
  structured?: boolean;
};

export type AwarenessInput = ProactiveBase & {
  kind: "awareness";
  awareness: { facts: readonly AwarenessFact[] };
};

export type AssistanceCapability = {
  id: string;
  name: string;
  /** True when invoking this capability changes data or needs confirmation. */
  mutation?: boolean;
  approvalRequired?: boolean;
};

export type AssistanceInput = ProactiveBase & {
  kind: "assistance";
  assistance: {
    capability?: AssistanceCapability;
    inputs?: Readonly<Record<string, unknown>>;
    context?: string;
    benefit?: string;
    requiredInputKeys?: readonly string[];
    inputComplete?: boolean;
  };
};

export type ProactiveInput =
  | ReminderInput
  | OverdueInput
  | RelationshipDiscoveryInput
  | AwarenessInput
  | AssistanceInput;

export type FactualPayload = Readonly<Record<string, unknown>>;

export type ProactiveDecision = {
  action: ProactiveAction;
  factualPayload: FactualPayload;
  renderedText: string;
  reason: string;
};

const day = 24 * 60 * 60 * 1000;

function date(value: string | Date | undefined, fallback = new Date(0)): Date {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? fallback);
  return Number.isNaN(result.getTime()) ? fallback : result;
}
function styleOf(input: ProactiveBase): CommunicationStyle {
  return input.preferences?.style ?? input.style ?? "balanced";
}
function languageOf(input: ProactiveBase): ProactiveLanguage {
  return input.preferences?.language ?? input.language ?? "ar";
}
function seen(input: ProactiveBase, key: { deadline?: string; version?: string | number; window?: string }): boolean {
  return (input.previousDeliveries ?? []).some((d) =>
    d.deadline === key.deadline && String(d.version ?? "") === String(key.version ?? "")
      && (d.window ?? "") === (key.window ?? ""));
}
function text(action: ProactiveAction, payload: FactualPayload, input: ProactiveBase): string {
  const title = typeof payload.title === "string" ? payload.title : "";
  const ar = languageOf(input) === "ar";
  const facts = Array.isArray(payload.facts)
    ? payload.facts.map((fact) => {
      const item = fact as { id?: string; text?: string };
      return `${item.id ?? ""}: ${item.text ?? ""}`.trim();
    }).join("; ")
    : "";
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.map((item) => {
      const entry = item as { source?: string; sourceId?: string; value?: string };
      return `${entry.sourceId ?? entry.source ?? ""}: ${entry.value ?? ""}`.trim();
    }).join("; ")
    : "";
  const candidate = payload.candidate && typeof payload.candidate === "object"
    ? (payload.candidate as { name?: string }).name ?? ""
    : "";
  const capability = typeof payload.capabilityName === "string" ? payload.capabilityName : title;
  const context = typeof payload.context === "string" ? payload.context : "";
  const benefit = typeof payload.benefit === "string" ? payload.benefit : "";
  const details = payload.kind === "awareness"
    ? facts
    : payload.kind === "relationship_discovery"
      ? [candidate, evidence].filter(Boolean).join(" | ")
      : payload.kind === "assistance"
        ? [capability, context, benefit].filter(Boolean).join(" — ")
        : title;
  if (action === "ignore") return ar ? "لا يوجد إجراء مطلوب." : "No action is required.";
  const style = styleOf(input);
  const phrasing: Record<CommunicationStyle, { approval: string; reminder: string; help: string; info: string }> = ar
    ? {
      formal: { approval: `يتطلب ${details || "هذا الإجراء"} موافقة رسمية؛ لا يحدث أي تغيير قبل الموافقة.`, reminder: `تنبيه رسمي: حان موعد ${details}.`, help: `هل ترغب أن أقدم المساعدة في ${details}؟`, info: `للعلم: ${details}.` },
      friendly: { approval: `هل توافق على ${details || "هذا الإجراء"}؟ لن يحدث أي تغيير قبل موافقتك.`, reminder: `تذكير لطيف: حان وقت ${details}.`, help: `هل تريد أن أساعدك في ${details}؟`, info: `لديك معلومة مهمة: ${details}.` },
      concise: { approval: `موافقة مطلوبة: ${details || "الإجراء"}؛ لا تغيير قبل الموافقة.`, reminder: `تذكير: ${details}.`, help: `هل تريد المساعدة: ${details}؟`, info: `معلومة: ${details}.` },
      balanced: { approval: `يتطلب ${details || "هذا الإجراء"} موافقة؛ لا يحدث تغيير قبل الموافقة.`, reminder: `تذكير: حان موعد ${details}.`, help: `يمكنني المساعدة في ${details}—هل ترغب؟`, info: `معلومة: ${details}.` },
    }
    : {
      formal: { approval: `${details || "This action"} requires formal approval; no change occurs before approval.`, reminder: `Formal reminder: ${details} is due.`, help: `Would you like support with ${details}?`, info: `For your information: ${details}.` },
      friendly: { approval: `Would you approve ${details || "this action"}? Nothing changes before your approval.`, reminder: `Friendly reminder: ${details} is due.`, help: `Would you like me to help with ${details}?`, info: `Here's something useful: ${details}.` },
      concise: { approval: `Approval needed: ${details || "action"}; no change before approval.`, reminder: `Reminder: ${details}.`, help: `Help with ${details}?`, info: `Info: ${details}.` },
      balanced: { approval: `${details || "This action"} requires approval; no change occurs before approval.`, reminder: `Reminder: ${details} is due.`, help: `I can help with ${details}—would you like that?`, info: `Information: ${details}.` },
    };
  if (action === "request_approval") return phrasing[style].approval;
  if (action === "remind") return phrasing[style].reminder;
  if (action === "offer_help") return phrasing[style].help;
  return phrasing[style].info;
}
function result(input: ProactiveBase, action: ProactiveAction, payload: FactualPayload, reason: string): ProactiveDecision {
  return { action, factualPayload: Object.freeze({ ...payload }), renderedText: text(action, payload, input), reason };
}

export function evaluateProactiveBehavior(input: ProactiveInput): ProactiveDecision {
  const now = date(input.now);
  if (input.kind === "reminder") {
    const r = input.reminder;
    const due = date(r.dueAt);
    const payload = { kind: "reminder", id: r.id, title: r.title, dueAt: due.toISOString(), version: r.version ?? null, window: r.window ?? null, status: r.status ?? "active" };
    if (r.status === "completed" || r.status === "cancelled") return result(input, "ignore", payload, "reminder_not_active");
    if (due.getTime() < now.getTime()) return result(input, "ignore", payload, "past_due_is_overdue");
    if (due.getTime() - now.getTime() > day) return result(input, "ignore", payload, "outside_next_24_hours");
    if (seen(input, { deadline: payload.dueAt, version: r.version, window: r.window }) && !(r.repeatPermission ?? input.preferences?.repeatPermission)) {
      return result(input, "ignore", payload, "already_delivered");
    }
    return result(input, "remind", payload, "due_within_next_24_hours");
  }
  if (input.kind === "overdue") {
    const o = input.overdue;
    const payload = { kind: "overdue", id: o.id, title: o.title, dueAt: date(o.dueAt).toISOString(), level: o.level ?? "normal", proactiveLevel: o.proactiveLevel ?? "balanced", version: o.version ?? null, status: o.status ?? "active" };
    if (o.status === "completed" || o.status === "cancelled") return result(input, "ignore", payload, "overdue_not_active");
    if (date(o.dueAt).getTime() > now.getTime()) return result(input, "ignore", payload, "overdue_not_due");
    if (o.temporarySuppression) return result(input, "ignore", payload, "temporarily_suppressed");
    return result(input, o.proactiveLevel === "low" ? "inform" : "offer_help", payload, "overdue_without_assuming_forgotten");
  }
  if (input.kind === "relationship_discovery") {
    const r = input.relationship;
    const evidence = [...(r.evidence ?? [])].filter((e) => e.structured !== false)
      .sort((a, b) => a.source.localeCompare(b.source));
    const sources = new Set(evidence.map((e) => e.sourceId ?? e.source));
    const payload = { kind: "relationship_discovery", candidate: r.candidate ?? null, evidence, evidenceVersion: r.evidenceVersion ?? null };
    if (!evidence.some((e) => e.trustedCandidate) && sources.size < 2) return result(input, "ignore", payload, "insufficient_explicit_evidence");
    if (r.rejectedEvidenceVersion !== undefined && String(r.rejectedEvidenceVersion) === String(r.evidenceVersion)) return result(input, "ignore", payload, "same_rejected_evidence_version");
    return result(input, "request_approval", { ...payload, title: r.candidate?.name ?? "relationship" }, "relationship_requires_approval");
  }
  if (input.kind === "awareness") {
    const facts = input.awareness.facts.filter((f) => f.structured !== false);
    const groups = new Map<string, AwarenessFact[]>();
    for (const fact of facts) groups.set(fact.anchor, [...(groups.get(fact.anchor) ?? []), fact]);
    const best = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))[0];
    const selected = (best?.[1] ?? []).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3);
    const payload = { kind: "awareness", anchor: best?.[0] ?? null, facts: selected };
    return result(input, selected.length >= 2 ? "inform" : "ignore", payload, selected.length >= 2 ? "common_structured_anchor" : "no_common_anchor");
  }
  const a = input.assistance;
  const required = a.requiredInputKeys ?? [];
  const completeByKeys = !!a.inputs && required.every((key) => Object.prototype.hasOwnProperty.call(a.inputs, key));
  const complete = !!a.capability && !!a.context?.trim() && !!a.benefit?.trim()
    && (a.inputComplete === true || (a.inputComplete !== false && completeByKeys));
  const payload = { kind: "assistance", capability: a.capability?.id ?? null, capabilityName: a.capability?.name ?? "", title: a.capability?.name ?? "", context: a.context ?? null, benefit: a.benefit ?? null };
  if (!complete) return result(input, "ignore", payload, "assistance_inputs_incomplete");
  if (a.capability!.mutation || a.capability!.approvalRequired) return result(input, "request_approval", payload, "capability_requires_approval");
  return result(input, "offer_help", payload, "concrete_capability_available");
}

export const decideProactiveBehavior = evaluateProactiveBehavior;