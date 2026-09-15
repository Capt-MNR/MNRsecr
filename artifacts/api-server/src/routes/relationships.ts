import { Router, type IRouter } from "express";
import {
  createTypedRelationship,
  deleteTypedRelationship,
  listTypedRelationships,
  RELATION_TYPES,
} from "../lib/relationship-graph";
import { executeStructuredTool } from "../lib/phase2";
import { requireIdentity, requestId, sendRouteError } from "./route-context";

const router: IRouter = Router();

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

router.get("/relationships", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const relation = typeof req.query.relation === "string" ? req.query.relation : "";
  if (!RELATION_TYPES.includes(relation as typeof RELATION_TYPES[number])) {
    sendRouteError(req, res, 400, "نوع العلاقة غير صالح.", "INVALID_RELATIONSHIP_TYPE");
    return;
  }
  const side = req.query.side === "right" ? "right" : "left";
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : "";
  if (!entityId) {
    sendRouteError(req, res, 400, "entityId مطلوب.", "RELATIONSHIP_ENTITY_REQUIRED");
    return;
  }
  if (!isUuid(entityId)) {
    sendRouteError(req, res, 400, "معرّف الكيان غير صالح.", "INVALID_ENTITY_ID");
    return;
  }
  try {
    const relationships = await listTypedRelationships(identity, relation, side, entityId);
    res.json({ relation, side, entityId, relationships });
  } catch (error) {
    sendRouteError(req, res, 404, error instanceof Error ? error.message : "العلاقة غير متاحة.", "RELATIONSHIP_NOT_FOUND");
  }
});

router.post("/relationships", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const relation = typeof req.query.relation === "string" ? req.query.relation : "";
  if (!RELATION_TYPES.includes(relation as typeof RELATION_TYPES[number])) {
    sendRouteError(req, res, 400, "نوع العلاقة غير صالح.", "INVALID_RELATIONSHIP_TYPE");
    return;
  }
  try {
    const result = await executeStructuredTool(identity, "create_typed_relationship", {
      ...(req.body ?? {}),
      relation,
    }, {
      requestId: requestId(req),
      idempotencyKey: typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : undefined,
    });
    res.status(result.pendingApproval ? 202 : result.ok ? 201 : 400).json(result);
  } catch (error) {
    sendRouteError(req, res, 500, error instanceof Error ? error.message : "تعذر إنشاء العلاقة.", "RELATIONSHIP_CREATE_FAILED");
  }
});

router.delete("/relationships/:relation/:relationshipId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  const relation = req.params.relation;
  if (!RELATION_TYPES.includes(relation as typeof RELATION_TYPES[number])) {
    sendRouteError(req, res, 400, "نوع العلاقة غير صالح.", "INVALID_RELATIONSHIP_TYPE");
    return;
  }
  if (!isUuid(req.params.relationshipId)) {
    sendRouteError(req, res, 400, "معرّف العلاقة غير صالح.", "INVALID_RELATIONSHIP_ID");
    return;
  }
  try {
    const result = await executeStructuredTool(identity, "delete_typed_relationship", {
      relation,
      relationshipId: req.params.relationshipId,
    }, { requestId: requestId(req) });
    res.status(result.pendingApproval ? 202 : result.ok ? 200 : 400).json(result);
  } catch (error) {
    sendRouteError(req, res, 500, error instanceof Error ? error.message : "تعذر حذف العلاقة.", "RELATIONSHIP_DELETE_FAILED");
  }
});

export default router;