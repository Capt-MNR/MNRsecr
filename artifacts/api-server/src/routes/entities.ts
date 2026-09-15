import { Router, type IRouter } from "express";
import {
  getEntityTimeline,
  getEntityGraph,
  getPersonGraph,
  getProjectGraph,
  type GraphEntityType,
} from "../lib/entity-graph";
import {
  requireIdentity,
  sendRouteError,
} from "./route-context";

const router: IRouter = Router();

function isEntityType(value: string): value is GraphEntityType {
  return value === "person" || value === "project" || value === "financial_party";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

router.get("/entities/:entityType/:entityId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  if (!isEntityType(req.params.entityType)) {
    sendRouteError(req, res, 400, "نوع الكيان غير صالح.", "INVALID_ENTITY_TYPE");
    return;
  }
  if (!isUuid(req.params.entityId)) {
    sendRouteError(req, res, 400, "معرّف الكيان غير صالح.", "INVALID_ENTITY_ID");
    return;
  }
  try {
    const graph = await getEntityGraph(identity, req.params.entityType, req.params.entityId);
    if (!graph) {
      sendRouteError(req, res, 404, "الكيان غير موجود.", "ENTITY_NOT_FOUND");
      return;
    }
    res.json(graph);
  } catch (error) {
    req.log.error({ error }, "Entity graph read failed");
    sendRouteError(req, res, 500, "تعذر تحميل تفاصيل الكيان.", "ENTITY_GRAPH_READ_FAILED");
  }
});

router.get("/people/:personId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const graph = await getPersonGraph(identity, req.params.personId);
    if (!graph) {
      sendRouteError(req, res, 404, "الشخص غير موجود.", "PERSON_NOT_FOUND");
      return;
    }
    res.json(graph);
  } catch (error) {
    req.log.error({ error }, "Person graph read failed");
    sendRouteError(req, res, 500, "تعذر تحميل تفاصيل الشخص.", "PERSON_GRAPH_READ_FAILED");
  }
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  try {
    const graph = await getProjectGraph(identity, req.params.projectId);
    if (!graph) {
      sendRouteError(req, res, 404, "المشروع غير موجود.", "PROJECT_NOT_FOUND");
      return;
    }
    res.json(graph);
  } catch (error) {
    req.log.error({ error }, "Project graph read failed");
    sendRouteError(req, res, 500, "تعذر تحميل تفاصيل المشروع.", "PROJECT_GRAPH_READ_FAILED");
  }
});

router.get("/entities/:entityType/:entityId/timeline", async (req, res): Promise<void> => {
  const identity = requireIdentity(req, res);
  if (!identity) return;
  if (!isEntityType(req.params.entityType)) {
    sendRouteError(req, res, 400, "نوع الكيان غير صالح.", "INVALID_ENTITY_TYPE");
    return;
  }
  if (!isUuid(req.params.entityId)) {
    sendRouteError(req, res, 400, "معرّف الكيان غير صالح.", "INVALID_ENTITY_ID");
    return;
  }
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    const timeline = await getEntityTimeline(identity, req.params.entityType, req.params.entityId, limit, offset);
    if (!timeline) {
      sendRouteError(req, res, 404, "الكيان غير موجود.", "ENTITY_NOT_FOUND");
      return;
    }
    res.json({ entityType: req.params.entityType, entityId: req.params.entityId, events: timeline });
  } catch (error) {
    req.log.error({ error }, "Entity timeline read failed");
    sendRouteError(req, res, 500, "تعذر تحميل سجل النشاط.", "ENTITY_TIMELINE_READ_FAILED");
  }
});

export default router;