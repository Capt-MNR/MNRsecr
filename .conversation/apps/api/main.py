from __future__ import annotations

import json
import os
import signal
import threading
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from packages.agent_runtime.first_party import FirstPartyRuntime
from packages.application.use_cases import ApplicationService
from packages.contracts.models import ExecutionContext, TurnRequest
from packages.identity.auth import (
    AuthenticationError,
    AuthenticationProvider,
    DevelopmentAuthenticator,
)
from packages.llm.dev_provider import DeterministicDevelopmentProvider
from packages.persistence.ports import PersistencePort
from packages.persistence.sqlite import SQLiteStore


def build_store() -> PersistencePort:
    backend = os.getenv("PERSISTENCE_BACKEND", "sqlite").casefold()
    if backend == "postgres":
        from packages.persistence.postgres import PostgresStore

        return PostgresStore(os.environ["DATABASE_URL"])
    if backend != "sqlite":
        raise RuntimeError(f"Unsupported persistence backend: {backend}")
    return SQLiteStore(os.getenv("DATABASE_PATH", "data/personal-ai-os.sqlite3"))


def build_runtime() -> tuple[PersistencePort, FirstPartyRuntime, AuthenticationProvider]:
    store = build_store()
    application = ApplicationService(store)
    gateway = DeterministicDevelopmentProvider()
    runtime = FirstPartyRuntime(
        gateway=gateway,
        application=application,
        timezone_name=os.getenv("APP_TIMEZONE", "Africa/Cairo"),
    )
    return store, runtime, DevelopmentAuthenticator.from_environment()


class APIHandler(BaseHTTPRequestHandler):
    runtime: FirstPartyRuntime
    store: PersistencePort
    authenticator: AuthenticationProvider
    web_root = Path(__file__).resolve().parents[1] / "web"

    def _write(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_asset(self, path: str) -> None:
        asset_name = "index.html" if path == "/" else path.removeprefix("/")
        allowed_assets = {
            "index.html": "text/html; charset=utf-8",
            "styles.css": "text/css; charset=utf-8",
            "app.js": "application/javascript; charset=utf-8",
        }
        content_type = allowed_assets.get(asset_name)
        if content_type is None:
            self._write(404, {"error": "not_found"})
            return
        asset = self.web_root / asset_name
        if not asset.is_file():
            self._write(404, {"error": "not_found"})
            return
        body = asset.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in {"/", "/index.html", "/styles.css", "/app.js"}:
            self._serve_asset(path)
            return
        if path == "/healthz":
            self._write(200, {"status": "ok", "runtime": "first-party"})
            return
        if path == "/readyz":
            if self.store and self.store.readiness_check():
                self._write(200, {"status": "ready", "persistence": "connected"})
            else:
                self._write(
                    503,
                    {
                        "error": {
                            "code": "not_ready",
                            "message": "Persistence is not ready",
                        }
                    },
                )
            return
        if path in {"/v1/today", "/v1/context"}:
            try:
                identity = self.authenticator.authenticate(self.headers)
                context = identity.to_context(
                    conversation_id=str(uuid.uuid4()),
                    channel="http",
                )
                summary = self.runtime.application.get_today_context(context=context)
                self._write(200, {"context": summary})
            except AuthenticationError as error:
                self._write(
                    401,
                    {"error": {"code": error.code, "message": str(error)}},
                )
            except Exception as error:
                error_type = type(error).__name__
                status = 403 if error_type == "AuthorizationError" else 500
                self._write(
                    status,
                    {
                        "error": {
                            "code": error_type.casefold(),
                            "message": str(error),
                        }
                    },
                )
            return
        self._write(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/v1/turns":
            self._write(404, {"error": "not_found"})
            return
        try:
            identity = self.authenticator.authenticate(self.headers)
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            message = str(body["message"]).strip()
            if not message:
                raise ValueError("message is required")
            raw_conversation_id = body.get("conversation_id")
            conversation_id = (
                str(uuid.UUID(str(raw_conversation_id)))
                if raw_conversation_id
                else str(uuid.uuid4())
            )
            idempotency_key = str(
                self.headers.get("Idempotency-Key")
                or body.get("idempotency_key")
                or uuid.uuid4().hex
            )
            context = identity.to_context(
                conversation_id=conversation_id,
                channel="http",
            )
            requested_capabilities = frozenset(
                str(value)
                for value in body.get(
                    "allowed_capabilities", identity.capabilities
                )
            )
            result = self.runtime.handle(
                TurnRequest(
                    context=context,
                    user_message=message,
                    idempotency_key=idempotency_key,
                    allowed_capabilities=requested_capabilities,
                    deadline_at=datetime.now(timezone.utc) + timedelta(seconds=30),
                )
            )
            if result.failure:
                error_type = result.metadata.get("error_type")
                status = 403 if error_type == "AuthorizationError" else 400
                self._write(
                    status,
                    {
                        "error": {
                            "code": str(error_type or "request_rejected").lower(),
                            "message": result.failure,
                        },
                        "result": asdict(result),
                    },
                )
            else:
                self._write(200, asdict(result))
        except AuthenticationError as error:
            self._write(
                401,
                {"error": {"code": error.code, "message": str(error)}},
            )
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            self._write(
                400,
                {"error": {"code": "invalid_request", "message": str(error)}},
            )
        except Exception as error:
            self._write(
                500,
                {"error": {"code": "internal_error", "message": str(error)}},
            )

    def log_message(self, format: str, *args: Any) -> None:
        print(json.dumps({"http": format % args}, ensure_ascii=False))


def configure_server(
    store: PersistencePort,
    runtime: FirstPartyRuntime,
    authenticator: AuthenticationProvider,
) -> ThreadingHTTPServer:
    APIHandler.store = store
    APIHandler.runtime = runtime
    APIHandler.authenticator = authenticator
    APIHandler.web_root = Path(__file__).resolve().parents[1] / "web"
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    return ThreadingHTTPServer((host, port), APIHandler)


def install_signal_handlers(server: ThreadingHTTPServer) -> None:
    def request_shutdown(_signum, _frame) -> None:
        # shutdown() waits for serve_forever() to leave its loop, so invoke it
        # from a helper thread rather than from the serving signal thread.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)


def main() -> None:
    store, runtime, authenticator = build_runtime()
    server = configure_server(store, runtime, authenticator)
    install_signal_handlers(server)
    host, port = server.server_address
    print(json.dumps({"service": "api", "host": host, "port": port, "runtime": "first-party"}))
    try:
        server.serve_forever()
    finally:
        server.server_close()
        store.close()


if __name__ == "__main__":
    main()
