export function ContextAvailabilityNote() {
  return (
    <details
      className="rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground"
      data-testid="context-availability-note"
    >
      <summary className="min-h-9 cursor-pointer font-medium text-foreground">
        ما الذي لا يظهر في هذا السياق؟
      </summary>
      <div className="space-y-2 pb-1 pt-2 text-xs leading-6">
        <p>
          واجهة الذاكرة الحالية لا ترجع رابطًا موثوقًا بين الذاكرة وهذا السياق؛ لذلك لا أعرض ذاكرة عامة كأنها تخصه.
        </p>
        <p>
          واجهة أعمال السكرتير لا ترجع علاقة دائمة بهذا السياق؛ لذلك لا أعرض أعمالًا مرتبطة بالتخمين أو بتشابه الأسماء.
        </p>
      </div>
    </details>
  );
}
