import { Router, type IRouter, type Request } from "express";
import {
  CreateTurnBody,
  CreateTurnResponse,
  GetTodayContextResponse,
} from "@workspace/api-zod";
import {
  agentRuntime,
  executeApprovedOperation,
  persistence,
  saveApprovedOperationTurn,
  type Identity,
} from "../lib/secretary";
import { executeStructuredTool } from "../lib/phase2";
import {
  claimOperation,
  completeOperation,
  failOperation,
  getOperation,
  rejectOperation,
  type OperationExecutionResult,
  type PendingOperation,
} from "../lib/secretary-operations";
import {
  approvalRequestSchema,
  approvalOperationIdSchema,
  approvalSchemaForTool,
  persistedApprovalArgs,
} from "../lib/approval-schemas";
import { configuredProvider } from "../lib/phase2";
import {
  classifySecretaryError,
  errorLogFields,
  SecretaryError,
} from "../lib/error-contract";

const router: IRouter = Router();

function getIdentity(req: Request): Identity | null {
  const authorization = req.get("authorization");
  if (authorization !== "Bearer dev-user") return null;
  return {
    tenantId: process.env.SECRETARY_TENANT_ID ?? "development",
    userId: process.env.SECRETARY_USER_ID ?? "dev-user",
  };
}

function requestId(req: Request): string {
  return String(req.id);
}

function sendError(
  req: Request,
  res: any,
  error: unknown,
  logLevel: "warn" | "error" = "error",
  providerOverride?: string,
): void {
  const classified = classifySecretaryError(error);
  const provider = classified.provider ?? providerOverride;
  const fields = {
    requestId: requestId(req),
    httpStatus: classified.status,
    ...errorLogFields(classified),
  };
  if (logLevel === "warn") {
    req.log.warn(fields, "Secretary request rejected");
  } else {
    req.log.error(fields, "Secretary request failed");
  }
  res.status(classified.status).json({
    error: "تعذر إكمال طلب السكرتير.",
    code: classified.code,
    category: classified.category,
    requestId: requestId(req),
    retryable: classified.retryable,
    ...(provider ? { provider } : {}),
  });
}

function operationResultResponse(
  operation: PendingOperation,
): OperationExecutionResult & { operationId: string; status: string } {
  if (operation.result) {
    return {
      ...operation.result,
      operationId: operation.operationId,
      status: operation.status,
    };
  }
  const assistantMessage = operation.status === "rejected"
    ? "تم إلغاء العملية، ولن يتم تنفيذ أي تغيير."
    : operation.status === "expired"
      ? "انتهت صلاحية طلب التأكيد، ولم يتم تنفيذ أي تغيير."
      : operation.status === "failed"
        ? "تعذر تنفيذ العملية. لن أعيد تشغيلها تلقائيًا."
        : operation.status === "executing"
          ? "العملية قيد التنفيذ. لا ترسل تأكيدًا آخر."
          : "العملية ما زالت في انتظار موافقتك.";
  return {
    conversationId: operation.conversationId ?? "",
    assistantMessage,
    action: {
      type: `approval_${operation.status}`,
      operationId: operation.operationId,
      status: operation.status,
      toolName: operation.toolName,
      ...(operation.error ? { error: operation.error.message } : {}),
    },
    provider: "server",
    model: "approval-operation",
    operationId: operation.operationId,
    status: operation.status,
  };
}

function approvalError(message: string, code: string, status: number): SecretaryError {
  return new SecretaryError(message, {
    status,
    category: status === 404 ? "not_found" : "validation_error",
    code,
    retryable: false,
  });
}

function publicOperation(operation: PendingOperation) {
  return {
    operationId: operation.operationId,
    conversationId: operation.conversationId,
    toolName: operation.toolName,
    args: operation.args,
    display: operation.display,
    status: operation.status,
    updatedAt: operation.updatedAt.toISOString(),
  };
}

async function executeExpenseApproval(
  identity: Identity,
  operation: PendingOperation,
): Promise<OperationExecutionResult> {
  const args = persistedApprovalArgs(operation.args);
  const toolResult = await executeStructuredTool(identity, operation.toolName, args, {
    requestId: `approval-${operation.operationId}`,
    conversationId: operation.conversationId,
    approvedOperationId: operation.operationId,
  });
  if (!toolResult.ok || toolResult.pendingApproval) {
    throw new Error(typeof toolResult.error === "string" ? toolResult.error : "تعذر تنفيذ العملية.");
  }
  const expense = toolResult.expense as Record<string, unknown> | undefined;
  return {
    conversationId: operation.conversationId ?? "",
    assistantMessage: "تمام، سجلت المصروف بنجاح.",
    action: {
      type: "expense_recorded",
      operationId: operation.operationId,
      ...(expense ?? {}),
      args,
    },
    provider: "server",
    model: "approved-operation",
  };
}

function resultWithActualArgs(
  result: OperationExecutionResult,
  operation: PendingOperation,
): OperationExecutionResult {
  return {
    ...result,
    action: {
      ...(result.action ?? {}),
      args: persistedApprovalArgs(operation.args),
    },
  };
}

router.get("/today", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  try {
    const context = await persistence.getTodayContext(identity);
    res.json(GetTodayContextResponse.parse({ context }));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get("/approvals/:operationId", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }
  if (!approvalOperationIdSchema.safeParse(req.params.operationId).success) {
    sendError(req, res, approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404));
    return;
  }
  try {
    const operation = await getOperation(identity, req.params.operationId);
    if (!operation) {
      sendError(req, res, approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404));
      return;
    }
    res.json(publicOperation(operation));
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/turns", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  const parsed = CreateTurnBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, new SecretaryError("Invalid turn body.", {
      status: 400,
      category: "validation_error",
      code: "INVALID_TURN_BODY",
      retryable: false,
      cause: parsed.error,
    }), "warn");
    return;
  }

  try {
    const currentRequestId = requestId(req);
    req.log.info({
      requestId: currentRequestId,
      provider: configuredProvider(),
      conversationId: parsed.data.conversationId ?? undefined,
    }, "Secretary request started");
    const result = await agentRuntime.run(identity, {
      ...parsed.data,
      requestId: currentRequestId,
    });
    req.log.info({
      requestId: currentRequestId,
      provider: result.provider,
      model: result.model,
      conversationId: result.conversationId,
    }, "Secretary request completed");
    res.json(CreateTurnResponse.parse(result));
  } catch (error) {
    const classified = classifySecretaryError(error);
    const provider = configuredProvider() === "unavailable" ? undefined : configuredProvider();
    sendError(req, res, classified, "error", provider);
  }
});

router.post("/approvals/:operationId/approve", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  const operationId = req.params.operationId;
  try {
    if (!approvalOperationIdSchema.safeParse(operationId).success) {
      sendError(req, res, approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404));
      return;
    }
    const body = approvalRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      sendError(req, res, approvalError("بيانات الموافقة غير صالحة.", "INVALID_APPROVAL_BODY", 400), "warn");
      return;
    }
    let argsOverride: Record<string, unknown> | undefined;
    if (body.data.args !== undefined) {
      const operation = await getOperation(identity, operationId);
      if (!operation) {
        sendError(req, res, approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404));
        return;
      }
      const schema = approvalSchemaForTool(operation.toolName);
      if (!schema) {
        sendError(req, res, approvalError("تعديل هذه العملية غير مدعوم بعد.", "APPROVAL_ARGS_NOT_SUPPORTED", 400), "warn");
        return;
      }
      const parsedArgs = schema.safeParse(body.data.args);
      if (!parsedArgs.success) {
        sendError(req, res, approvalError("بيانات العملية المعدلة غير صالحة.", "INVALID_APPROVAL_ARGS", 400), "warn");
        return;
      }
      argsOverride = parsedArgs.data as Record<string, unknown>;
    }

    const claim = await claimOperation(identity, operationId, argsOverride);
    if (claim.kind === "existing") {
      res.json(operationResultResponse(claim.operation));
      return;
    }

    let result: OperationExecutionResult;
    try {
      result = claim.operation.toolName === "record_expense"
        ? await executeExpenseApproval(identity, claim.operation)
        : await executeApprovedOperation(identity, claim.operation);
      result = resultWithActualArgs(result, claim.operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تنفيذ العملية.";
      const failed = await failOperation(identity, operationId, message);
      res.status(500).json({
        ...operationResultResponse(failed),
        error: "تعذر تنفيذ العملية.",
        code: "APPROVED_OPERATION_FAILED",
        category: "agent_error",
        requestId: requestId(req),
        retryable: false,
      });
      return;
    }

    const completed = await completeOperation(identity, operationId, result);
    await saveApprovedOperationTurn(identity, claim.operation, result);
    res.json(operationResultResponse(completed));
  } catch (error) {
    sendError(req, res, error instanceof Error && error.message === "Pending operation was not found."
      ? approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404)
      : error);
  }
});

router.post("/approvals/:operationId/reject", async (req, res): Promise<void> => {
  const identity = getIdentity(req);
  if (!identity) {
    sendError(req, res, new SecretaryError("Authentication required.", {
      status: 401,
      category: "authentication_error",
      code: "AUTHENTICATION_REQUIRED",
      retryable: false,
    }), "warn");
    return;
  }

  try {
    if (!approvalOperationIdSchema.safeParse(req.params.operationId).success) {
      sendError(req, res, approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404));
      return;
    }
    const operation = await rejectOperation(identity, req.params.operationId);
    res.json(operationResultResponse(operation));
  } catch (error) {
    sendError(req, res, error instanceof Error && error.message === "Pending operation was not found."
      ? approvalError("Pending operation was not found.", "APPROVAL_NOT_FOUND", 404)
      : error);
  }
});

export default router;