import { Router, type IRouter } from "express";
import {
  CreateSecondBrainCandidateBody,
  CreateSecondBrainCandidateResponse,
  ListSecondBrainCandidatesQueryParams,
  ListSecondBrainCandidatesResponse,
  ReviewSecondBrainCandidateParams,
  ReviewSecondBrainCandidateBody,
  ReviewSecondBrainCandidateResponse,
  AssociateSecondBrainCandidateParams,
  AssociateSecondBrainCandidateBody,
  AssociateSecondBrainCandidateResponse,
} from "@workspace/api-zod";
import { requestId, requireIdentity, sendRouteError } from "./route-context";
import {
  createSecondBrainCandidate,
  listSecondBrainCandidates,
  publicSecondBrainCandidate,
  publicSecondBrainMemory,
  reviewSecondBrainCandidate,
  SecondBrainCandidateReviewError,
  associateSecondBrainCandidate,
  SecondBrainCandidateAssociationError,
} from "../lib/second-brain";

const router: IRouter = Router();

router.get("/memory-candidates", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsedQuery = ListSecondBrainCandidatesQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    sendRouteError(req, res, 400, "فلتر المرشحات غير صالح.", "INVALID_MEMORY_CANDIDATE_FILTERS");
    return;
  }
  try {
    const candidates = await listSecondBrainCandidates(identity, parsedQuery.data.status);
    res.json(ListSecondBrainCandidatesResponse.parse({
      candidates: candidates.map(publicSecondBrainCandidate),
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req) }, "Second Brain candidates list failed");
    sendRouteError(req, res, 500, "تعذر تحميل مرشحات الذاكرة.", "SECOND_BRAIN_CANDIDATES_LIST_FAILED");
  }
});

router.post("/memory-candidates", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsed = CreateSecondBrainCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    sendRouteError(req, res, 400, "بيانات مرشح الذاكرة غير صحيحة.", "INVALID_MEMORY_CANDIDATE");
    return;
  }
  try {
    const candidate = await createSecondBrainCandidate(identity, {
      memoryKind: parsed.data.kind,
      key: parsed.data.key,
      value: parsed.data.value,
      confidenceBps: Math.round(parsed.data.confidence * 10_000),
      metadata: parsed.data.metadata,
      conversationId: parsed.data.sourceConversationId,
      turnId: parsed.data.sourceTurnId,
    });
    res.status(201).json(CreateSecondBrainCandidateResponse.parse({
      candidate: publicSecondBrainCandidate(candidate),
      memory: null,
    }));
  } catch (error) {
    req.log.error({ error, requestId: requestId(req) }, "Second Brain candidate create failed");
    sendRouteError(req, res, 500, "تعذر حفظ مرشح الذاكرة.", "SECOND_BRAIN_CANDIDATE_CREATE_FAILED");
  }
});

router.post("/memory-candidates/:candidateId/review", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsedParams = ReviewSecondBrainCandidateParams.safeParse(req.params);
  const parsedBody = ReviewSecondBrainCandidateBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    sendRouteError(req, res, 400, "بيانات مراجعة مرشح الذاكرة غير صحيحة.", "INVALID_MEMORY_CANDIDATE_REVIEW");
    return;
  }
  try {
    const result = await reviewSecondBrainCandidate(identity, parsedParams.data.candidateId, {
      status: parsedBody.data.status,
      note: parsedBody.data.note,
    });
    if (!result) {
      sendRouteError(req, res, 404, "مرشح الذاكرة غير موجود.", "SECOND_BRAIN_CANDIDATE_NOT_FOUND");
      return;
    }
    res.json(ReviewSecondBrainCandidateResponse.parse({
      candidate: publicSecondBrainCandidate(result.candidate),
      memory: result.memory ? publicSecondBrainMemory(result.memory) : null,
    }));
  } catch (error) {
    if (error instanceof SecondBrainCandidateReviewError) {
      const status = error.code === "SECOND_BRAIN_CANDIDATE_STATE_CONFLICT" ? 409 : 400;
      sendRouteError(req, res, status, error.message, error.code);
      return;
    }
    req.log.error({
      error,
      requestId: requestId(req),
      candidateId: parsedParams.data.candidateId,
    }, "Second Brain candidate review failed");
    sendRouteError(req, res, 500, "تعذر حفظ مراجعة مرشح الذاكرة.", "SECOND_BRAIN_CANDIDATE_REVIEW_FAILED");
  }
});

router.post("/memory-candidates/:candidateId/associate", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const parsedParams = AssociateSecondBrainCandidateParams.safeParse(req.params);
  const parsedBody = AssociateSecondBrainCandidateBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    sendRouteError(req, res, 400, "بيانات ربط مرشح الذاكرة غير صحيحة.", "INVALID_MEMORY_CANDIDATE_ASSOCIATION");
    return;
  }
  try {
    const candidate = await associateSecondBrainCandidate(
      identity,
      parsedParams.data.candidateId,
      parsedBody.data,
    );
    if (!candidate) {
      sendRouteError(req, res, 404, "مرشح الذاكرة غير موجود.", "SECOND_BRAIN_CANDIDATE_NOT_FOUND");
      return;
    }
    res.json(AssociateSecondBrainCandidateResponse.parse({
      candidate: publicSecondBrainCandidate(candidate),
      memory: null,
    }));
  } catch (error) {
    if (error instanceof SecondBrainCandidateAssociationError) {
      sendRouteError(req, res, 400, error.message, error.code);
      return;
    }
    req.log.error({ error, requestId: requestId(req), candidateId: parsedParams.data.candidateId }, "Second Brain candidate association failed");
    sendRouteError(req, res, 500, "تعذر ربط مرشح الذاكرة بالكيان.", "SECOND_BRAIN_CANDIDATE_ASSOCIATION_FAILED");
  }
});

export default router;