from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from packages.llm.gateway import IntentPlan, ModelRequest, ModelResponse


class DeterministicDevelopmentProvider:
    """No-network provider for the first vertical slice.

    This is intentionally predictable. A hosted provider can later implement
    the same ModelGateway contract without changing the application layer.
    """

    provider = "development"
    model = "deterministic-rules-v1"

    def complete(self, request: ModelRequest) -> ModelResponse:
        message = request.message.strip()
        intent = self._parse(message)
        text = "لم أفهم العملية المطلوبة بعد." if intent is None else ""
        return ModelResponse(
            text=text,
            intent=intent,
            provider=self.provider,
            model=self.model,
            input_units=len(message),
            output_units=len(text),
        )

    def _parse(self, message: str) -> IntentPlan | None:
        lowered = message.casefold()
        amount_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:جنيه|جنية|egp|pounds?)?", lowered)
        is_expense = any(
            phrase in lowered
            for phrase in ("دفعت", "دفعتل", "مصروف", "expense", "paid")
        )
        if is_expense and amount_match:
            amount = Decimal(amount_match.group(1).replace(",", ""))
            person = self._extract_person(message)
            project = self._extract_project(message)
            return IntentPlan(
                name="record_expense",
                arguments={
                    "amount_minor": int(amount * 100),
                    "currency": "EGP",
                    "description": message,
                    "person_name": person,
                    "project_name": project,
                },
                confidence=0.93,
            )

        is_query = any(
            phrase in lowered
            for phrase in ("دفعت كام", "صرفنا كام", "إجمالي", "total", "how much")
        )
        if is_query:
            project = self._extract_project(message) or self._extract_after(
                message, ("في ", "فى ", "على ")
            )
            if project:
                return IntentPlan(
                    name="summarize_project_expenses",
                    arguments={"project_name": project.strip(" ؟?،,.")},
                    confidence=0.9,
                )

        if any(
            phrase in lowered
            for phrase in ("أخد مني كام", "اخد مني كام", "أخذ مني كام", "how much did")
        ):
            person = self._extract_person_from_query(message)
            if person:
                return IntentPlan(
                    name="summarize_person_expenses",
                    arguments={"person_name": person},
                    confidence=0.9,
                )

        if "مين مرتبط" in lowered or "مين مرتبط ب" in lowered or "who is linked" in lowered:
            project = self._extract_project(message) or self._extract_after(
                message, ("مشروع ", "project ")
            )
            if project:
                return IntentPlan(
                    name="list_project_people",
                    arguments={"project_name": project.strip(" ؟?،,.")},
                    confidence=0.88,
                )

        if "فكرني" in lowered or "ذكرني" in lowered or "remind me" in lowered:
            weekday = self._extract_weekday(lowered)
            person = self._extract_after(message, ("أكلم ", "اكلم ", "اتصل ب", "call "))
            return IntentPlan(
                name="create_reminder",
                arguments={
                    "text": message,
                    "weekday": weekday,
                    "person_name": person.strip(" ؟?،,.") if person else None,
                },
                confidence=0.88,
            )
        return None

    @staticmethod
    def _extract_after(message: str, prefixes: tuple[str, ...]) -> str | None:
        for prefix in prefixes:
            index = message.casefold().find(prefix.casefold())
            if index >= 0:
                value = message[index + len(prefix):].strip()
                if value:
                    return value
        return None

    def _extract_person(self, message: str) -> str | None:
        direct = re.search(r"(?:لـ|ل)([\u0600-\u06FF]+)", message)
        if direct and direct.group(1) not in {"جنيه", "جنية"}:
            return direct.group(1)
        value = self._extract_after(message, ("لمحمد", "لـمحمد", "ل ", "ل"))
        if value:
            # In the common phrase "دفعت لمحمد 11500 جنيه تشطيبات", the
            # person is the token before the amount.
            value = re.split(r"\s+\d", value, maxsplit=1)[0].strip()
            if value:
                return value
        return None

    @staticmethod
    def _extract_person_from_query(message: str) -> str | None:
        match = re.search(
            r"^\s*([\u0600-\u06FF]+)\s+(?:أخد|اخد|أخذ)\s+مني",
            message,
        )
        return match.group(1) if match else None

    def _extract_project(self, message: str) -> str | None:
        lowered = message.casefold()
        for marker in ("تشطيبات", "التشطيبات"):
            if marker in lowered:
                return "تشطيبات"
        return self._extract_after(message, ("مشروع ", "project "))

    @staticmethod
    def _extract_weekday(message: str) -> str | None:
        if "بكرة" in message or "غدا" in message or "غدًا" in message:
            return "بكرة"
        for day in (
            "السبت",
            "الأحد",
            "الاتنين",
            "الاثنين",
            "الثلاثاء",
            "الأربعاء",
            "الخميس",
            "الجمعة",
        ):
            if day in message:
                return day
        return None
