import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function GraphSection({
  title,
  icon,
  children,
  className = "",
  action,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RelatedLink({
  label,
  detail,
  onOpen,
}: {
  label: string;
  detail?: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 text-right text-sm transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {detail && <span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      <ArrowLeft className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function EmptyRelation({ children = "لا توجد سجلات مرتبطة بهذا الكيان بعد." }: { children?: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{children}</p>;
}