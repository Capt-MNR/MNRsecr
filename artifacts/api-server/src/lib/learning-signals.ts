export type LearningSignalCategory =
  | "amount"
  | "date_time"
  | "person"
  | "project"
  | "intent"
  | "general";

export type LearningSignal = {
  kind: "explicit_correction";
  category: LearningSignalCategory;
  confidence: number;
  previousTurnId?: string;
  previousActionType?: string;
  reviewOnly: true;
  autoApply: false;
};

type RecentTurn = {
  turnId?: string;
  userMessage: string;
  action?: Record<string, unknown>;
};

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ئىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[،؛؟!.,:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

function previousActionType(turn: RecentTurn): string | undefined {
  const action = turn.action;
  if (!action) return undefined;
  if (typeof action.toolName === "string") return action.toolName;
  if (typeof action.type === "string") return action.type;
  return undefined;
}

export function detectLearningSignal(
  message: string,
  recentTurns: RecentTurn[],
): LearningSignal | null {
  if (!message.trim() || recentTurns.length === 0) return null;
  const text = normalized(message);
  const hasExplicitCorrection = /(?:قصدي|غلط|مش\s+(?:ده|دي|كده)|لا\s*[،,]?\s*(?:قصدي|المبلغ|المصروف|الموعد|الشخص|المشروع)|غير(?:ه|ها|ه)?|خليه|خليها|التاني|الثاني)/u.test(text);
  if (!hasExplicitCorrection) return null;

  const category: LearningSignalCategory = /موعد|وقت|تاريخ|بكره|بكرا|باچر|اليوم|الساعه|ساعة/u.test(text)
      ? "date_time"
      : /مبلغ|فلوس|جنيه|ريال|دولار|دينار|[0-9٠-٩]/u.test(text)
        ? "amount"
        : /شخص|اسم|فلان|حد|له|ليه|الشخص/u.test(text)
        ? "person"
        : /مشروع|المشروع/u.test(text)
          ? "project"
          : /مصروف|مصاريف|تذكير|مواعيد|سجل|احسب|سؤال/u.test(text)
            ? "intent"
            : "general";
  const previous = recentTurns.at(-1)!;
  const signal: LearningSignal = {
    kind: "explicit_correction",
    category,
    confidence: /قصدي|غلط/u.test(text) ? 0.95 : 0.82,
    reviewOnly: true,
    autoApply: false,
  };
  if (previous.turnId) signal.previousTurnId = previous.turnId;
  const actionType = previousActionType(previous);
  if (actionType) signal.previousActionType = actionType;
  return signal;
}