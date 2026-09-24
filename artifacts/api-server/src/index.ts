import app from "./app";
import { logger } from "./lib/logger";
import { agentWorkRunner } from "./lib/agent-work/runner";
import { createNotificationRecovery } from "./lib/mobile-push";
import { triggerOutboxDispatcher } from "./lib/trigger-outbox";
import { seedUpcomingProactiveDeadlineEvents } from "./lib/proactive-triggers";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
const notificationRecovery = createNotificationRecovery();

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void seedUpcomingProactiveDeadlineEvents()
    .then((count) => logger.info({ count }, "future proactive deadlines reconciled"))
    .catch((error) => logger.error({ error }, "future proactive deadline reconciliation failed"));
  agentWorkRunner.start();
  triggerOutboxDispatcher.start();
  notificationRecovery.start();
});

process.once("SIGTERM", () => {
  agentWorkRunner.stop();
  triggerOutboxDispatcher.stop();
  notificationRecovery.stop();
});
process.once("SIGINT", () => {
  agentWorkRunner.stop();
  triggerOutboxDispatcher.stop();
  notificationRecovery.stop();
});
