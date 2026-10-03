import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OperationExecutionResult, PendingOperation } from "../secretary-operations";
import {
  makeExternalActionResult,
  type ExternalActionConnector,
  type ExternalActionConnectorResult,
  type ExternalActionExecutionContext,
  type ExternalActionOperationRecovery,
  type ExternalActionStatus,
} from "./external-action";
import { appendExternalActionEvent } from "./external-action-events";
import { createExternalActionIdentity, hashExternalActionValue } from "./action-contract";
import {
  EmailProviderError,
  stableEmailMessageId,
  type EmailProviderAdapter,
  type EmailProviderReference,
  type EmailProviderVerification,
} from "./email-provider";
import type {
  AgentWorkEventRecord,
  AgentWorkIdentity,
  AgentWorkRecord,
  AgentWorkRunRecord,
} from "./types";

export const EMAIL_APPROVAL_TOOL = "email_send";

const emailActionContentSchema = z.object({
  type: z.literal("send_email"),
  recipient: z.string().trim().email().max(320),
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n\0]/u.test(value)),
  body: z.string().min(1).max(20_000),
  attachmentRef: z.string().trim().min(1).max(500).optional(),
}).strict();

const storedEmailActionSchema = emailActionContentSchema.extend({
  actionId: z.string().uuid(),
  setupApprovalOperationId: z.string().uuid(),
}).strict();

const stepSchema = z.object({
  actionId: z.string().uuid(),
  stepId: z.string().regex(/^step_[a-f0-9]{48}$/u),
  idempotencyKey: z.string().regex(/^agent-action:[a-f0-9]{64}$/u),
  kind: z.literal("send_email"),
}).strict();

const approvalArgsSchema = z.object({
  workId: z.string().uuid(),
  runId: z.string().uuid(),
  actionId: z.string().uuid(),
  setupApprovalOperationId: z.string().uuid(),
  provider: z.literal("email"),
  actionType: z.literal("send_email"),
  action: storedEmailActionSchema,
  approvedActionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  plan: z.array(stepSchema).length(1),
}).strict();

type EmailAction = z.infer<typeof storedEmailActionSchema>;
type EmailApprovalArgs = z.infer<typeof approvalArgsSchema>;
type EmailStep = z.infer<typeof stepSchema>;
type FakeEmailOutcome =
  | "accepted"
  | "rejected"
  | "timeout_before_ack"
  | "accepted_ack_lost";

type FakeEmailMessage = {
  messageId: string;
  recipient: string;
  subject: string;
  body: string;
  attachmentRef?: string;
  idempotencyKey: string;
};

class FakeEmailTransportError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "rejected" | "unknown_result",
    readonly providerReference?: EmailProviderReference,
  ) {
    super(code);
    this.name = "FakeEmailTransportError";
  }
}

/**
 * In-memory test transport. It deliberately has no network access or credentials.
 * The registry exposes it only while the API test suite opts in explicitly.
 */
export const fakeEmailTransportForTests = {
  outcome: "accepted" as FakeEmailOutcome,
  requestCount: 0,
  messages: new Map<string, FakeEmailMessage>(),
  reset(outcome: FakeEmailOutcome = "accepted") {
    this.outcome = outcome;
    this.requestCount = 0;
    this.messages.clear();
  },
  async send(input: Omit<FakeEmailMessage, "messageId">): Promise<{ messageId: string }> {
    this.requestCount += 1;
    if (this.outcome === "rejected") {
      throw new FakeEmailTransportError("EMAIL_PROVIDER_REJECTED", "rejected");
    }
    if (this.outcome === "timeout_before_ack") {
      throw new FakeEmailTransportError("EMAIL_TIMEOUT_BEFORE_ACK", "unknown_result");
    }

    let message = this.messages.get(input.idempotencyKey);
    if (!message) {
      message = { ...input, messageId: `fake-message-${randomUUID()}` };
      this.messages.set(input.idempotencyKey, message);
    }
    if (this.outcome === "accepted_ack_lost") {
      throw new FakeEmailTransportError(
        "EMAIL_ACCEPTED_ACK_LOST",
        "unknown_result",
        { messageId: message.messageId },
      );
    }
    return { messageId: message.messageId };
  },
};

const fakeEmailProviderAdapter: EmailProviderAdapter = {
  async send(input) {
    try {
      const accepted = await fakeEmailTransportForTests.send({
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        ...(input.attachmentRef ? { attachmentRef: input.attachmentRef } : {}),
        idempotencyKey: input.idempotencyKey,
      });
      return {
        messageId: accepted.messageId,
        stableMessageId: input.stableMessageId,
      };
    } catch (error) {
      if (error instanceof FakeEmailTransportError) {
        throw new EmailProviderError(error.code, error.outcome, error.providerReference);
      }
      throw new EmailProviderError("EMAIL_TRANSPORT_OUTCOME_UNKNOWN", "unknown_result", {
        stableMessageId: input.stableMessageId,
      });
    }
  },
  async verify(input): Promise<EmailProviderVerification> {
    if (fakeEmailTransportForTests.outcome === "accepted_ack_lost") {
      return {
        state: "unknown_result",
        method: "fake_provider_message_lookup",
        reason: "ACKNOWLEDGEMENT_LOST",
        providerReference: input.providerReference,
      };
    }
    const message = [...fakeEmailTransportForTests.messages.values()]
      .find((item) => item.messageId === input.providerReference?.messageId);
    if (!message
      || message.idempotencyKey !== input.idempotencyKey
      || message.recipient !== input.recipient
      || message.subject !== input.subject) {
      return {
        state: "unknown_result",
        method: "fake_provider_message_lookup",
        reason: "MESSAGE_NOT_CONFIRMED",
        providerReference: input.providerReference,
      };
    }
    return {
      state: "verified",
      method: "fake_provider_acceptance",
      providerReference: input.providerReference,
    };
  },
  async reconcile(input): Promise<EmailProviderVerification> {
    if (fakeEmailTransportForTests.outcome === "accepted_ack_lost") {
      return {
        state: "unknown_result",
        method: "fake_sent_search",
        reason: "ACKNOWLEDGEMENT_LOST",
        providerReference: input.providerReference,
      };
    }
    return {
      state: "unknown_result",
      method: "fake_sent_search",
      reason: "NO_MATCH",
      providerReference: input.providerReference,
    };
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function actionPlan(input: {
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  action: EmailAction;
}): EmailStep[] {
  const identity = createExternalActionIdentity({
    tenantId: input.identity.tenantId,
    ownerUserId: input.identity.userId,
    workId: input.workId,
    runId: input.runId,
    approvalOperationId: "pending",
    actionId: input.action.actionId,
    stepKey: "send_email",
    actionVersion: "email-v1",
  });
  return [{
    actionId: input.action.actionId,
    stepId: identity.stepId,
    idempotencyKey: identity.idempotencyKey,
    kind: "send_email",
  }];
}

function approvedActionHash(action: EmailAction, plan: EmailStep[]): string {
  return hashExternalActionValue({
    provider: "email",
    actionType: "send_email",
    action,
    plan,
  });
}

function emailApprovalDisplay(action: EmailAction): { title: string; details: string[] } {
  return {
    title: "مراجعة رسالة البريد الإلكتروني",
    details: [
      `إلى: ${action.recipient}`,
      `الموضوع: ${action.subject}`,
      `النص: ${action.body}`,
      ...(action.attachmentRef ? [`مرجع المرفق: ${action.attachmentRef}`] : []),
      "لن تُرسل الرسالة إلا بعد الموافقة على الإجراء.",
    ],
  };
}

function argsForOperation(operation: PendingOperation): EmailApprovalArgs {
  return approvalArgsSchema.parse(operation.args);
}

function resultFor(input: {
  operationId: string;
  conversationId: string | null;
  args: EmailApprovalArgs;
  status: ExternalActionStatus;
  verification: Record<string, unknown>;
  providerReference?: Record<string, unknown>;
  evidenceReference?: string;
  error?: { code: string; outcome: "rejected" | "failed" | "unknown_result" };
}): OperationExecutionResult {
  const step = input.args.plan[0]!;
  const externalAction = {
    provider: "email",
    actionType: "send_email",
    status: input.status,
    workId: input.args.workId,
    runId: input.args.runId,
    approvalOperationId: input.operationId,
    actionId: input.args.actionId,
    stepId: step.stepId,
    ...(input.providerReference ? { providerReference: input.providerReference } : {}),
    verification: input.verification,
    ...(input.evidenceReference ? { evidenceReference: input.evidenceReference } : {}),
    ...(input.error ? {
      error: {
        ...input.error,
        retryable: false,
        reviewRequired: input.status !== "verified",
      },
    } : {}),
    ...(input.status === "unknown_result" ? { retryable: false, reviewRequired: true } : {}),
  };
  return {
    conversationId: input.conversationId ?? `agent-work:${input.args.workId}`,
    assistantMessage: input.status === "verified"
      ? "تم التحقق من قبول رسالة البريد بواسطة الموفّر."
      : input.status === "unknown_result"
        ? "نتيجة إرسال البريد غير مؤكدة؛ لم تتم إعادة المحاولة، والعمل يحتاج إلى مراجعة."
        : "تعذر إرسال رسالة البريد؛ لم تُسجل كمرسلة.",
    action: {
      type: `email_action_${input.status}`,
      actionState: input.status,
      operationId: input.operationId,
      workId: input.args.workId,
      runId: input.args.runId,
      actionId: input.args.actionId,
      stepId: step.stepId,
      externalAction,
    },
    provider: "email",
    model: "external-email-connector",
  };
}

function operationResultFromEvent(
  operationId: string,
  operationArgs: Record<string, unknown>,
  event: AgentWorkEventRecord,
  status: ExternalActionStatus,
): OperationExecutionResult | null {
  const parsed = approvalArgsSchema.safeParse(operationArgs);
  if (!parsed.success) return null;
  const metadata = asRecord(event.metadata);
  const providerReference = asRecord(metadata.providerReference);
  const verification = asRecord(metadata.verification);
  const errorRecord = asRecord(metadata.error);
  const code = typeof errorRecord.code === "string" ? errorRecord.code : `EMAIL_${status.toUpperCase()}`;
  return resultFor({
    operationId,
    conversationId: null,
    args: parsed.data,
    status,
    verification,
    ...(Object.keys(providerReference).length ? { providerReference } : {}),
    evidenceReference: event.id,
    ...(status !== "verified" ? {
      error: {
        code,
        outcome: status === "unknown_result"
          ? "unknown_result"
          : errorRecord.outcome === "rejected" ? "rejected" : "failed",
      },
    } : {}),
  });
}

function eventStatus(event: AgentWorkEventRecord): ExternalActionStatus | null {
  if (event.eventType === "external_action_step_verified") return "verified";
  if (event.eventType === "external_action_step_failed") return "failed";
  if (event.eventType === "external_action_unknown_result") return "unknown_result";
  return null;
}

function eventsForApproval(
  events: AgentWorkEventRecord[],
  approvalOperationId: string,
): AgentWorkEventRecord[] {
  return events
    .filter((event) => asRecord(event.metadata).approvalOperationId === approvalOperationId)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function recoverEmailOperation(input: {
  events: AgentWorkEventRecord[];
  approvalOperationId: string;
  operationArgs: Record<string, unknown>;
}): ExternalActionOperationRecovery {
  const args = approvalArgsSchema.safeParse(input.operationArgs);
  if (!args.success) return { state: "failed", reason: "EMAIL_APPROVAL_ARGS_INVALID" };
  const step = args.data.plan[0]!;
  const events = eventsForApproval(input.events, input.approvalOperationId);
  const terminal = [...events].reverse().find((event) => {
    const metadata = asRecord(event.metadata);
    return metadata.stepId === step.stepId && eventStatus(event) !== null;
  });
  if (terminal) {
    const status = eventStatus(terminal)!;
    const result = operationResultFromEvent(
      input.approvalOperationId,
      input.operationArgs,
      terminal,
      status,
    );
    if (!result) return { state: "failed", reason: "EMAIL_APPROVAL_ARGS_INVALID" };
    return status === "verified"
      ? { state: "verified", result }
      : status === "unknown_result"
        ? { state: "unknown_result", result }
        : { state: "failed", reason: String(asRecord(asRecord(terminal.metadata).error).code ?? "EMAIL_PROVIDER_REJECTED") };
  }
  const hasStarted = events.some((event) => {
    const metadata = asRecord(event.metadata);
    return event.eventType === "external_action_step_started"
      && metadata.stepId === step.stepId;
  });
  if (!hasStarted) return { state: "safe_to_retry" };
  return {
    state: "unknown_result",
    result: resultFor({
      operationId: input.approvalOperationId,
      conversationId: null,
      args: args.data,
      status: "unknown_result",
      verification: { state: "unknown_result", reason: "EMAIL_STEP_RECEIPT_MISSING" },
      error: { code: "EMAIL_STEP_RECEIPT_MISSING", outcome: "unknown_result" },
    }),
  };
}

function connectorResultForRecovery(
  recovery: ExternalActionOperationRecovery,
): ExternalActionConnectorResult<OperationExecutionResult> | null {
  if (recovery.state === "safe_to_retry") return null;
  if (recovery.state === "verified") {
    const externalAction = asRecord(asRecord(recovery.result.action).externalAction);
    const providerReference = asRecord(externalAction.providerReference);
    return makeExternalActionResult({
      status: "verified",
      executionResult: recovery.result,
      ...(Object.keys(providerReference).length ? { providerReference } : {}),
      verification: asRecord(externalAction.verification),
      ...(typeof externalAction.evidenceReference === "string"
        ? { evidenceReference: externalAction.evidenceReference }
        : {}),
    });
  }
  if (recovery.state === "unknown_result") {
    const externalAction = asRecord(asRecord(recovery.result.action).externalAction);
    const providerReference = asRecord(externalAction.providerReference);
    return makeExternalActionResult({
      status: "unknown_result",
      executionResult: recovery.result,
      ...(Object.keys(providerReference).length ? { providerReference } : {}),
      verification: asRecord(externalAction.verification),
      ...(typeof externalAction.evidenceReference === "string"
        ? { evidenceReference: externalAction.evidenceReference }
        : {}),
      error: {
        code: String(asRecord(externalAction.error).code ?? "EMAIL_RESULT_UNKNOWN"),
        outcome: "unknown_result",
        retryable: false,
        reviewRequired: true,
      },
    });
  }
  return makeExternalActionResult({
    status: "failed",
    error: {
      code: recovery.reason,
      outcome: "rejected",
      retryable: false,
      reviewRequired: true,
    },
  });
}

async function persistEmailEvent(input: {
  identity: AgentWorkIdentity;
  workId: string;
  runId: string;
  approvalOperationId: string;
  actionId: string;
  step: EmailStep;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  storage: ExternalActionExecutionContext["storage"];
}) {
  return appendExternalActionEvent({
    storage: input.storage,
    identity: input.identity,
    workId: input.workId,
    runId: input.runId,
    approvalOperationId: input.approvalOperationId,
    actionId: input.actionId,
    stepId: input.step.stepId,
    eventType: input.eventType,
    summary: input.summary,
    metadata: {
      ...input.metadata,
      idempotencyKey: input.step.idempotencyKey,
      step: input.step.kind,
    },
  });
}

function verifiedResult(
  operation: PendingOperation,
  args: EmailApprovalArgs,
  providerReference: Record<string, unknown>,
  eventId: string,
  verification: Record<string, unknown>,
): OperationExecutionResult {
  return resultFor({
    operationId: operation.operationId,
    conversationId: operation.conversationId,
    args,
    status: "verified",
    providerReference,
    verification,
    evidenceReference: eventId,
  });
}

function errorResult(
  operation: PendingOperation,
  args: EmailApprovalArgs,
  status: "failed" | "unknown_result",
  code: string,
  providerReference?: Record<string, unknown>,
  eventId?: string,
  outcome: "rejected" | "failed" | "unknown_result" = status === "unknown_result"
    ? "unknown_result"
    : "rejected",
): OperationExecutionResult {
  return resultFor({
    operationId: operation.operationId,
    conversationId: operation.conversationId,
    args,
    status,
    verification: {
      state: status,
      reason: code,
    },
    ...(providerReference ? { providerReference } : {}),
    ...(eventId ? { evidenceReference: eventId } : {}),
    error: {
      code,
      outcome,
    },
  });
}

async function executeEmailApproval(input: {
  identity: AgentWorkIdentity;
  operation: PendingOperation;
  storage: ExternalActionExecutionContext["storage"];
  providerAdapter: EmailProviderAdapter;
  supportsAttachmentRef: boolean;
}): Promise<ExternalActionConnectorResult<OperationExecutionResult>> {
  const args = argsForOperation(input.operation);
  const work = await input.storage.getWork(input.identity, args.workId);
  const run = await input.storage.getRun(input.identity, args.runId);
  if (!work || !run) throw new Error("EMAIL_APPROVAL_CONTEXT_MISSING");
  const storedAction = storedEmailActionSchema.parse(work.action);
  const expectedPlan = actionPlan({
    identity: input.identity,
    workId: work.id,
    runId: run.id,
    action: storedAction,
  });
  if (work.kind !== "external_action"
    || work.status !== "waiting"
    || asRecord(work.source).type !== "email"
    || run.workId !== work.id
    || args.workId !== work.id
    || args.runId !== run.id
    || args.provider !== "email"
    || args.actionType !== "send_email"
    || args.actionId !== storedAction.actionId
    || args.setupApprovalOperationId !== storedAction.setupApprovalOperationId
    || input.operation.toolName !== EMAIL_APPROVAL_TOOL
    || hashExternalActionValue(args.action) !== hashExternalActionValue(storedAction)) {
    throw new Error("EMAIL_APPROVAL_CONTEXT_MISMATCH");
  }
  if (hashExternalActionValue(args.plan) !== hashExternalActionValue(expectedPlan)) {
    throw new Error("EXTERNAL_ACTION_PLAN_MISMATCH");
  }
  if (approvedActionHash(storedAction, expectedPlan) !== args.approvedActionHash) {
    throw new Error("EXTERNAL_ACTION_APPROVED_CONTENT_HASH_MISMATCH");
  }
  if (storedAction.attachmentRef && !input.supportsAttachmentRef) {
    throw new Error("EMAIL_ATTACHMENT_UNSUPPORTED");
  }

  const events = await input.storage.listEvents(input.identity, work.id, 100);
  const recovery = recoverEmailOperation({
    events,
    approvalOperationId: input.operation.operationId,
    operationArgs: input.operation.args,
  });
  if (recovery.state === "unknown_result") {
    const step = expectedPlan[0]!;
    const priorExternalAction = asRecord(asRecord(recovery.result.action).externalAction);
    const priorReference = asRecord(priorExternalAction.providerReference) as EmailProviderReference;
    let reconciled: EmailProviderVerification | null = null;
    try {
      reconciled = await input.providerAdapter.reconcile({
        identity: input.identity,
        recipient: storedAction.recipient,
        subject: storedAction.subject,
        idempotencyKey: step.idempotencyKey,
        stableMessageId: stableEmailMessageId(step.stepId),
        providerReference: priorReference,
      });
    } catch {
      // A failed read never permits a resend.
    }
    if (reconciled?.state === "verified") {
      const providerReference = {
        ...priorReference,
        ...asRecord(reconciled.providerReference),
      };
      const verification = { state: "verified", method: reconciled.method };
      const event = await persistEmailEvent({
        ...input,
        workId: work.id,
        runId: run.id,
        approvalOperationId: input.operation.operationId,
        actionId: storedAction.actionId,
        step,
        eventType: "external_action_step_verified",
        summary: "أكد فحص الموفّر إرسال الرسالة سابقًا.",
        metadata: {
          actionState: "verified",
          approvedActionHash: args.approvedActionHash,
          providerReference,
          verification,
          reconciledFromUnknownResult: true,
        },
      });
      const executionResult = verifiedResult(
        input.operation,
        args,
        providerReference,
        event.id,
        verification,
      );
      return makeExternalActionResult({
        status: "verified",
        executionResult,
        providerReference,
        verification,
        evidenceReference: event.id,
      });
    }
    return connectorResultForRecovery(recovery)!;
  }
  const prior = connectorResultForRecovery(recovery);
  if (prior) return prior;

  const step = expectedPlan[0]!;
  await persistEmailEvent({
    ...input,
    workId: work.id,
    runId: run.id,
    approvalOperationId: input.operation.operationId,
    actionId: storedAction.actionId,
    step,
    eventType: "external_action_step_started",
    summary: "بدأت محاكاة إرسال البريد بعد الموافقة.",
    metadata: {
      actionState: "started",
      approvedActionHash: args.approvedActionHash,
    },
  });

  const stableMessageId = stableEmailMessageId(step.stepId);
  let providerReference: EmailProviderReference | undefined;
  let status: "verified" | "failed" | "unknown_result" = "unknown_result";
  let code = "EMAIL_PROVIDER_VERIFICATION_UNCONFIRMED";
  let outcome: "rejected" | "failed" | "unknown_result" = "unknown_result";
  let verification: Record<string, unknown> = {
    state: "unknown_result",
    reason: code,
  };
  const verificationInput = () => ({
    identity: input.identity,
    recipient: storedAction.recipient,
    subject: storedAction.subject,
    idempotencyKey: step.idempotencyKey,
    stableMessageId,
    ...(providerReference ? { providerReference } : {}),
  });
  const mergeVerification = (result: EmailProviderVerification) => {
    if (result.providerReference) {
      providerReference = { ...providerReference, ...result.providerReference };
    }
    verification = {
      state: result.state,
      method: result.method,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  };

  try {
    providerReference = await input.providerAdapter.send({
        identity: input.identity,
        recipient: storedAction.recipient,
        subject: storedAction.subject,
        body: storedAction.body,
        ...(storedAction.attachmentRef ? { attachmentRef: storedAction.attachmentRef } : {}),
        idempotencyKey: step.idempotencyKey,
        stableMessageId,
      });
    const checked = await input.providerAdapter.verify(verificationInput());
    mergeVerification(checked);
    if (checked.state === "verified") {
      status = "verified";
      code = "";
      outcome = "failed";
    } else {
      const reconciled = await input.providerAdapter.reconcile(verificationInput());
      mergeVerification(reconciled);
      status = reconciled.state === "verified" ? "verified" : "unknown_result";
      if (status === "verified") {
        code = "";
        outcome = "failed";
      }
    }
  } catch (error) {
    outcome = error instanceof EmailProviderError ? error.outcome : "unknown_result";
    code = error instanceof EmailProviderError
      ? error.code
      : "EMAIL_TRANSPORT_OUTCOME_UNKNOWN";
    if (error instanceof EmailProviderError) {
      if (error.providerReference) {
        providerReference = { ...providerReference, ...error.providerReference };
      }
    }
    status = outcome === "unknown_result" ? "unknown_result" : "failed";
    verification = { state: status, reason: code };

    if (status === "unknown_result") {
      try {
        const reconciled = await input.providerAdapter.reconcile(verificationInput());
        mergeVerification(reconciled);
        if (reconciled.state === "verified") {
          status = "verified";
          code = "";
          outcome = "failed";
        }
      } catch {
        // Uncertain provider outcomes stay unresolved; never send again here.
      }
    }
  }

  if (status === "verified") {
    const event = await persistEmailEvent({
      ...input,
      workId: work.id,
      runId: run.id,
      approvalOperationId: input.operation.operationId,
      actionId: storedAction.actionId,
      step,
      eventType: "external_action_step_verified",
      summary: "أكد الموفّر قبول رسالة البريد.",
      metadata: {
        actionState: "verified",
        approvedActionHash: args.approvedActionHash,
      providerReference: providerReference ?? { stableMessageId },
        verification,
      },
    });
    const executionResult = verifiedResult(
      input.operation,
      args,
      providerReference ?? { stableMessageId },
      event.id,
      verification,
    );
    return makeExternalActionResult({
      status: "verified",
      executionResult,
      providerReference: providerReference ?? { stableMessageId },
      verification,
      evidenceReference: event.id,
    });
  }

  const event = await persistEmailEvent({
    ...input,
    workId: work.id,
    runId: run.id,
    approvalOperationId: input.operation.operationId,
    actionId: storedAction.actionId,
    step,
    eventType: status === "failed"
      ? "external_action_step_failed"
      : "external_action_unknown_result",
    summary: status === "unknown_result"
      ? "نتيجة إرسال البريد غير مؤكدة؛ لن تتم إعادة المحاولة تلقائيًا."
      : "لم يقبل الموفّر إرسال رسالة البريد.",
    metadata: {
      actionState: status,
      approvedActionHash: args.approvedActionHash,
      providerReference,
      verification,
      error: {
        code,
        outcome,
        retryable: false,
        reviewRequired: true,
      },
    },
  });
  const executionResult = errorResult(
    input.operation,
    args,
    status,
    code,
    providerReference,
    event.id,
    outcome,
  );
  return makeExternalActionResult({
    status,
    executionResult,
    providerReference,
    verification,
    evidenceReference: event.id,
    error: {
      code,
      outcome,
      retryable: false,
      reviewRequired: true,
    },
  });
}

export function createEmailExternalActionConnector(input: {
  providerAdapter: EmailProviderAdapter;
  supportsAttachmentRef: boolean;
  toolGuidance: string;
}): ExternalActionConnector {
  return {
    provider: "email",
    actionType: "send_email",
    approvalToolName: EMAIL_APPROVAL_TOOL,
    toolGuidance: input.toolGuidance,
    validateSetupAction(action, setupApprovalOperationId) {
      const parsed = emailActionContentSchema.safeParse(action);
      if (!parsed.success || (!input.supportsAttachmentRef && parsed.data.attachmentRef)) return null;
      const stored = storedEmailActionSchema.safeParse({
        ...parsed.data,
        actionId: randomUUID(),
        setupApprovalOperationId,
      });
      return stored.success ? stored.data : null;
    },
    setupApprovalDisplay(workTitle, action) {
      const parsed = storedEmailActionSchema.safeParse(action);
      return parsed.success
        ? { ...emailApprovalDisplay(parsed.data), title: `حفظ إجراء البريد: ${workTitle}` }
        : { title: "حفظ إجراء بريد", details: ["تعذر قراءة تفاصيل الرسالة."] };
    },
    prepareApproval({ identity, work, runId }) {
      const action = storedEmailActionSchema.parse(work.action);
      const plan = actionPlan({ identity, workId: work.id, runId, action });
      const args = approvalArgsSchema.parse({
        workId: work.id,
        runId,
        actionId: action.actionId,
        setupApprovalOperationId: action.setupApprovalOperationId,
        provider: "email",
        actionType: "send_email",
        action,
        approvedActionHash: approvedActionHash(action, plan),
        plan,
      });
      return {
        actionId: action.actionId,
        actionType: action.type,
        idempotencyActionKind: action.type,
        idempotencyActionVersion: "email-v1",
        args: args as unknown as Record<string, unknown>,
        display: emailApprovalDisplay(action),
        notificationTitle: "موافقة مطلوبة على إرسال بريد",
        notificationBody: "جهزت رسالة بريد للمراجعة؛ لم يبدأ أي إرسال. راجع المحتوى ووافق على الإجراء.",
        notificationData: {
          source: this.provider,
          workId: work.id,
          actionId: action.actionId,
          deepLink: `/main?workId=${encodeURIComponent(work.id)}`,
        },
        evidence: {
          provider: this.provider,
          actionType: action.type,
          actionId: action.actionId,
          setupApprovalOperationId: action.setupApprovalOperationId,
          approvedActionHash: args.approvedActionHash,
          recipientCount: 1,
          subjectLength: action.subject.length,
          bodyLength: action.body.length,
          hasAttachmentReference: Boolean(action.attachmentRef),
          status: "approval_requested",
        },
      };
    },
    approvalDisplay(args) {
      const parsed = approvalArgsSchema.safeParse(args);
      return parsed.success
        ? emailApprovalDisplay(parsed.data.action)
        : { title: "موافقة مطلوبة على إرسال بريد", details: ["تعذر قراءة تفاصيل الرسالة؛ لن يبدأ الإرسال."] };
    },
    executeApproved(executionInput) {
      return executeEmailApproval({
        ...executionInput,
        providerAdapter: input.providerAdapter,
        supportsAttachmentRef: input.supportsAttachmentRef,
      });
    },
    recoverOperation: recoverEmailOperation,
  };
}

export const fakeEmailExternalActionConnector = createEmailExternalActionConnector({
  providerAdapter: fakeEmailProviderAdapter,
  supportsAttachmentRef: true,
  toolGuidance:
    "Email is available only as a test-gated fake connector in this environment. Use action.type send_email with recipient, subject, body and optional attachmentRef. The action is separately approved before its simulated send.",
});