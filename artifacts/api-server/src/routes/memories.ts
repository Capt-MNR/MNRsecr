import { Router, type IRouter } from "express";
import {
  ListSecondBrainMemoriesResponse,
  ArchiveSecondBrainMemoryParams,
  ArchiveSecondBrainMemoryResponse,
} from "@workspace/api-zod";
import { requestId, requireIdentity, sendRouteError } from "./route-context";
import {
  archiveSecondBrainMemory,
  listSecondBrainMemories,
  publicSecondBrainMemory,
} from "../lib/second-brain";

const router: IRouter = Router();

router.get("/memories", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const memories = await listSecondBrainMemories(identity);
    res.json(ListSecondBrainMemoriesResponse.parse({
      memories: memories.map(publicSecondBrainMemory),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req) }, "Second Brain memories list failed");
    sendRouteError(req, res, 500, "تعذر تحميل الذاكرة الشخصية.", "SECOND_BRAIN_LIST_FAILED");
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

export default router;