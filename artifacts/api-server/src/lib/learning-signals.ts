export type LearningSignalCategory =
  | "amount"
  | "date_time"
  | "person"
  | "project"
  | "intent"
  | "general";

export type LearningSignalDialect =
  | "egyptian"
  | "gulf"
  | "levantine"
  | "unknown";

export type LearningSignal = {
  kind: "explicit_correction";
  category: LearningSignalCategory;
  dialect: LearningSignalDialect;
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

function dialectFor(text: string): LearningSignalDialect {
  const scores: Record<Exclude<LearningSignalDialect, "unknown">, number> = {
    egyptian: 0,
    gulf: 0,
    levantine: 0,
  };
  const markers: Record<Exclude<LearningSignalDialect, "unknown">, string[]> = {
    egyptian: [
      "مش", "ده", "دي", "كده", "خليه", "خليها", "فلوس", "جنيه", "عايز",
      "النهارده", "دلوقتي", "خد", "اديت",
    ],
    gulf: [
      "باچر", "ريال", "ابي", "ابغى", "هذي", "شلون", "الحين", "عطني", "خله",
    ],
    levantine: [
      "بدي", "مصاري", "هيك", "هاد", "هاي", "شو", "هلاء", "هلق", "ليره",
    ],
  };
  const tokens = new Set(text.split(" "));
  for (const dialect of Object.keys(markers) as Array<Exclude<LearningSignalDialect, "unknown">>) {
    scores[dialect] = markers[dialect].reduce(
      (score, marker) => score + (tokens.has(marker) ? 1 : 0),
      0,
    );
  }
  const ranked = (Object.entries(scores) as Array<[Exclude<LearningSignalDialect, "unknown">, number]>)
    .sort((left, right) => right[1] - left[1]);
  if (!ranked[0] || ranked[0][1] === 0) return "unknown";
  if (ranked[0][1] === ranked[1]?.[1]) return "unknown";
  return ranked[0][0];
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
    dialect: dialectFor(text),
    confidence: /قصدي|غلط/u.test(text) ? 0.95 : 0.82,
    reviewOnly: true,
    autoApply: false,
  };
  if (previous.turnId) signal.previousTurnId = previous.turnId;
  const actionType = previousActionType(previous);
  if (actionType) signal.previousActionType = actionType;
  return signal;
}