import { Router, type IRouter } from "express";
import {
  getEntityTimeline,
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
  return value === "person" || value === "project";
}

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
  try {
    const timeline = await getEntityTimeline(identity, req.params.entityType, req.params.entityId);
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