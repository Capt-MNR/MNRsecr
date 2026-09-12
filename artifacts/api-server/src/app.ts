import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  classifySecretaryError,
  errorLogFields,
  SecretaryError,
} from "./lib/error-contract";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("x-request-id", String(req.id));
  next();
});
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((req, res) => {
  const requestId = String(req.id);
  req.log.warn({
    requestId,
    httpStatus: 404,
    errorCategory: "not_found",
    errorCode: "ROUTE_NOT_FOUND",
  }, "API route not found");
  res.status(404).json({
    error: "الخدمة المطلوبة غير متاحة.",
    code: "ROUTE_NOT_FOUND",
    category: "not_found",
    requestId,
    retryable: false,
  });
});

app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const classified = classifySecretaryError(error);
  req.log.error({
    requestId: String(req.id),
    httpStatus: classified.status,
    ...errorLogFields(classified),
  }, "Unhandled API error");
  res.status(classified.status).json({
    error: "حدث خطأ داخلي أثناء معالجة الطلب.",
    code: classified.code,
    category: classified.category,
    requestId: String(req.id),
    retryable: classified.retryable,
  });
});

export default app;
