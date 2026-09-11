from __future__ import annotations

import json
import os
import signal
import time
from collections.abc import Callable
from typing import Any

from packages.application.use_cases import ApplicationService
from packages.persistence.ports import PersistencePort
from packages.persistence.sqlite import SQLiteStore


class ReminderWorker:
    def __init__(
        self,
        application: ApplicationService,
        poll_seconds: float = 5.0,
        lease_seconds: int = 60,
        tenant_id: str | None = None,
        deliver: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.application = application
        self.poll_seconds = poll_seconds
        self.lease_seconds = lease_seconds
        self.tenant_id = tenant_id
        self.deliver = deliver or self._log_delivery
        self.running = True

    def stop(self, *_args) -> None:
        self.running = False

    def run_once(self) -> bool:
        reminder = self.application.claim_due_reminder(
            self.lease_seconds, tenant_id=self.tenant_id
        )
        if not reminder:
            return False
        try:
            self.deliver(reminder)
            self.application.mark_reminder_delivered(reminder["id"])
            print(json.dumps({"event": "reminder.completed", "id": reminder["id"]}))
        except Exception as error:
            self.application.mark_reminder_failed(reminder["id"], str(error))
            print(
                json.dumps(
                    {
                        "event": "reminder.failed",
                        "id": reminder["id"],
                        "error": str(error),
                    },
                    ensure_ascii=False,
                )
            )
        return True

    @staticmethod
    def _log_delivery(reminder: dict[str, Any]) -> None:
        # The reminder id is the stable delivery/idempotency key for a future
        # channel adapter.
        print(
            json.dumps(
                {
                    "event": "reminder.claimed",
                    "delivery_key": reminder["id"],
                    **reminder,
                },
                ensure_ascii=False,
            )
        )

    def run_forever(self) -> None:
        while self.running:
            did_work = self.run_once()
            if not did_work:
                time.sleep(self.poll_seconds)


def main() -> None:
    backend = os.getenv("PERSISTENCE_BACKEND", "sqlite").casefold()
    if backend == "postgres":
        from packages.persistence.postgres import PostgresStore

        tenant_id = os.getenv("WORKER_TENANT_ID")
        if not tenant_id:
            raise RuntimeError("WORKER_TENANT_ID is required for the Postgres worker")
        store: PersistencePort = PostgresStore(os.environ["DATABASE_URL"])
    elif backend == "sqlite":
        tenant_id = os.getenv("WORKER_TENANT_ID")
        store = SQLiteStore(os.getenv("DATABASE_PATH", "data/personal-ai-os.sqlite3"))
    else:
        raise RuntimeError(f"Unsupported persistence backend: {backend}")
    worker = ReminderWorker(
        ApplicationService(store),
        poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "5")),
        lease_seconds=int(os.getenv("WORKER_LEASE_SECONDS", "60")),
        tenant_id=tenant_id,
    )
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    print(json.dumps({"service": "worker", "status": "started"}))
    try:
        if os.getenv("WORKER_ONCE", "").lower() in {"1", "true", "yes"}:
            worker.run_once()
        else:
            worker.run_forever()
    finally:
        store.close()


if __name__ == "__main__":
    main()
