from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from packages.application.use_cases import ApplicationService
from packages.contracts.models import (
    ProposedAction,
    ToolTrace,
    TurnRequest,
    TurnResult,
    UsageMetadata,
)
from packages.domain.errors import ActionRejected, DomainError
from packages.llm.gateway import ModelGateway, ModelRequest


class FirstPartyRuntime:
    """Small active runtime owned by the product.

    It plans with a ModelGateway and mutates state only through application
    use cases. It has no dependency on the inactive future adapter.
    """

    def __init__(
        self,
        *,
        gateway: ModelGateway,
        application: ApplicationService,
        timezone_name: str = "Africa/Cairo",
    ) -> None:
        self.gateway = gateway
        self.application = application
        self.timezone_name = timezone_name

    def handle(self, request: TurnRequest) -> TurnResult:
        runtime_session_id = f"runtime_{uuid.uuid4().hex}"
        started = datetime.now(timezone.utc)
        try:
            self._check_control(request)
            effective_context = request.context.with_capabilities(
                request.context.capabilities.intersection(
                    request.allowed_capabilities
                )
            )
            response = self.gateway.complete(
                ModelRequest(
                    context=effective_context,
                    message=request.user_message,
                    memory_snapshot=request.memory_snapshot,
                    model_policy=request.model_policy,
                )
            )
            self._check_control(request)
            if response.intent is None:
                return self._result(
                    request,
                    runtime_session_id,
                    "لم أتمكن من تحويل الطلب إلى عملية مفهومة.",
                    response,
                    started,
                )
            return self._dispatch(
                request,
                effective_context,
                runtime_session_id,
                response,
                started,
            )
        except DomainError as error:
            return TurnResult(
                product_conversation_id=request.context.conversation_id,
                runtime_session_id=runtime_session_id,
                assistant_message="تعذر تنفيذ العملية.",
                failure=str(error),
                metadata={"error_type": type(error).__name__},
            )
        except TimeoutError:
            return TurnResult(
                product_conversation_id=request.context.conversation_id,
                runtime_session_id=runtime_session_id,
                assistant_message="انتهى الوقت المسموح لتنفيذ الطلب.",
                failure="deadline_exceeded",
            )

    def _dispatch(
        self, request, effective_context, runtime_session_id, response, started
    ):
        intent = response.intent
        action_id = f"action_{uuid.uuid4().hex}"
        arguments = dict(intent.arguments)
        allowed_arguments = {
            "record_expense": {
                "amount_minor",
                "currency",
                "description",
                "person_name",
                "project_name",
            },
            "summarize_project_expenses": {"project_name"},
            "summarize_person_expenses": {"person_name"},
            "list_project_people": {"project_name"},
            "create_reminder": {"text", "weekday", "person_name"},
        }
        expected = allowed_arguments.get(intent.name)
        if expected is None:
            raise ActionRejected(f"Unsupported action: {intent.name}")
        unexpected = set(arguments) - expected
        if unexpected:
            raise ActionRejected(
                f"Unexpected action arguments: {', '.join(sorted(unexpected))}"
            )
        if intent.name == "record_expense":
            result = self.application.record_expense(
                context=effective_context,
                idempotency_key=request.idempotency_key,
                **arguments,
            )
            amount = result["amount_minor"] / 100
            message = (
                f"تم تسجيل مصروف {amount:,.2f} {result['currency']} "
                f"ضمن مشروع {arguments.get('project_name') or 'غير محدد'}."
            )
            committed = ProposedAction(
                action_id=action_id,
                name=intent.name,
                arguments=arguments,
                status="committed",
                result=result,
            )
            referenced = [
                {"type": "expense", "id": result["expense_id"]},
                *(
                    [{"type": "person", "id": result["person_id"]}]
                    if result.get("person_id")
                    else []
                ),
                *(
                    [{"type": "project", "id": result["project_id"]}]
                    if result.get("project_id")
                    else []
                ),
            ]
            return self._result(
                request,
                runtime_session_id,
                message,
                response,
                started,
                committed=(committed,),
                referenced=referenced,
            )

        if intent.name == "summarize_project_expenses":
            result = self.application.summarize_project_expenses(
                context=effective_context, **arguments
            )
            message = (
                f"إجمالي مصروفات {result['project_name']}: "
                f"{result['total_minor'] / 100:,.2f} {result['currency']} "
                f"({result['expense_count']} عملية)."
            )
            action = ProposedAction(
                action_id=action_id,
                name=intent.name,
                arguments=arguments,
                status="read",
                result=result,
            )
            return self._result(
                request,
                runtime_session_id,
                message,
                response,
                started,
                proposed=(action,),
                referenced=(
                    [{"type": "project", "id": result["project_id"]}]
                    if result.get("project_id")
                    else []
                ),
            )

        if intent.name == "summarize_person_expenses":
            result = self.application.summarize_person_expenses(
                context=effective_context, **arguments
            )
            message = (
                f"إجمالي ما دُفع لـ {result['person_name']}: "
                f"{result['total_minor'] / 100:,.2f} "
                f"{result['currency'] or 'غير معروف'} "
                f"({result['expense_count']} عملية)."
            )
            action = ProposedAction(
                action_id=action_id,
                name=intent.name,
                arguments=arguments,
                status="read",
                result=result,
            )
            return self._result(
                request,
                runtime_session_id,
                message,
                response,
                started,
                proposed=(action,),
                referenced=(
                    [{"type": "person", "id": result["person_id"]}]
                    if result.get("person_id")
                    else []
                ),
            )

        if intent.name == "list_project_people":
            result = self.application.list_project_people(
                context=effective_context, **arguments
            )
            names = "، ".join(person["name"] for person in result["people"])
            message = (
                f"الأشخاص المرتبطون بمشروع {result['project_name']}: "
                f"{names or 'لا يوجد أشخاص مسجلون بعد'}."
            )
            action = ProposedAction(
                action_id=action_id,
                name=intent.name,
                arguments=arguments,
                status="read",
                result=result,
            )
            return self._result(
                request,
                runtime_session_id,
                message,
                response,
                started,
                proposed=(action,),
                referenced=(
                    [{"type": "project", "id": result["project_id"]}]
                    if result.get("project_id")
                    else []
                ),
            )

        if intent.name == "create_reminder":
            due_at = self._next_weekday(arguments.get("weekday"))
            result = self.application.create_reminder(
                context=effective_context,
                text=request.user_message,
                due_at=due_at,
                timezone_name=self.timezone_name,
                idempotency_key=request.idempotency_key,
            )
            message = f"تم إنشاء تذكير ليوم {arguments.get('weekday') or 'الموعد المحدد'}."
            committed = ProposedAction(
                action_id=action_id,
                name=intent.name,
                arguments=arguments,
                status="committed",
                result=result,
            )
            return self._result(
                request,
                runtime_session_id,
                message,
                response,
                started,
                committed=(committed,),
                referenced=[{"type": "reminder", "id": result["reminder_id"]}],
            )

        return self._result(
            request,
            runtime_session_id,
            "العملية مفهومة لكن ليس لها use case متاح بعد.",
            response,
            started,
            warnings=("unsupported_intent",),
        )

    def _result(
        self,
        request,
        runtime_session_id,
        message,
        response,
        started,
        *,
        proposed=(),
        committed=(),
        referenced=(),
        warnings=(),
    ):
        completed = datetime.now(timezone.utc)
        trace = ToolTrace(
            name=response.intent.name if response.intent else "intent_extraction",
            arguments=dict(response.intent.arguments) if response.intent else {},
            status="completed" if not warnings else "warning",
            started_at=started,
            completed_at=completed,
        )
        return TurnResult(
            product_conversation_id=request.context.conversation_id,
            runtime_session_id=runtime_session_id,
            assistant_message=message,
            proposed_actions=proposed,
            committed_actions=committed,
            referenced_entities=referenced,
            tool_trace=(trace,),
            usage=UsageMetadata(
                input_units=response.input_units,
                output_units=response.output_units,
                provider=response.provider,
                model=response.model,
            ),
            metadata={"runtime": "first-party", "intent_confidence": (
                response.intent.confidence if response.intent else 0
            )},
            warnings=warnings,
        )

    @staticmethod
    def _check_control(request: TurnRequest) -> None:
        if request.cancellation and request.cancellation.is_set():
            raise TimeoutError("cancelled")
        if request.deadline_at and datetime.now(timezone.utc) >= request.deadline_at:
            raise TimeoutError("deadline exceeded")

    def _next_weekday(self, requested: str | None) -> datetime:
        cairo = ZoneInfo(self.timezone_name)
        now = datetime.now(cairo)
        weekdays = {
            "بكرة": None,
            "السبت": 5,
            "الأحد": 6,
            "الاتنين": 0,
            "الاثنين": 0,
            "الثلاثاء": 1,
            "الأربعاء": 2,
            "الخميس": 3,
            "الجمعة": 4,
        }
        target = weekdays.get(requested or "")
        if target is None:
            return (now + timedelta(days=1)).replace(
                hour=9, minute=0, second=0, microsecond=0
            )
        days = (target - now.weekday()) % 7
        if days == 0:
            days = 7
        return (now + timedelta(days=days)).replace(
            hour=9, minute=0, second=0, microsecond=0
        )
