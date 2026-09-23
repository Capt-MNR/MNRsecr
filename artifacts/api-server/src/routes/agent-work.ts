import { Router, type IRouter, type Request, type Response } from "express";
import {
  ChangeAgentWorkStatusBody,
  CreateAgentWorkBody,
  GetAgentWorkParams,
  ListAgentWorksQueryParams,
} from "@workspace/api-zod";
import { agentWorkAdapters } from "../lib/agent-work/factory";
import { agentWorkRuntime } from "../lib/agent-work/runtime";
import type { AgentWorkIdentity } from "../lib/agent-work/types";
import { getIdentity } from "./route-context";

const router: IRouter = Router();

function identityFromRequest(req: Request): AgentWorkIdentity | null {
  const identity = getIdentity(req);
  return identity ?? (
    process.env.NODE_ENV !== "production"
      ? agentWorkAdapters.identity.resolveRequest({
        authorization: req.get("authorization"),
        tenantId: req.get("x-tenant-id"),
        userId: req.get("x-user-id"),
      })
      : null
  );
}

function authError(res: Response): void {
  res.status(401).json({
    error: "يلزم تسجيل الدخول لإدارة أعمال الوكيل.",
    code: "AUTHENTICATION_REQUIRED",
    category: "authentication_error",
    retryable: false,
  });
}

function routeError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "AGENT_WORK_REQUEST_FAILED";
  if (message === "AGENT_WORK_DISABLED") {
    res.status(404).json({
      error: "ميزة أعمال الوكيل غير مفعلة.",
      code: message,
      category: "not_found",
      retryable: false,
    });
    return;
  }
  if (message === "AGENT_WORK_STATUS_CONFLICT" || message.includes("INVALID_WORK_TRANSITION")) {
    res.status(409).json({
      error: "تغيرت حالة العمل قبل تنفيذ الطلب.",
      code: message,
      category: "conflict_error",
      retryable: false,
    });
    return;
  }
  res.status(500).json({
    error: "تعذر معالجة عمل الوكيل.",
    code: message,
    category: "internal_error",
    retryable: false,
  });
}

function serializeWork(work: Awaited<ReturnType<typeof agentWorkRuntime.createWork>>) {
  return {
    ...work,
    identity: undefined,
    nextRunAt: work.nextRunAt?.toISOString() ?? null,
    lastRunAt: work.lastRunAt?.toISOString() ?? null,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  };
}

function serializeRun(run: Awaited<ReturnType<typeof agentWorkRuntime.claimRun>> extends infer T
  ? NonNullable<T>
  : never) {
  return {
    ...run,
    identity: undefined,
    leaseToken: undefined,
    leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

router.get("/works", async (req, res): Promise<void> => {
  const identity = identityFromRequest(req);
  if (!identity) {
    authError(res);
    return;
  }
  const parsed = ListAgentWorksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "مرشحات أعمال الوكيل غير صالحة.",
      code: "INVALID_AGENT_WORK_QUERY",
      category: "validation_error",
      retryable: false,
    });
    return;
  }
  try {
    const works = await agentWorkRuntime.listWorks({
      identity,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    res.json({ works: works.map(serializeWork) });
  } catch (error) {
    routeError(res, error);
  }
});

router.post("/works", async (req, res): Promise<void> => {
  const identity = identityFromRequest(req);
  if (!identity) {
    authError(res);
    return;
  }
  const parsed = CreateAgentWorkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "بيانات عمل الوكيل غير صالحة.",
      code: "INVALID_AGENT_WORK_BODY",
      category: "validation_error",
      retryable: false,
    });
    return;
  }
  try {
    const work = await agentWorkRuntime.createWork({
      identity,
      ...parsed.data,
      nextRunAt: parsed.data.nextRunAt ?? null,
    });
    res.status(201).json({ work: serializeWork(work) });
  } catch (error) {
    routeError(res, error);
  }
});

router.get("/works/:workId", async (req, res): Promise<void> => {
  const identity = identityFromRequest(req);
  if (!identity) {
    authError(res);
    return;
  }
  const parsed = GetAgentWorkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: "معرف العمل غير صالح.",
      code: "INVALID_AGENT_WORK_ID",
      category: "validation_error",
      retryable: false,
    });
    return;
  }
  try {
    const details = await agentWorkRuntime.getDetails(identity, parsed.data.workId);
    if (!details) {
      res.status(404).json({
        error: "لم يتم العثور على عمل الوكيل.",
        code: "AGENT_WORK_NOT_FOUND",
        category: "not_found",
        retryable: false,
      });
      return;
    }
    res.json({
      work: serializeWork(details.work),
      runs: details.runs.map(serializeRun),
      events: details.events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        createdAt: event.createdAt.toISOString(),
      })),
      evidence: details.evidence.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    routeError(res, error);
  }
});

router.post("/works/:workId", async (req, res): Promise<void> => {
  const identity = identityFromRequest(req);
  if (!identity) {
    authError(res);
    return;
  }
  const params = GetAgentWorkParams.safeParse(req.params);
  const body = ChangeAgentWorkStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: "تغيير حالة العمل غير صالح.",
      code: "INVALID_AGENT_WORK_STATUS",
      category: "validation_error",
      retryable: false,
    });
    return;
  }
  try {
    const work = await agentWorkRuntime.changeStatus({
      identity,
      workId: params.data.workId,
      from: body.data.from,
      to: body.data.to,
      reason: body.data.reason,
    });
    res.json({ work: serializeWork(work) });
  } catch (error) {
    routeError(res, error);
  }
});

router.post("/works/:workId/runs", async (req, res): Promise<void> => {
  const identity = identityFromRequest(req);
  if (!identity) {
    authError(res);
    return;
  }
  const params = GetAgentWorkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: "معرف العمل غير صالح.",
      code: "INVALID_AGENT_WORK_ID",
      category: "validation_error",
      retryable: false,
    });
    return;
  }
  try {
    const run = await agentWorkRuntime.claimRun({
      identity,
      workId: params.data.workId,
    });
    res.json({ run: run ? serializeRun(run) : null });
  } catch (error) {
    routeError(res, error);
  }
});

export default router;