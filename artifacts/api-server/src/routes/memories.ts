import { Router, type IRouter } from "express";
import {
  ListSecondBrainMemoriesResponse,
  ListSecondBrainMemoriesQueryParams,
  CreateSecondBrainMemoryBody,
  CreateSecondBrainMemoryResponse,
  EditSecondBrainMemoryBody,
  EditSecondBrainMemoryResponse,
  ArchiveSecondBrainMemoryParams,
  ArchiveSecondBrainMemoryResponse,
  ListSecondBrainMemoryHistoryResponse,
} from "@workspace/api-zod";
import { requestId, requireIdentity, sendRouteError } from "./route-context";
import {
  archiveSecondBrainMemory,
  editSecondBrainMemory,
  listSecondBrainMemoryHistory,
  listSecondBrainMemories,
  publicSecondBrainMemory,
  rememberSecondBrain,
  restoreSecondBrainMemory,
} from "../lib/second-brain";

const router: IRouter = Router();

router.post("/memories", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = CreateSecondBrainMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات الذاكرة غير صالحة.", "INVALID_MEMORY_INPUT");
    return;
  }
  const expiresAt = parsed.data.expiresAt ?? null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    sendRouteError(req, res, 400, "يجب أن يكون انتهاء الذاكرة في المستقبل.", "INVALID_MEMORY_EXPIRY");
    return;
  }
  try {
    const memory = await rememberSecondBrain(identity, {
      memoryKind: parsed.data.kind,
      key: parsed.data.key.trim(),
      value: parsed.data.value,
      expiresAt,
      sourceKind: "api_user_entry",
    });
    res.status(201).json(CreateSecondBrainMemoryResponse.parse({
      memory: publicSecondBrainMemory(memory),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req) }, "Second Brain memory create failed");
    sendRouteError(req, res, 500, "تعذر حفظ الذاكرة الشخصية.", "SECOND_BRAIN_CREATE_FAILED");
  }
});

router.get("/memories", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const parsedQuery = ListSecondBrainMemoriesQueryParams.safeParse(req.query);
    if (!parsedQuery.success) {
      sendRouteError(req, res, 400, "فلاتر الذاكرة غير صالحة.", "INVALID_MEMORY_FILTERS");
      return;
    }
    const memories = await listSecondBrainMemories(identity, parsedQuery.data);
    res.json(ListSecondBrainMemoriesResponse.parse({
      memories: memories.map(publicSecondBrainMemory),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req) }, "Second Brain memories list failed");
    sendRouteError(req, res, 500, "تعذر تحميل الذاكرة الشخصية.", "SECOND_BRAIN_LIST_FAILED");
  }
});

router.patch("/memories/:memoryId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsedParams = ArchiveSecondBrainMemoryParams.safeParse(req.params);
  if (!parsedParams.success) {
    sendRouteError(req, res, 400, "معرّف الذاكرة غير صالح.", "INVALID_MEMORY_ID");
    return;
  }
  const parsedBody = EditSecondBrainMemoryBody.safeParse(req.body);
  if (!parsedBody.success || !parsedBody.data.value.trim()) {
    sendRouteError(req, res, 400, "بيانات تعديل الذاكرة غير صالحة.", "INVALID_MEMORY_EDIT");
    return;
  }
  try {
    const memory = await editSecondBrainMemory(
      identity,
      parsedParams.data.memoryId,
      parsedBody.data.value.trim(),
      parsedBody.data.expectedRevision,
    );
    if (!memory) {
      sendRouteError(req, res, 404, "الذاكرة النشطة غير موجودة.", "SECOND_BRAIN_MEMORY_NOT_FOUND");
      return;
    }
    res.json(EditSecondBrainMemoryResponse.parse({
      memory: publicSecondBrainMemory(memory),
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "SecondBrainMemoryRevisionConflictError") {
      sendRouteError(req, res, 409, "تغيرت هذه الذاكرة في مكان آخر. حدّث القائمة ثم أعد التعديل.", "SECOND_BRAIN_MEMORY_REVISION_CONFLICT");
      return;
    }
    if (error instanceof Error && error.name === "SecondBrainMemoryAliasEditError") {
      sendRouteError(req, res, 409, "يجب تعديل الاسم المستعار من خلال ربطه بالشخص أو المشروع.", "SECOND_BRAIN_ALIAS_EDIT_REQUIRES_ASSOCIATION");
      return;
    }
    req.log.error({ error, requestId: requestId(req), memoryId: parsedParams.data.memoryId }, "Second Brain memory edit failed");
    sendRouteError(req, res, 500, "تعذر تعديل الذاكرة الشخصية.", "SECOND_BRAIN_EDIT_FAILED");
  }
});

router.delete("/memories/:memoryId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = ArchiveSecondBrainMemoryParams.safeParse(req.params);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "معرّف الذاكرة غير صالح.", "INVALID_MEMORY_ID");
    return;
  }
  try {
    const memory = await archiveSecondBrainMemory(identity, parsed.data.memoryId);
    if (!memory) {
      sendRouteError(req, res, 404, "الذاكرة غير موجودة.", "SECOND_BRAIN_MEMORY_NOT_FOUND");
      return;
    }
    res.json(ArchiveSecondBrainMemoryResponse.parse({
      memory: publicSecondBrainMemory(memory),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req), memoryId: parsed.data.memoryId }, "Second Brain memory archive failed");
    sendRouteError(req, res, 500, "تعذر أرشفة الذاكرة الشخصية.", "SECOND_BRAIN_ARCHIVE_FAILED");
  }
});

router.post("/memories/:memoryId/restore", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = ArchiveSecondBrainMemoryParams.safeParse(req.params);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "معرّف الذاكرة غير صالح.", "INVALID_MEMORY_ID");
    return;
  }
  try {
    const memory = await restoreSecondBrainMemory(identity, parsed.data.memoryId);
    if (!memory) {
      sendRouteError(req, res, 404, "الذاكرة المؤرشفة غير موجودة.", "SECOND_BRAIN_ARCHIVED_MEMORY_NOT_FOUND");
      return;
    }
    res.json(ArchiveSecondBrainMemoryResponse.parse({
      memory: publicSecondBrainMemory(memory),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req), memoryId: parsed.data.memoryId }, "Second Brain memory restore failed");
    sendRouteError(req, res, 500, "تعذر استرجاع الذاكرة الشخصية.", "SECOND_BRAIN_RESTORE_FAILED");
  }
});

router.get("/memories/:memoryId/history", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = ArchiveSecondBrainMemoryParams.safeParse(req.params);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "معرّف الذاكرة غير صالح.", "INVALID_MEMORY_ID");
    return;
  }
  try {
    const versions = await listSecondBrainMemoryHistory(identity, parsed.data.memoryId);
    if (!versions) {
      sendRouteError(req, res, 404, "الذاكرة غير موجودة.", "SECOND_BRAIN_MEMORY_NOT_FOUND");
      return;
    }
    res.json(ListSecondBrainMemoryHistoryResponse.parse({ versions }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req), memoryId: parsed.data.memoryId }, "Second Brain memory history failed");
    sendRouteError(req, res, 500, "تعذر تحميل تاريخ الذاكرة الشخصية.", "SECOND_BRAIN_HISTORY_FAILED");
  }
});

export default router;